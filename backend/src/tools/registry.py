"""工具注册表：静态领域工具的单一查表源（assemble_tools 内部用，orchestrator 不直连）。

TOOL_REGISTRY 按「现状装配顺序」定义——assemble_tools 遍历此 dict 保插入序，asm.tools 顺序
== 旧 agent_tools 顺序（行为等价）。新工具进 registry 或经 ToolProvider 动态产。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

from langchain_core.tools import BaseTool

from src.tools.blog import (
    blog_create_post,
    blog_delete_post,
    blog_edit_post,
    blog_read_post,
    blog_search_posts,
    blog_write_post,
    update_blog_sidebar,
)
from src.tools.file import base_search_file
from src.tools.knowledge import knowledge_query_graph
from src.tools.memory import base_recall_memory

if TYPE_CHECKING:
    from src.tools.provider import ToolContext


@dataclass(frozen=True)
class ToolSpec:
    tool: BaseTool
    gate: Callable[["ToolContext"], bool] | None = None
    tags: frozenset[str] = frozenset()  # skill 归属标签（"writing"/"base"）；skill required_tools = tool_names_by_tag(tag)


# tags：writing=写作 skill；base=通用底座（always required；知识库/记忆 skill 化时改 knowledge/memory + 建 skill）
_WRITING = frozenset({"writing"})
_KNOWLEDGE = frozenset({"knowledge"})
_MEMORY = frozenset({"memory"})

# 顺序 = 现状 agent_tools（blog_7 + base_search_file + base_recall_memory）；
# mcp_call_tool 经 McpToolProvider 在末尾追加（保现状序）
TOOL_REGISTRY: dict[str, ToolSpec] = {
    "blog_create_post": ToolSpec(blog_create_post, tags=_WRITING),
    "blog_write_post": ToolSpec(blog_write_post, tags=_WRITING),
    "blog_edit_post": ToolSpec(blog_edit_post, tags=_WRITING),
    "blog_delete_post": ToolSpec(blog_delete_post, tags=_WRITING),
    "blog_search_posts": ToolSpec(blog_search_posts, tags=_WRITING),
    "blog_read_post": ToolSpec(blog_read_post, tags=_WRITING),
    "update_blog_sidebar": ToolSpec(update_blog_sidebar, tags=_WRITING),
    "base_search_file": ToolSpec(base_search_file, tags=_KNOWLEDGE),
    "knowledge_query_graph": ToolSpec(
        knowledge_query_graph,
        gate=lambda c: c.feature_flags.memory_enabled,
        tags=_KNOWLEDGE,
    ),
    "base_recall_memory": ToolSpec(base_recall_memory, gate=lambda c: c.feature_flags.memory_enabled, tags=_MEMORY),
}


def tool_names_by_tag(tag: str) -> frozenset[str]:
    """按 tag 派生工具名集合——skill required_tools / WRITING_TOOL_NAMES 的唯一数据源（消灭多副本）。"""
    return frozenset(name for name, spec in TOOL_REGISTRY.items() if tag in spec.tags)
