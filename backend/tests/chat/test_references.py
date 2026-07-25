"""chat/references 引用与博客元数据提取单元测试。

锁住 orchestrator on_tool_end 用的两个纯解析器：从工具返回文本提取 RAG/MCP 引用、
从博客工具返回提取结构化元数据。此前仅靠 API 端到端间接覆盖。
注意：工具返回文本以空格分隔字段（正则 \\S+ 取值、rstrip 剥中英文标点）。
"""

import pytest

from src.services.chat.references import (
    _extract_blog_meta,
    _extract_references,
)


# ── _extract_references ──

def test_extract_references_rag_full() -> None:
    text = "来源：file.pdf 文件库：默认库 相关距离：0.32"
    assert _extract_references("base_search_file", text) == [
        {"type": "rag", "source": "file.pdf", "collection": "默认库", "distance": 0.32}
    ]


def test_extract_references_rag_minimal() -> None:
    assert _extract_references("base_search_file", "来源：x.txt") == [
        {"type": "rag", "source": "x.txt"}
    ]


def test_extract_references_rag_unknown_distance_skipped() -> None:
    text = "来源：x.txt 相关距离：unknown"
    assert _extract_references("base_search_file", text) == [
        {"type": "rag", "source": "x.txt"}
    ]


def test_extract_references_rag_no_source_returns_empty() -> None:
    assert _extract_references("base_search_file", "无来源信息") == []


def test_extract_references_mcp() -> None:
    refs = _extract_references("mcp_call_tool", "ok", {"tool_ref": "server1/tool_a"})
    assert refs == [{"type": "mcp", "server": "server1", "tool": "tool_a"}]


def test_extract_references_mcp_no_slash_returns_empty() -> None:
    assert _extract_references("mcp_call_tool", "ok", {"tool_ref": "noslash"}) == []


def test_extract_references_mcp_missing_input_returns_empty() -> None:
    assert _extract_references("mcp_call_tool", "ok", None) == []


def test_extract_references_unknown_tool_returns_empty() -> None:
    assert _extract_references("other_tool", "x") == []


# ── _extract_blog_meta ──

def test_extract_blog_meta_create_post_full() -> None:
    text = "create_post id=42, slug=hello, title=Hi, status=draft"
    assert _extract_blog_meta("blog_create_post", text) == {
        "operation": "create_post",
        "post_id": 42,
        "slug": "hello",
        "title": "Hi",
        "status": "draft",
    }


def test_extract_blog_meta_id_non_int_kept_as_str() -> None:
    assert _extract_blog_meta("blog_create_post", "id=abc") == {
        "operation": "create_post",
        "id": "abc",
    }


def test_extract_blog_meta_edit_post_id_and_slug() -> None:
    assert _extract_blog_meta("blog_edit_post", "id=7, slug=s") == {
        "operation": "edit_post",
        "post_id": 7,
        "slug": "s",
    }


def test_extract_blog_meta_delete_post() -> None:
    text = "delete_post id=9, slug=x, title=Old"
    assert _extract_blog_meta("blog_delete_post", text) == {
        "operation": "delete_post",
        "post_id": 9,
        "slug": "x",
        "title": "Old",
    }


def test_extract_blog_meta_unknown_tool_returns_none() -> None:
    assert _extract_blog_meta("blog_unknown", "id=1") is None


def test_extract_blog_meta_no_fields_returns_none() -> None:
    # 仅 operation、无任何字段命中 → meta 长度 1 → None
    assert _extract_blog_meta("blog_create_post", "no fields here") is None
