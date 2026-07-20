"""MCP Client — langchain-mcp-adapters 统一管理 stdio / streamable-http 工具。"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.tools import BaseTool
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.session import ClientSession

logger = logging.getLogger(__name__)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_STDIO_ENV_ALLOWLIST = {
    "PATH",
    "SystemRoot",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
}


def _build_stdio_env(env_vars: dict[str, str] | None = None) -> dict[str, str]:
    base_env = {key: os.environ[key] for key in _STDIO_ENV_ALLOWLIST if key in os.environ}
    return {**base_env, **(env_vars or {})}


class MCPToolManager:
    """统一管理所有 MCP 服务器连接的工具管理器。"""

    def __init__(self):
        self._client: MultiServerMCPClient | None = None
        self._tool_map: dict[str, BaseTool] = {}
        self._server_configs: dict[str, dict] = {}

    def _build_configs(self, servers: list[dict]) -> dict[str, dict]:
        configs: dict[str, dict] = {}
        for srv in servers:
            if not srv.get("is_active", True):
                continue
            server_name = srv.get("name")
            if not server_name:
                continue
            if srv.get("server_type") == "stdio":
                command = srv.get("command") or sys.executable
                if command == "python":
                    command = sys.executable
                configs[server_name] = {
                    "transport": "stdio",
                    "command": command,
                    "args": self._parse_json_field(srv.get("args"), []),
                    "env": _build_stdio_env(self._parse_json_field(srv.get("env_vars"), {})),
                    "cwd": str(_PROJECT_ROOT),
                }
            elif srv.get("server_type") == "streamable-http":
                url = srv.get("url")
                if not url:
                    logger.warning("Skipping streamable-http server '%s': no URL", server_name)
                    continue
                configs[server_name] = {
                    "transport": "streamable_http",
                    "url": url,
                }
        return configs

    async def call_tool_lazy(
        self,
        server: dict,
        tool_name: str,
        arguments: dict[str, Any],
        timeout: float = 30.0,
    ) -> str:
        server_name = server.get("name", "unknown")
        tool_ref = f"{server_name}/{tool_name}"
        configs = self._build_configs([server])
        if not configs:
            return f"MCP 服务配置无效：{tool_ref}。请检查该 MCP 服务配置。"

        try:
            logger.info("Lazy loading MCP tool: %s", tool_ref)
            client = MultiServerMCPClient(configs)
            tools = await asyncio.wait_for(client.get_tools(), timeout=timeout)
            tool_map = {t.name: t for t in tools}
            tool = tool_map.get(tool_name)
            if not tool:
                return f"MCP 工具不存在：{tool_ref}。请刷新 MCP 配置或重新添加服务。"
            result = await asyncio.wait_for(tool.ainvoke(arguments), timeout=timeout)
            return str(result)
        except asyncio.TimeoutError:
            logger.warning("MCP tool call timed out: %s", tool_ref)
            return f"MCP 工具调用超时：{tool_ref}。请检查该 MCP 服务是否启动正常。"
        except Exception as e:
            logger.error("MCP tool call failed: %s: %s", tool_ref, e, exc_info=True)
            return f"MCP 工具调用失败：{tool_ref}。错误：{e}"

    @staticmethod
    def _parse_json_field(value: Any, default: Any) -> Any:
        if value is None:
            return default
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value.split() if value.strip() else default
        return value


# ---------------------------------------------------------------------------
# MCP Server 工具发现（用于前端添加服务时自动发现工具）
# ---------------------------------------------------------------------------

async def discover_server_tools(
    server_type: str,
    command: str | None = None,
    args: list[str] | None = None,
    env_vars: dict[str, str] | None = None,
    url: str | None = None,
    timeout: float = 15.0,
) -> list[dict]:
    """连接 MCP Server 并发现工具列表。返回 [{name, description, input_schema}]。"""
    try:
        if server_type == "stdio":
            if not command:
                return []
            params = StdioServerParameters(
                command=command,
                args=args or [],
                cwd=str(_PROJECT_ROOT),
                env=_build_stdio_env(env_vars),
            )
            # 某些 MCP 服务器启动时会先打印提示文本（非 JSON-RPC），
            # 导致第一行解析失败。加短暂延迟 + 重试一次。
            last_exc = None
            for attempt in range(2):
                if attempt > 0:
                    await asyncio.sleep(1.0)
                try:
                    async with stdio_client(params) as (read, write):
                        async with ClientSession(read, write) as session:
                            await asyncio.wait_for(session.initialize(), timeout=timeout)
                            result = await asyncio.wait_for(session.list_tools(), timeout=timeout)
                    return [
                        {
                            "name": t.name,
                            "description": t.description or "",
                            "input_schema": t.inputSchema if isinstance(t.inputSchema, dict) else {"type": "object", "properties": {}},
                        }
                        for t in result.tools
                    ]
                except Exception as exc:
                    last_exc = exc
                    logger.warning("stdio tool discovery attempt %d/2 failed: %s", attempt + 1, exc)
                    continue
            # 两次都失败，抛出最后一次异常
            if last_exc:
                raise last_exc
        elif server_type == "streamable-http":
            if not url:
                return []
            from mcp.client.streamable_http import streamablehttp_client
            async with streamablehttp_client(url) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=timeout)
                    result = await asyncio.wait_for(session.list_tools(), timeout=timeout)
                    return [
                        {
                            "name": t.name,
                            "description": t.description or "",
                            "input_schema": t.inputSchema if isinstance(t.inputSchema, dict) else {"type": "object", "properties": {}},
                        }
                        for t in result.tools
                    ]
    except asyncio.TimeoutError:
        logger.error("Tool discovery timed out for %s server", server_type)
    except Exception as e:
        logger.error("Tool discovery failed for %s: %s", server_type, e, exc_info=True)
    return []


# 模块级单例
tool_manager = MCPToolManager()
