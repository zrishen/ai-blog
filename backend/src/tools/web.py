"""Generic web tools with a strict, DNS-rebinding-safe outbound boundary."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpcore
import httpx
from langchain_core.tools import tool

from src.config import settings
from src.core.context import current_user_id_cv
from src.core.path_guard import require_user
from src.database.session import async_session
from src.services.agent.web_tool_rate_limit_service import consume_web_tool_request


class _UnsafeWebTarget(ValueError):
    """The requested URL does not satisfy the outbound policy."""


class _ResponseTooLarge(ValueError):
    """The remote response exceeded the configured byte limit."""


class _UnsupportedContentType(ValueError):
    """The remote response is not an allowed textual content type."""


@dataclass(frozen=True)
class _WebTarget:
    url: str
    host: str
    port: int


@dataclass(frozen=True)
class _FetchedResponse:
    status_code: int
    headers: httpx.Headers
    body: bytes


def _normalise_hostname(value: str) -> str:
    host = value.strip().rstrip(".").lower()
    if not host or "*" in host or "/" in host or ":" in host:
        raise _UnsafeWebTarget("invalid hostname")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise _UnsafeWebTarget("invalid hostname") from exc
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise _UnsafeWebTarget("IP literal hosts are not allowed")
    if len(host) > 253 or any(
        not label
        or len(label) > 63
        or label.startswith("-")
        or label.endswith("-")
        or not all(character.isalnum() or character == "-" for character in label)
        for label in host.split(".")
    ):
        raise _UnsafeWebTarget("invalid hostname")
    return host


def _allowed_hosts() -> frozenset[str]:
    raw_hosts = (entry for entry in settings.web_fetch_allowed_hosts.split(","))
    hosts: set[str] = set()
    for entry in raw_hosts:
        entry = entry.strip()
        if not entry:
            continue
        if entry == "*":
            hosts.add("*")  # 哨兵：放行任意公网 host（DNS 解析后仍强制公网 IP）
            continue
        hosts.add(_normalise_hostname(entry))
    return frozenset(hosts)


def _allowed_ports() -> frozenset[int]:
    ports: set[int] = set()
    for entry in settings.web_fetch_allowed_ports.split(","):
        if not entry.strip():
            continue
        try:
            port = int(entry.strip())
        except ValueError as exc:
            raise _UnsafeWebTarget("invalid outbound port configuration") from exc
        if not 1 <= port <= 65535:
            raise _UnsafeWebTarget("invalid outbound port configuration")
        ports.add(port)
    return frozenset(ports)


def _allowed_content_types() -> frozenset[str]:
    return frozenset(
        entry.strip().lower() for entry in settings.web_fetch_allowed_content_types.split(",") if entry.strip()
    )


def _validate_target(url: str, *, hosts: frozenset[str], ports: frozenset[int]) -> _WebTarget:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"}:
        raise _UnsafeWebTarget("only http and https are supported")
    if parsed.username is not None or parsed.password is not None:
        raise _UnsafeWebTarget("userinfo is not allowed")
    if not parsed.hostname:
        raise _UnsafeWebTarget("missing host")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise _UnsafeWebTarget("invalid port") from exc

    host = _normalise_hostname(parsed.hostname)
    if ("*" not in hosts and host not in hosts) or port not in ports:
        raise _UnsafeWebTarget("target is outside the outbound allowlist")

    netloc = host if port == (443 if parsed.scheme == "https" else 80) else f"{host}:{port}"
    return _WebTarget(
        url=urlunsplit((parsed.scheme, netloc, parsed.path or "/", parsed.query, "")),
        host=host,
        port=port,
    )


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return (
        address.is_global
        and not address.is_private
        and not address.is_loopback
        and not address.is_link_local
        and not address.is_multicast
        and not address.is_reserved
        and not address.is_unspecified
    )


async def _resolve_public_addresses(host: str, port: int) -> tuple[str, ...]:
    loop = asyncio.get_running_loop()
    records = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = tuple(dict.fromkeys(str(record[4][0]) for record in records))
    if not addresses or any(not _is_public_address(address) for address in addresses):
        raise _UnsafeWebTarget("hostname resolves to a non-public address")
    return addresses


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolve every new connection once, validate it, then connect to that exact IP."""

    def __init__(self) -> None:
        self._backend = httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        addresses = await _resolve_public_addresses(host, port)
        last_error: Exception | None = None
        for address in addresses:
            try:
                return await self._backend.connect_tcp(  # type: ignore[attr-defined]
                    address,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.NetworkError, httpcore.TimeoutException, OSError) as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise _UnsafeWebTarget("no approved address is reachable")

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise _UnsafeWebTarget("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(seconds)  # type: ignore[attr-defined]


class _CoreResponseStream(httpx.AsyncByteStream):
    def __init__(self, stream: AsyncIterator[bytes]) -> None:
        self._stream = stream

    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for chunk in self._stream:
            yield chunk

    async def aclose(self) -> None:
        aclose = getattr(self._stream, "aclose", None)
        if aclose is not None:
            await aclose()


class _PinnedAsyncHTTPTransport(httpx.AsyncBaseTransport):
    """HTTPX adapter whose connection pool cannot perform a second DNS lookup."""

    def __init__(self) -> None:
        self._pool = httpcore.AsyncConnectionPool(
            max_connections=10,
            max_keepalive_connections=0,
            keepalive_expiry=5.0,
            http1=True,
            http2=False,
            retries=0,
            network_backend=_PinnedNetworkBackend(),
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if not isinstance(request.stream, httpx.AsyncByteStream):
            raise TypeError("expected an async request stream")
        core_request = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=request.stream,
            extensions=request.extensions,
        )
        response = await self._pool.handle_async_request(core_request)
        return httpx.Response(
            status_code=response.status,
            headers=response.headers,
            stream=_CoreResponseStream(cast(AsyncIterator[bytes], response.stream)),
            extensions=response.extensions,
        )

    async def aclose(self) -> None:
        await self._pool.aclose()


def _build_client() -> httpx.AsyncClient:
    timeout = httpx.Timeout(
        connect=settings.web_fetch_connect_timeout_seconds,
        read=settings.web_fetch_read_timeout_seconds,
        write=settings.web_fetch_write_timeout_seconds,
        pool=settings.web_fetch_connect_timeout_seconds,
    )
    return httpx.AsyncClient(
        transport=_PinnedAsyncHTTPTransport(),
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
        headers={"Accept": "text/html, text/plain, application/json", "User-Agent": "ai-blog-web-tool/1.0"},
    )


async def _fetch_response(url: str) -> _FetchedResponse:
    hosts = _allowed_hosts()
    ports = _allowed_ports()
    if not hosts or not ports:
        raise _UnsafeWebTarget("outbound allowlist is not configured")

    target = _validate_target(url, hosts=hosts, ports=ports)
    max_redirects = settings.web_fetch_max_redirects
    async with _build_client() as client:
        for _ in range(max_redirects + 1):
            target = _validate_target(target.url, hosts=hosts, ports=ports)
            async with client.stream("GET", target.url) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise _UnsafeWebTarget("redirect without location")
                    target = _validate_target(str(response.url.join(location)), hosts=hosts, ports=ports)
                    continue
                if not 200 <= response.status_code < 300:
                    return _FetchedResponse(response.status_code, response.headers, b"")
                _validate_content_type(response.headers)
                body = await _read_limited(response)
                return _FetchedResponse(response.status_code, response.headers, body)
    raise _UnsafeWebTarget("too many redirects")


def _validate_content_type(headers: httpx.Headers) -> None:
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if not content_type or content_type not in _allowed_content_types():
        raise _UnsupportedContentType("response content type is not allowed")


async def _read_limited(response: httpx.Response) -> bytes:
    max_bytes = settings.web_fetch_max_response_bytes
    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except ValueError:
            declared_length = None
        if declared_length is not None and declared_length > max_bytes:
            raise _ResponseTooLarge("content length exceeds limit")

    chunks: list[bytes] = []
    received = 0
    async for chunk in response.aiter_bytes():
        received += len(chunk)
        if received > max_bytes:
            raise _ResponseTooLarge("response exceeds limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _decode_text(response: _FetchedResponse) -> str:
    content_type = response.headers.get("content-type", "")
    charset = "utf-8"
    for item in content_type.split(";")[1:]:
        key, separator, value = item.strip().partition("=")
        if separator and key.lower() == "charset" and value.strip():
            charset = value.strip().strip('"')
            break
    try:
        text = response.body.decode(charset, errors="replace")
    except LookupError:
        text = response.body.decode("utf-8", errors="replace")
    max_chars = settings.web_fetch_max_text_chars
    if len(text) > max_chars:
        return f"{text[:max_chars]}\n\n[内容已按字符上限截断]"
    return text


async def _consume_quota() -> bool:
    user_id = current_user_id_cv.get()
    assert user_id is not None
    async with async_session() as db:
        return await consume_web_tool_request(db, user_id) is not None


def _request_failure_message(exc: Exception) -> str:
    if isinstance(exc, _UnsafeWebTarget):
        return "无法访问该地址：仅允许公开的 HTTP(S) 站点。"
    if isinstance(exc, _ResponseTooLarge):
        return "无法读取该页面：响应超过允许的大小。"
    if isinstance(exc, _UnsupportedContentType):
        return "无法读取该页面：响应类型不在允许的文本类型内。"
    return "网络请求失败，请稍后重试或改用其他来源。"


@tool
@require_user
async def web_fetch(url: str) -> str:
    """读取公网网站的文本内容；仅支持 HTTP(S)，解析后 IP 必须为公网地址。"""
    if not await _consume_quota():
        return "今日 Web 工具调用额度已用完。"
    try:
        response = await _fetch_response(url)
    except (
        _UnsafeWebTarget,
        _ResponseTooLarge,
        _UnsupportedContentType,
        httpx.HTTPError,
        httpcore.NetworkError,
        httpcore.ProtocolError,
        httpcore.TimeoutException,
        OSError,
    ) as exc:
        return _request_failure_message(exc)
    if not 200 <= response.status_code < 300:
        return f"目标网站返回 HTTP {response.status_code}。"
    return _decode_text(response)


@tool
@require_user
async def web_search(query: str) -> str:
    """通过已配置的搜索服务检索公开网页；优先使用可用的 MCP 搜索工具。"""
    query = query.strip()
    if not query:
        return "请输入要搜索的关键词。"
    if not settings.web_search_endpoint:
        return "网络搜索尚未配置；可优先使用已挂载的 MCP 搜索工具。"
    if not await _consume_quota():
        return "今日 Web 工具调用额度已用完。"

    endpoint = urlsplit(settings.web_search_endpoint)
    params = [
        (key, value) for key, value in parse_qsl(endpoint.query, keep_blank_values=True) if key not in {"q", "format"}
    ]
    params.extend((("q", query), ("format", "json")))
    search_url = urlunsplit((endpoint.scheme, endpoint.netloc, endpoint.path, urlencode(params), ""))
    try:
        response = await _fetch_response(search_url)
    except (
        _UnsafeWebTarget,
        _ResponseTooLarge,
        _UnsupportedContentType,
        httpx.HTTPError,
        httpcore.NetworkError,
        httpcore.ProtocolError,
        httpcore.TimeoutException,
        OSError,
    ) as exc:
        return _request_failure_message(exc)
    if not 200 <= response.status_code < 300:
        return f"搜索服务返回 HTTP {response.status_code}。"

    try:
        payload = json.loads(_decode_text(response))
    except json.JSONDecodeError:
        return "搜索服务返回了无法解析的结果。"
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return "搜索服务未返回可用结果。"

    rendered: list[str] = []
    for result in results[: settings.web_search_max_results]:
        if not isinstance(result, dict):
            continue
        title = str(result.get("title") or "未命名结果").strip()
        result_url = str(result.get("url") or "").strip()
        snippet = str(result.get("content") or result.get("snippet") or "").strip()
        lines = [title]
        if result_url:
            lines.append(result_url)
        if snippet:
            lines.append(snippet)
        rendered.append("\n".join(lines))
    if not rendered:
        return "未找到结果。"
    return "搜索结果：\n\n" + "\n\n".join(f"{index}. {result}" for index, result in enumerate(rendered, start=1))
