"""工具结果解析：从工具返回文本提取引用（RAG/记忆/MCP）与博客元数据。

按来源拆成纯函数，由各工具的 ToolBehaviorDescriptor.on_result 选择调用。
"""

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def _extract_rag_refs(result_text: str) -> list[dict[str, Any]]:
    """base_search_file：按「[来源 N]」分块抽取 RAG 来源引用。"""
    refs: list[dict[str, Any]] = []
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
    return refs


def _extract_memory_refs(result_text: str) -> list[dict[str, Any]]:
    """base_recall_memory：按「[来源 N]」分块抽取记忆来源引用。"""
    refs: list[dict[str, Any]] = []
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
    return refs


def _extract_mcp_refs(tool_input: dict | None) -> list[dict[str, Any]]:
    """mcp_call_tool：从 tool_ref 解析 server/tool 引用（'server/tool' 形式）。"""
    if not tool_input:
        return []
    tool_ref = str(tool_input.get("tool_ref", ""))
    if "/" in tool_ref:
        server_name, tool_n = tool_ref.split("/", 1)
        return [{"type": "mcp", "server": server_name, "tool": tool_n}]
    return []


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
