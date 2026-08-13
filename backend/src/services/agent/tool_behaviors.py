"""第 4 seam 实现：工具行为 handler + descriptor 单例 + BEHAVIORS 名表。

收编 orchestrator 原散落在 on_tool_end / on_chat_model_stream 里的 tool_name if/elif
副作用（blog_meta 抽取、refs 抽取、blog 流式投射）为纯函数 handler + projector 工厂。
orchestrator 把 BEHAVIORS 注入 assemble_tools，按 mounted names 过滤后填 asm.behaviors，
运行时按 descriptor.on_result / stream_projector_factory 通用分派。
"""

from __future__ import annotations

from src.services.agent.references import (
    _extract_blog_meta,
    _extract_mcp_refs,
    _extract_memory_refs,
    _extract_rag_refs,
)
from src.services.agent.streaming import BlogEditProjector, BlogWriteProjector
from src.tools.behavior import ResultContext, ToolBehaviorDescriptor


def _blog_meta_handler(ctx: ResultContext) -> dict:
    """blog_create/write/edit/delete：从返回文本抽 id/slug/title/status → blog_meta。"""
    meta = _extract_blog_meta(ctx.tool_name, ctx.result_text)
    return {"blog_meta": meta} if meta else {}


def _sidebar_handler(ctx: ResultContext) -> dict:
    """update_blog_sidebar：左栏 html 派生自 INPUT（非返回文本），回传前端即时渲染。"""
    html = ctx.tool_input.get("html") if isinstance(ctx.tool_input, dict) else None
    return {"blog_meta": {"html": html}} if html else {}


def _rag_refs_handler(ctx: ResultContext) -> dict:
    refs = _extract_rag_refs(ctx.result_text)
    return {"references": refs} if refs else {}


def _memory_refs_handler(ctx: ResultContext) -> dict:
    refs = _extract_memory_refs(ctx.result_text)
    return {"references": refs} if refs else {}


def _mcp_refs_handler(ctx: ResultContext) -> dict:
    refs = _extract_mcp_refs(ctx.tool_input)
    return {"references": refs} if refs else {}


BLOG_META_BEHAVIOR = ToolBehaviorDescriptor(on_result=_blog_meta_handler)
SIDEBAR_BEHAVIOR = ToolBehaviorDescriptor(on_result=_sidebar_handler)
RAG_REFS_BEHAVIOR = ToolBehaviorDescriptor(on_result=_rag_refs_handler)
MEMORY_REFS_BEHAVIOR = ToolBehaviorDescriptor(on_result=_memory_refs_handler)
MCP_REFS_BEHAVIOR = ToolBehaviorDescriptor(on_result=_mcp_refs_handler)
BLOG_WRITE_BEHAVIOR = ToolBehaviorDescriptor(on_result=_blog_meta_handler, stream_projector_factory=BlogWriteProjector)
BLOG_EDIT_BEHAVIOR = ToolBehaviorDescriptor(on_result=_blog_meta_handler, stream_projector_factory=BlogEditProjector)

# name → 行为描述符。key 与 TOOL_REGISTRY / mounted_tool_names 对齐；
# assemble_tools 按 mounted names 过滤此表填 asm.behaviors。
BEHAVIORS: dict[str, ToolBehaviorDescriptor] = {
    "blog_create_post": BLOG_META_BEHAVIOR,
    "blog_write_post": BLOG_WRITE_BEHAVIOR,
    "blog_edit_post": BLOG_EDIT_BEHAVIOR,
    "blog_delete_post": BLOG_META_BEHAVIOR,
    "update_blog_sidebar": SIDEBAR_BEHAVIOR,
    "base_search_file": RAG_REFS_BEHAVIOR,
    "knowledge_query_graph": RAG_REFS_BEHAVIOR,
    "base_recall_memory": MEMORY_REFS_BEHAVIOR,
    "mcp_call_tool": MCP_REFS_BEHAVIOR,
}
