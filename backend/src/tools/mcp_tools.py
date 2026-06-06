import json
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool

from src.config import settings
from src.services.mcp.tool_client import tool_manager


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


def normalize_mcp_capabilities(mcp_servers: list[dict]) -> list[dict[str, object]]:
    capabilities: list[dict[str, object]] = []
    for server in mcp_servers:
        if not server.get("is_active", True):
            continue
        server_name = str(server.get("name") or "").strip()
        if not server_name:
            continue
        for tool_info in _parse_tools(server.get("tools")):
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
            capabilities.append({
                "server_id": server.get("id"),
                "server_name": server_name,
                "tool_name": tool_name,
                "tool_ref": f"{server_name}/{tool_name}",
                "description": description,
                "input_schema": input_schema,
            })
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


def build_mcp_call_tool(mcp_servers: list[dict], capabilities: list[dict[str, object]]) -> BaseTool:
    server_by_name = {str(server.get("name")): server for server in mcp_servers if server.get("name")}
    capability_by_ref = {str(capability["tool_ref"]): capability for capability in capabilities}
    capabilities_text = format_mcp_capabilities(capabilities)

    async def _mcp_call_tool(tool_ref: str, arguments: dict[str, Any]) -> str:
        if tool_ref not in capability_by_ref:
            return f"MCP 工具不在当前可用清单中：{tool_ref}。请只使用已列出的 tool_ref。"
        server_name, _, tool_name = tool_ref.partition("/")
        if not server_name or not tool_name:
            return f"MCP 工具引用格式错误：{tool_ref}。请使用 server_name/tool_name。"
        server = server_by_name.get(server_name)
        if not server:
            return f"MCP 服务不存在或未启用：{server_name}。"
        safe_arguments = arguments if isinstance(arguments, dict) else {}
        return await tool_manager.call_tool_lazy(
            server,
            tool_name,
            safe_arguments,
            timeout=settings.mcp_call_timeout_seconds,
        )

    description = (
        "调用当前用户已配置的外部 MCP 工具。只能使用下方清单中的 tool_ref，格式为 server_name/tool_name；"
        "arguments 必须符合对应参数 schema。涉及外部实时信息、网页、第三方系统数据或清单中的能力时，"
        "应调用此工具，不要编造结果；如果工具返回超时或失败，要如实告知用户。\n\n"
        f"当前可用 MCP 能力：\n{capabilities_text}"
    )
    return StructuredTool.from_function(
        coroutine=_mcp_call_tool,
        name="mcp_call_tool",
        description=description,
    )
