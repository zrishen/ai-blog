"""LangChain 工具统一导出。

按领域组织:
- blog: 博客文章 CRUD + 精准替换
- file: 文件库 RAG 检索
- mcp: 外部 MCP 能力调用
- research: 研究图谱(可信写作模式)

提示词(工具描述、system prompt)统一在 src/prompts.py。
"""

from src.tools.blog import BLOG_TOOLS, current_user_id_cv
from src.tools.file import RAG_TOOLS, base_search_file
from src.tools.mcp import build_mcp_call_tool, format_mcp_capabilities, normalize_mcp_capabilities
from src.tools.research import RESEARCH_TOOLS

__all__ = [
    "BLOG_TOOLS",
    "RAG_TOOLS",
    "RESEARCH_TOOLS",
    "current_user_id_cv",
    "base_search_file",
    "build_mcp_call_tool",
    "format_mcp_capabilities",
    "normalize_mcp_capabilities",
]
