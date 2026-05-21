"""内建工具 MCP Server - 提供时间、天气、搜索工具。
可作为独立子进程运行: python -m src.services.mcp_server_tools"""

import json
import logging
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

logger = logging.getLogger(__name__)

server = Server("ai-tools")

# 工具定义
TOOLS: list[Tool] = [
    Tool(
        name="get_current_time",
        description="获取当前日期和时间（北京时间 UTC+8）",
        inputSchema={},
    ),
    Tool(
        name="get_weather",
        description="查询指定城市的当前天气",
        inputSchema={
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "城市名称，如 Beijing, Shanghai, London"},
            },
            "required": ["city"],
        },
    ),
    Tool(
        name="web_search",
        description="联网搜索获取信息",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
            },
            "required": ["query"],
        },
    ),
]


class _TitleExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


@server.list_tools()
async def list_tools() -> list[Tool]:
    """返回可用的工具列表"""
    logger.info("Returning %d tools to client", len(TOOLS))
    return TOOLS


def _get_current_time_sync() -> str:
    now = datetime.now(timezone.utc) + timedelta(hours=8)
    return now.strftime("%Y-%m-%d %H:%M:%S (UTC+8)")


async def _get_current_time() -> str:
    return _get_current_time_sync()


async def _get_weather(city: str) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"https://wttr.in/{city}?format=%c+%t")
        return f"{city}的天气: {resp.text.strip()}"


async def _web_search(query: str) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://html.duckduckgo.com/html/?q=" + query.replace(" ", "+"),
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
        )
        parser = _TitleExtractor()
        parser.feed(resp.text)
        title = parser.title.strip() if parser.title.strip() else "未找到结果"
        return f"搜索\"{query}\"的结果: {title}"


# 工具函数映射
TOOL_HANDLERS = {
    "get_current_time": lambda args: _get_current_time(),
    "get_weather": lambda args: _get_weather(args.get("city", "")),
    "web_search": lambda args: _web_search(args.get("query", "")),
}


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """处理工具调用请求"""
    logger.info("Tool called: %s with args: %s", name, arguments)
    handler = TOOL_HANDLERS.get(name)
    if not handler:
        logger.warning("Unknown tool: %s", name)
        return [TextContent(type="text", text=f"未知工具: {name}")]
    try:
        result = await handler(arguments or {})
        logger.info("Tool %s returned: %d chars", name, len(result))
        return [TextContent(type="text", text=str(result))]
    except Exception as e:
        logger.error("Tool %s failed: %s", name, e, exc_info=True)
        return [TextContent(type="text", text=f"工具执行失败: {e}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
