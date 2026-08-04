"""工具结果解析：从工具返回文本提取引用信息、博客元数据，并自动关联研究上下文（orchestrator on_tool_end 调用）。"""

import logging
import re
from typing import Any

from src.database.session import async_session

logger = logging.getLogger(__name__)


def _extract_references(tool_name: str, result_text: str, tool_input: dict | None = None) -> list[dict[str, Any]]:
    """从工具返回结果中提取引用信息（RAG 来源 / MCP 服务）。"""
    refs: list[dict[str, Any]] = []
    if tool_name == "base_search_file":
        for block in re.split(r"(?=^\[来源\s+\d+\]\s*$)", result_text, flags=re.MULTILINE):
            source_m = re.search(r"^来源[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            if not source_m:
                continue
            ref: dict[str, Any] = {
                "type": "rag",
                "source": source_m.group(1).rstrip("，。"),
            }
            collection_m = re.search(r"^文件库[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            distance_m = re.search(r"^相关距离[：:]\s*(\S+)\s*$", block, flags=re.MULTILINE)
            if collection_m:
                ref["collection"] = collection_m.group(1).rstrip("，。")
            if distance_m and distance_m.group(1) != "unknown":
                try:
                    ref["distance"] = float(distance_m.group(1))
                except ValueError:
                    pass
            refs.append(ref)
    elif tool_name == "base_recall_memory":
        for block in re.split(r"(?=^\[来源\s+\d+\]\s*$)", result_text, flags=re.MULTILINE):
            source_m = re.search(r"^来源[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            if not source_m:
                continue
            source = source_m.group(1).rstrip("，。")
            kind_m = re.search(r"^记忆类型[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            distance_m = re.search(r"^相关距离[：:]\s*(\S+)\s*$", block, flags=re.MULTILINE)
            status_m = re.search(r"^有效状态[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            time_m = re.search(r"^时间[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            evidence_m = re.search(r"^证据[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            path_m = re.search(r"^图路径[：:]\s*(.+?)\s*$", block, flags=re.MULTILINE)
            ref: dict[str, Any] = {"type": "memory", "source": source}
            if kind_m:
                ref["kind"] = kind_m.group(1).rstrip("，。")
            if status_m:
                ref["status"] = status_m.group(1).rstrip("，。")
            if time_m and time_m.group(1) != "unknown":
                ref["time"] = time_m.group(1).rstrip("，。")
            if evidence_m:
                ref["evidence"] = evidence_m.group(1).rstrip("，。")
            if path_m:
                ref["path"] = path_m.group(1).rstrip("，。")
            if distance_m and distance_m.group(1) != "unknown":
                try:
                    ref["distance"] = float(distance_m.group(1))
                except ValueError:
                    pass
            refs.append(ref)
    elif tool_name == "mcp_call_tool" and tool_input:
        tool_ref = str(tool_input.get("tool_ref", ""))
        if "/" in tool_ref:
            server_name, tool_n = tool_ref.split("/", 1)
            refs.append({"type": "mcp", "server": server_name, "tool": tool_n})
    return refs


_BLOG_META_PATTERNS: dict[str, tuple[str, ...]] = {
    "blog_create_post": ("id", "slug", "title", "status"),
    "blog_write_post": ("id", "slug", "title", "status"),
    "blog_edit_post": ("id", "slug",),
    "blog_delete_post": ("id", "slug", "title"),
}


def _extract_blog_meta(tool_name: str, result_text: str) -> dict[str, object] | None:
    """从博客工具返回文本中提取结构化元数据。"""
    fields = _BLOG_META_PATTERNS.get(tool_name)
    if not fields:
        return None
    meta: dict[str, object] = {"operation": tool_name.removeprefix("blog_")}
    for field in fields:
        m = re.search(rf"\b{field}=(\S+)", result_text)
        if m:
            val: str = m.group(1).rstrip(",")
            if field == "id":
                try:
                    meta["post_id"] = int(val)
                except ValueError:
                    meta[field] = val
            else:
                meta[field] = val
    return meta if len(meta) > 1 else None


async def _auto_link_research_context_to_blog_post(
    blog_meta: dict[str, object] | None,
    research_topic_id: object,
    user_id: int,
    enabled: bool,
) -> dict[str, object] | None:
    if not enabled or not blog_meta:
        return None
    post_id = blog_meta.get("post_id")
    if not isinstance(post_id, int) or post_id <= 0:
        return None
    try:
        topic_id = int(research_topic_id or 0)
    except (TypeError, ValueError):
        return None
    if topic_id <= 0:
        return None

    from src.services.research import attach_adopted_claims_for_topic_to_post, attach_topic_to_post

    try:
        async with async_session() as session:
            topic_link = await attach_topic_to_post(session, post_id, topic_id, user_id)
            claim_count = await attach_adopted_claims_for_topic_to_post(
                session,
                post_id,
                topic_id,
                user_id,
                "AI 可信写作自动关联",
            )
    except Exception as exc:
        logger.warning("自动关联研究上下文到文章失败 post_id=%s topic_id=%s: %s", post_id, topic_id, exc)
        return {"topic_linked": False, "claim_linked_count": 0, "error": "auto_link_failed"}

    return {"topic_linked": bool(topic_link), "claim_linked_count": claim_count}
