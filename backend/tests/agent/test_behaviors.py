"""第 4 seam 行为描述符单元测试：projector 状态机 + on_result handler + BEHAVIORS 装配。

把 orchestrator 原 tool_name if/elif 投射/解析逻辑封进 BlogWrite/EditProjector 与
handler 纯函数后，此处独立锁住其语义（BLOGSTART/PATCHSTART 一次性、增量 delta、
同 chunk fall-through、html 派生自 INPUT），与 orchestrator 解耦。
"""

from src.services.agent.streaming import (
    BlogEditProjector,
    BlogWriteProjector,
    _BLOGDELTA_MARKER,
    _BLOGSTART_MARKER,
    _PATCHDELTA_MARKER,
    _PATCHSTART_MARKER,
)
from src.services.agent.tool_behaviors import (
    BLOG_EDIT_BEHAVIOR,
    BLOG_WRITE_BEHAVIOR,
    BEHAVIORS,
    _blog_meta_handler,
    _mcp_refs_handler,
    _memory_refs_handler,
    _rag_refs_handler,
    _sidebar_handler,
)
from src.tools.behavior import ResultContext


# ── BlogWriteProjector ──

def test_blog_write_projector_no_post_id_returns_empty() -> None:
    proj = BlogWriteProjector()
    # post_id 未生成（无数字定界）→ 不投射，防误发 BLOGSTART
    assert proj.on_args('{"content":"hi"', "1:0") == []


def test_blog_write_projector_start_once_then_content_deltas() -> None:
    proj = BlogWriteProjector()
    sid = "1:0"
    # post_id 完整但 content 未到 → 仅 BLOGSTART（一次）
    out = proj.on_args('{"post_id":1,', sid)
    assert len(out) == 1
    assert out[0].startswith(_BLOGSTART_MARKER)
    assert '"post_id":1' in out[0]
    # content "hello" 到 → BLOGDELTA(hello)，不再 BLOGSTART
    out = proj.on_args('{"post_id":1,"content":"hello"', sid)
    assert len(out) == 1
    assert out[0].startswith(_BLOGDELTA_MARKER)
    assert '"content_delta":"hello"' in out[0]
    # 续 content → 仅增量 " world"
    out = proj.on_args('{"post_id":1,"content":"hello world"', sid)
    assert len(out) == 1
    assert '"content_delta":" world"' in out[0]


# ── BlogEditProjector ──

def test_blog_edit_projector_patchstart_then_delta() -> None:
    proj = BlogEditProjector()
    sid = "1:0"
    # target 非空 + replacement_text 键出现（值空）→ 仅 PATCHSTART
    out = proj.on_args('{"post_id":1,"target_text":"old","replacement_text":"', sid)
    assert len(out) == 1
    assert out[0].startswith(_PATCHSTART_MARKER)
    assert '"target_text":"old"' in out[0]
    # replacement 值到 "new" → PATCHDELTA(new)，PATCHSTART 不重发
    out = proj.on_args('{"post_id":1,"target_text":"old","replacement_text":"new"', sid)
    assert len(out) == 1
    assert out[0].startswith(_PATCHDELTA_MARKER)
    assert '"replacement_delta":"new"' in out[0]
    # 续 → 增量 "er"
    out = proj.on_args('{"post_id":1,"target_text":"old","replacement_text":"newer"', sid)
    assert len(out) == 1
    assert '"replacement_delta":"er"' in out[0]


def test_blog_edit_projector_patchstart_and_delta_same_chunk_fallthrough() -> None:
    # 一次 args 同时满足 PATCHSTART（target+键）+ replacement 非空 → 两 marker 都发
    proj = BlogEditProjector()
    out = proj.on_args('{"post_id":1,"target_text":"old","replacement_text":"new"', "1:0")
    assert len(out) == 2
    assert out[0].startswith(_PATCHSTART_MARKER)
    assert out[1].startswith(_PATCHDELTA_MARKER)
    assert '"replacement_delta":"new"' in out[1]


def test_blog_edit_projector_no_post_id_returns_empty() -> None:
    proj = BlogEditProjector()
    assert proj.on_args('{"target_text":"x"', "1:0") == []


# ── on_result handlers ──

def test_blog_meta_handler_extracts_meta() -> None:
    ctx = ResultContext(tool_name="blog_create_post", result_text="id=42, slug=hi", tool_input=None)
    assert _blog_meta_handler(ctx) == {
        "blog_meta": {"operation": "create_post", "post_id": 42, "slug": "hi"}
    }


def test_blog_meta_handler_no_fields_empty() -> None:
    ctx = ResultContext(tool_name="blog_create_post", result_text="nothing", tool_input=None)
    assert _blog_meta_handler(ctx) == {}


def test_sidebar_handler_html_from_input() -> None:
    ctx = ResultContext(tool_name="update_blog_sidebar", result_text="ok", tool_input={"html": "<div>"})
    assert _sidebar_handler(ctx) == {"blog_meta": {"html": "<div>"}}


def test_sidebar_handler_no_html_empty() -> None:
    ctx = ResultContext(tool_name="update_blog_sidebar", result_text="ok", tool_input=None)
    assert _sidebar_handler(ctx) == {}


def test_rag_refs_handler() -> None:
    ctx = ResultContext(
        tool_name="base_search_file",
        result_text="[来源 1]\n来源：x.txt\n",
        tool_input=None,
    )
    assert _rag_refs_handler(ctx) == {"references": [{"type": "rag", "source": "x.txt"}]}


def test_knowledge_graph_refs_use_rag_projection() -> None:
    ctx = ResultContext(
        tool_name="knowledge_query_graph",
        result_text="[来源 1]\n来源：graph\n",
        tool_input=None,
    )
    assert BEHAVIORS["knowledge_query_graph"].on_result(ctx) == {
        "references": [{"type": "rag", "source": "graph"}]
    }


def test_memory_refs_handler() -> None:
    ctx = ResultContext(
        tool_name="base_recall_memory",
        result_text="[来源 1]\n来源：m.pdf\n",
        tool_input=None,
    )
    assert _memory_refs_handler(ctx) == {"references": [{"type": "memory", "source": "m.pdf"}]}


def test_mcp_refs_handler() -> None:
    ctx = ResultContext(
        tool_name="mcp_call_tool",
        result_text="ok",
        tool_input={"tool_ref": "s/t"},
    )
    assert _mcp_refs_handler(ctx) == {"references": [{"type": "mcp", "server": "s", "tool": "t"}]}


# ── descriptor wiring ──

def test_behaviors_table_covers_all_side_effect_tools() -> None:
    for name in (
        "blog_create_post", "blog_write_post", "blog_edit_post", "blog_delete_post",
        "update_blog_sidebar", "base_search_file", "knowledge_query_graph", "base_recall_memory", "mcp_call_tool",
    ):
        assert name in BEHAVIORS, name


def test_blog_write_behavior_has_result_and_projector() -> None:
    assert BLOG_WRITE_BEHAVIOR.on_result is not None
    assert BLOG_WRITE_BEHAVIOR.stream_projector_factory is BlogWriteProjector


def test_blog_edit_behavior_has_result_and_projector() -> None:
    assert BLOG_EDIT_BEHAVIOR.on_result is not None
    assert BLOG_EDIT_BEHAVIOR.stream_projector_factory is BlogEditProjector


def test_read_only_tools_have_no_behavior() -> None:
    # blog_search_posts / blog_read_post 无副作用（无 meta/refs/投射）→ 不登记 behavior
    assert "blog_search_posts" not in BEHAVIORS
    assert "blog_read_post" not in BEHAVIORS
