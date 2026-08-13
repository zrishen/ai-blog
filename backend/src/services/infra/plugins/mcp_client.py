"""平台插件内部使用的 MCP 客户端。

运行配置只来自 PlatformPlugin，不向普通用户暴露命令、URL 或环境变量入口。
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from langchain_mcp_adapters.client import MultiServerMCPClient
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

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


def _parse_json_field(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value.split() if value.strip() else default
    return value


class PlatformPluginToolManager:
    """按需连接已授权的单个插件，避免跨用户共享运行配置。"""

    def _build_configs(self, plugins: list[dict]) -> dict[str, dict]:
        configs: dict[str, dict] = {}
        for plugin in plugins:
            if not plugin.get("is_published", True):
                continue
            plugin_key = plugin.get("slug") or plugin.get("name")
            if not plugin_key:
                continue
            if plugin.get("transport") == "stdio":
                command = plugin.get("command")
                if not command:
                    logger.warning("Skipping stdio plugin '%s': no command", plugin_key)
                    continue
                configs[plugin_key] = {
                    "transport": "stdio",
                    "command": command,
                    "args": _parse_json_field(plugin.get("args"), []),
                    "env": _build_stdio_env(_parse_json_field(plugin.get("env_vars"), {})),
                    "cwd": str(_PROJECT_ROOT),
                }
            elif plugin.get("transport") == "streamable-http":
                url = plugin.get("url")
                if not url:
                    logger.warning("Skipping streamable-http plugin '%s': no URL", plugin_key)
                    continue
                configs[plugin_key] = {"transport": "streamable_http", "url": url}
        return configs

    async def call_tool_lazy(
        self,
        plugin: dict,
        tool_name: str,
        arguments: dict[str, Any],
        timeout: float = 30.0,
    ) -> str:
        plugin_key = plugin.get("slug") or plugin.get("name", "unknown")
        tool_ref = f"{plugin_key}/{tool_name}"
        configs = self._build_configs([plugin])
        if not configs:
            return f"插件配置无效：{tool_ref}。"
        try:
            client = MultiServerMCPClient(configs)  # type: ignore[arg-type]
            tools = await asyncio.wait_for(client.get_tools(), timeout=timeout)
            tool = {item.name: item for item in tools}.get(tool_name)
            if not tool:
                return f"插件工具不存在：{tool_ref}。"
            return str(await asyncio.wait_for(tool.ainvoke(arguments), timeout=timeout))
        except TimeoutError:
            logger.warning("Plugin tool call timed out: %s", tool_ref)
            return f"插件工具调用超时：{tool_ref}。"
        except Exception as exc:
            logger.error("Plugin tool call failed: %s: %s", tool_ref, exc, exc_info=True)
            return f"插件工具调用失败：{tool_ref}。错误：{exc}"


async def discover_plugin_tools(
    transport: str,
    command: str | None = None,
    args: list[str] | None = None,
    env_vars: dict[str, str] | None = None,
    url: str | None = None,
    timeout: float = 15.0,
) -> list[dict]:
    """由管理员保存或更新插件时发现其 MCP 工具清单。"""
    try:
        if transport == "stdio":
            if not command:
                return []
            params = StdioServerParameters(
                command=command,
                args=args or [],
                cwd=str(_PROJECT_ROOT),
                env=_build_stdio_env(env_vars),
            )
            last_exception = None
            for attempt in range(2):
                if attempt:
                    await asyncio.sleep(1)
                try:
                    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
                        await asyncio.wait_for(session.initialize(), timeout=timeout)
                        result = await asyncio.wait_for(session.list_tools(), timeout=timeout)
                    return [
                        {
                            "name": tool.name,
                            "description": tool.description or "",
                            "input_schema": tool.inputSchema
                            if isinstance(tool.inputSchema, dict)
                            else {"type": "object", "properties": {}},
                        }
                        for tool in result.tools
                    ]
                except Exception as exc:
                    last_exception = exc
                    logger.warning("stdio plugin discovery attempt %d/2 failed: %s", attempt + 1, exc)
            if last_exception:
                raise last_exception
        elif transport == "streamable-http":
            if not url:
                return []
            from mcp.client.streamable_http import streamablehttp_client

            async with streamablehttp_client(url) as (read, write, _), ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=timeout)
                result = await asyncio.wait_for(session.list_tools(), timeout=timeout)
            return [
                {
                    "name": tool.name,
                    "description": tool.description or "",
                    "input_schema": tool.inputSchema
                    if isinstance(tool.inputSchema, dict)
                    else {"type": "object", "properties": {}},
                }
                for tool in result.tools
            ]
    except TimeoutError:
        logger.error("Plugin tool discovery timed out for %s", transport)
    except Exception as exc:
        logger.error("Plugin tool discovery failed for %s: %s", transport, exc, exc_info=True)
    return []


tool_manager = PlatformPluginToolManager()
