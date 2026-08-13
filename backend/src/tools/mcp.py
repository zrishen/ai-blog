"""将管理员定义、用户已启用的平台插件包装为 AI 可调用 MCP 工具。"""

import json
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool

from src.config import settings
from src.services.infra.plugins.mcp_client import tool_manager


def _parse_tools(raw_tools: Any) -> list[Any]:
    if raw_tools is None:
        return []
    if isinstance(raw_tools, str):
        try:
            parsed = json.loads(raw_tools)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return raw_tools if isinstance(raw_tools, list) else []


def normalize_mcp_capabilities(mcp_plugins: list[dict]) -> list[dict[str, object]]:
    """只为已发布且已由调用方筛选为“用户启用”的插件生成能力。"""
    capabilities: list[dict[str, object]] = []
    for plugin in mcp_plugins:
        if not plugin.get("is_published", True):
            continue
        plugin_slug = str(plugin.get("slug") or "").strip()
        plugin_name = str(plugin.get("name") or "").strip()
        if not plugin_slug or not plugin_name:
            continue
        for tool_info in _parse_tools(plugin.get("tools")):
            if isinstance(tool_info, str):
                tool_name = tool_info.strip()
                description = ""
                input_schema: dict[str, Any] = {"type": "object", "properties": {}}
            elif isinstance(tool_info, dict):
                tool_name = str(tool_info.get("name") or "").strip()
                description = str(tool_info.get("description") or "")
                schema = tool_info.get("input_schema") or tool_info.get("inputSchema")
                input_schema = schema if isinstance(schema, dict) else {"type": "object", "properties": {}}
            else:
                continue
            if not tool_name:
                continue
            capabilities.append(
                {
                    "plugin_id": plugin.get("id"),
                    "plugin_slug": plugin_slug,
                    "plugin_name": plugin_name,
                    "tool_name": tool_name,
                    "tool_ref": f"{plugin_slug}/{tool_name}",
                    "description": description,
                    "input_schema": input_schema,
                }
            )
    return capabilities


def format_mcp_capabilities(capabilities: list[dict[str, object]], limit: int = 4000) -> str:
    lines: list[str] = []
    for capability in capabilities:
        schema = json.dumps(capability.get("input_schema") or {}, ensure_ascii=False, separators=(",", ":"))
        description = str(capability.get("description") or "无描述")
        lines.append(f"- {capability['tool_ref']}：{description}\n  参数 schema：{schema}")
    text = "\n".join(lines)
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...（MCP 能力清单过长，已截断）"


def build_mcp_call_tool(mcp_plugins: list[dict], capabilities: list[dict[str, object]]) -> BaseTool:
    plugin_by_slug = {str(plugin.get("slug")): plugin for plugin in mcp_plugins if plugin.get("slug")}
    capability_by_ref = {str(capability["tool_ref"]): capability for capability in capabilities}
    capabilities_text = format_mcp_capabilities(capabilities)

    async def _mcp_call_tool(tool_ref: str, arguments: dict[str, Any]) -> str:
        if tool_ref not in capability_by_ref:
            return f"MCP 工具不在当前可用清单中：{tool_ref}。请只使用已列出的 tool_ref。"
        plugin_slug, _, tool_name = tool_ref.partition("/")
        if not plugin_slug or not tool_name:
            return f"MCP 工具引用格式错误：{tool_ref}。请使用 plugin_slug/tool_name。"
        plugin = plugin_by_slug.get(plugin_slug)
        if not plugin:
            return f"MCP 插件不存在或未启用：{plugin_slug}。"
        safe_arguments = arguments if isinstance(arguments, dict) else {}
        return await tool_manager.call_tool_lazy(
            plugin,
            tool_name,
            safe_arguments,
            timeout=settings.mcp_call_timeout_seconds,
        )

    description = (
        "调用当前用户已启用的平台 MCP 插件。只能使用下方清单中的 tool_ref，"
        "格式为 plugin_slug/tool_name；arguments 必须符合对应参数 schema。"
        "涉及外部实时信息、网页或第三方系统时，优先调用此工具，失败时如实说明。\n\n"
        f"当前可用 MCP 能力：\n{capabilities_text}"
    )
    return StructuredTool.from_function(
        coroutine=_mcp_call_tool,
        name="mcp_call_tool",
        description=description,
    )
