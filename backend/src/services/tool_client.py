"""MCP Client - 连接 MCP Server 子进程并调用工具。"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.session import ClientSession
from mcp.types import CallToolResult, TextContent

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


@asynccontextmanager
async def mcp_session(server_module: str = "src.services.mcp_server_tools"):
    """启动 MCP Server 子进程并建立 ClientSession。"""
    params = StdioServerParameters(
        command="python",
        args=["-m", server_module],
        cwd=str(_PROJECT_ROOT),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def list_available_tools(server_module: str = "src.services.mcp_server_tools") -> list:
    """从 MCP Server 获取工具列表。"""
    try:
        async with mcp_session(server_module) as session:
            result = await session.list_tools()
            tool_names = [t.name for t in result.tools]
            logger.info("MCP Server connected, tools: %s", tool_names)
            return result.tools
    except Exception as e:
        logger.error("Failed to connect to MCP Server '%s': %s", server_module, e)
        return []


async def call_tool(
    name: str,
    arguments: dict[str, Any],
    server_module: str = "src.services.mcp_server_tools",
    timeout: float = 30.0,
) -> str:
    """调用 MCP 工具并返回结果文本。"""
    logger.info("Calling tool '%s' on '%s' with args: %s", name, server_module, arguments)
    try:
        async with mcp_session(server_module) as session:
            result: CallToolResult = await asyncio.wait_for(
                session.call_tool(name, arguments), timeout=timeout
            )
            texts = [c.text for c in result.content if isinstance(c, TextContent)]
            response = "\n".join(texts)
            logger.info("Tool '%s' returned: %d chars", name, len(response))
            return response
    except asyncio.TimeoutError:
        logger.error("Tool '%s' timed out after %.0fs", name, timeout)
        raise
    except Exception as e:
        logger.error("Tool '%s' failed on '%s': %s", name, server_module, e)
        raise
