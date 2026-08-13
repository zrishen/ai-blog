import json

import httpx
import pytest

from src.core.context import current_user_id_cv
from src.core.exceptions import OwnershipError
from src.tools import web


class _ResponseContext:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response

    async def __aenter__(self) -> httpx.Response:
        return self.response

    async def __aexit__(self, *_args) -> None:
        await self.response.aclose()


class _FakeClient:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self.responses = responses
        self.requests: list[tuple[str, str]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    def stream(self, method: str, url: str) -> _ResponseContext:
        self.requests.append((method, url))
        response = self.responses.pop(0)
        response.request = httpx.Request(method, url)
        return _ResponseContext(response)


@pytest.fixture
def outbound_policy(monkeypatch):
    monkeypatch.setattr(web.settings, "web_fetch_allowed_hosts", "search.example,example.com")
    monkeypatch.setattr(web.settings, "web_fetch_allowed_ports", "80,443")
    monkeypatch.setattr(
        web.settings,
        "web_fetch_allowed_content_types",
        "text/html,text/plain,application/json",
    )
    monkeypatch.setattr(web.settings, "web_fetch_max_response_bytes", 1_000)
    monkeypatch.setattr(web.settings, "web_fetch_max_text_chars", 1_000)
    monkeypatch.setattr(web.settings, "web_fetch_max_redirects", 2)


def test_validate_target_requires_exact_host_port_and_http(outbound_policy):
    hosts = web._allowed_hosts()
    ports = web._allowed_ports()

    assert web._validate_target("https://example.com/docs", hosts=hosts, ports=ports).url == (
        "https://example.com/docs"
    )
    for value in (
        "https://sub.example.com/docs",
        "https://example.com:444/docs",
        "file:///etc/passwd",
        "https://127.0.0.1/",
        "https://user@example.com/",
    ):
        with pytest.raises(web._UnsafeWebTarget):
            web._validate_target(value, hosts=hosts, ports=ports)


def test_non_public_addresses_are_rejected():
    assert web._is_public_address("8.8.8.8")
    for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"):
        assert not web._is_public_address(address)


def test_wildcard_hosts_allow_any_public_host_but_still_restrict_port_and_scheme(monkeypatch):
    monkeypatch.setattr(web.settings, "web_fetch_allowed_hosts", "*")
    hosts = web._allowed_hosts()
    ports = web._allowed_ports()

    assert web._validate_target("https://any.example.org/docs", hosts=hosts, ports=ports).url == (
        "https://any.example.org/docs"
    )
    for value in (
        "https://any.example.org:444/docs",  # 端口仍受限
        "file:///etc/passwd",  # 协议仍受限
        "https://127.0.0.1/",  # IP literal 仍被拒（公网解析防线在 _resolve_public_addresses）
        "https://user@example.org/",  # userinfo 仍被拒
    ):
        with pytest.raises(web._UnsafeWebTarget):
            web._validate_target(value, hosts=hosts, ports=ports)


@pytest.mark.asyncio
async def test_pinned_backend_connects_to_verified_ip(monkeypatch):
    class Backend:
        async def connect_tcp(self, host, port, **_kwargs):
            self.target = (host, port)
            return object()

        async def sleep(self, _seconds):
            return None

    async def resolve(_host, _port):
        return ("8.8.8.8",)

    pinned = web._PinnedNetworkBackend()
    fake_backend = Backend()
    pinned._backend = fake_backend
    monkeypatch.setattr(web, "_resolve_public_addresses", resolve)

    assert await pinned.connect_tcp("example.com", 443) is not None
    assert fake_backend.target == ("8.8.8.8", 443)


@pytest.mark.asyncio
async def test_fetch_revalidates_redirect_target(outbound_policy, monkeypatch):
    redirect = httpx.Response(302, headers={"location": "http://127.0.0.1/"})
    fake_client = _FakeClient([redirect])
    monkeypatch.setattr(web, "_build_client", lambda: fake_client)

    with pytest.raises(web._UnsafeWebTarget):
        await web._fetch_response("https://example.com/start")
    assert fake_client.requests == [("GET", "https://example.com/start")]


@pytest.mark.asyncio
async def test_fetch_enforces_content_type_and_response_limit(outbound_policy, monkeypatch):
    binary = httpx.Response(200, headers={"content-type": "image/png"}, content=b"image")
    too_large = httpx.Response(
        200,
        headers={"content-type": "text/plain", "content-length": "1001"},
        content=b"x",
    )
    fake_client = _FakeClient([binary, too_large])
    monkeypatch.setattr(web, "_build_client", lambda: fake_client)

    with pytest.raises(web._UnsupportedContentType):
        await web._fetch_response("https://example.com/a")
    with pytest.raises(web._ResponseTooLarge):
        await web._fetch_response("https://example.com/b")


@pytest.mark.asyncio
async def test_web_fetch_requires_authenticated_user():
    token = current_user_id_cv.set(None)
    try:
        with pytest.raises(OwnershipError):
            await web.web_fetch.ainvoke({"url": "https://example.com"})
    finally:
        current_user_id_cv.reset(token)


@pytest.mark.asyncio
async def test_web_search_renders_configured_json_response(outbound_policy, monkeypatch):
    payload = {"results": [{"title": "Example", "url": "https://example.com", "content": "Summary"}]}
    fake_client = _FakeClient(
        [httpx.Response(200, headers={"content-type": "application/json"}, content=json.dumps(payload))]
    )
    monkeypatch.setattr(web, "_build_client", lambda: fake_client)
    monkeypatch.setattr(web.settings, "web_search_endpoint", "https://search.example/search")
    monkeypatch.setattr(web.settings, "web_search_max_results", 5)

    async def consume_quota():
        return True

    monkeypatch.setattr(web, "_consume_quota", consume_quota)
    token = current_user_id_cv.set(1)
    try:
        result = await web.web_search.ainvoke({"query": "test query"})
    finally:
        current_user_id_cv.reset(token)

    assert "1. Example" in result
    assert "https://search.example/search?q=test+query&format=json" == fake_client.requests[0][1]
