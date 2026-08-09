"""chat/messages 消息组装单元测试。

锁住发给 LLM 的 messages 组装：附件文档块格式、image block 检测/过滤（视觉兜底）、
当前用户 content 的多 provider 构建（openai data-url / anthropic base64 source）、
以及 _build_messages 的 tool_calls 配对——OpenAI 要求 assistant 的每个 tool_call 必须有
对应 tool 消息，不完整序列必须跳过否则 400。配对/跳过逻辑此前仅靠 API 间接覆盖。
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from src.services.agent import messages as messages_module
from src.services.agent.chat_attachment_service import ChatAttachmentError
from src.services.agent.messages import (
    _attachment_document_block,
    _build_current_user_content,
    _build_messages,
    _has_image_blocks,
    _without_image_blocks,
)


def _attach(**kw) -> SimpleNamespace:
    defaults: dict = {
        "kind": "file",
        "attachment": SimpleNamespace(original_name="f", media_type="application/pdf"),
        "document_text": "",
        "extraction_truncated": False,
        "image_base64": None,
    }
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _msg(**kw) -> SimpleNamespace:
    defaults: dict = {"id": 1, "role": "user", "content": "x", "tool_calls": None, "tool_call_id": None}
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# ── 纯函数 ──

def test_attachment_document_block_includes_name_and_text() -> None:
    block = _attachment_document_block(
        _attach(attachment=SimpleNamespace(original_name="d.pdf"), document_text="内容")
    )
    assert "d.pdf" in block and "内容" in block and "截断" not in block


def test_attachment_document_block_truncated_marker() -> None:
    block = _attachment_document_block(_attach(extraction_truncated=True, document_text="x"))
    assert "截断" in block


def test_has_image_blocks() -> None:
    assert _has_image_blocks([{"content": [{"type": "image_url", "image_url": {}}]}]) is True
    assert _has_image_blocks([{"content": "text"}]) is False
    assert _has_image_blocks([{"content": [{"type": "text"}]}]) is False
    assert _has_image_blocks([]) is False


def test_without_image_blocks_filters_keeps_text_or_empty() -> None:
    msgs = [{"content": [{"type": "text", "text": "k"}, {"type": "image_url", "image_url": {}}]}]
    assert _without_image_blocks(msgs)[0]["content"] == [{"type": "text", "text": "k"}]
    assert _without_image_blocks([{"content": [{"type": "image_url"}]}])[0]["content"] == ""
    # 字符串 content 原样保留（返回副本）
    result = _without_image_blocks([{"content": "hi"}])
    assert result[0]["content"] == "hi"


def test_build_current_user_content_plain_text_returns_str() -> None:
    assert _build_current_user_content("hi", [], provider="openai") == "hi"


def test_build_current_user_content_file_attachment() -> None:
    result = _build_current_user_content(
        "msg",
        [_attach(kind="file", attachment=SimpleNamespace(original_name="d.pdf"), document_text="C")],
        provider="openai",
    )
    assert isinstance(result, list)
    assert result[0] == {"type": "text", "text": "msg"}
    assert "d.pdf" in result[1]["text"]


def test_build_current_user_content_image_openai_data_url() -> None:
    result = _build_current_user_content(
        "msg",
        [_attach(kind="image", image_base64="abc", attachment=SimpleNamespace(original_name="x.png", media_type="image/png"))],
        provider="openai",
    )
    img = next(b for b in result if b.get("type") == "image_url")
    assert img["image_url"]["url"] == "data:image/png;base64,abc"


def test_build_current_user_content_image_anthropic_source() -> None:
    result = _build_current_user_content(
        "msg",
        [_attach(kind="image", image_base64="abc", attachment=SimpleNamespace(original_name="x.png", media_type="image/png"))],
        provider="anthropic",
    )
    img = next(b for b in result if b.get("type") == "image")
    assert img["source"] == {"type": "base64", "media_type": "image/png", "data": "abc"}


def test_build_current_user_content_image_missing_base64_raises() -> None:
    with pytest.raises(ChatAttachmentError):
        _build_current_user_content(
            "msg",
            [_attach(kind="image", image_base64=None, attachment=SimpleNamespace(original_name="x.png", media_type="image/png"))],
            provider="openai",
        )


# ── _build_messages（mock 依赖）──


def _patch_deps(monkeypatch, *, conv=None, msgs=None, attachments=None) -> None:
    async def fake_get_conv(cid, uid):
        return conv

    async def fake_get_msgs(cid, uid):
        return msgs or []

    async def fake_prepare(db, *, message_ids, user_id):
        return attachments or {}

    @asynccontextmanager
    async def fake_session():
        class _S:
            async def commit(self):
                pass

        yield _S()

    monkeypatch.setattr(messages_module, "get_conversation", fake_get_conv)
    monkeypatch.setattr(messages_module, "get_messages", fake_get_msgs)
    monkeypatch.setattr(messages_module, "prepare_history_attachments", fake_prepare)
    monkeypatch.setattr(messages_module, "async_session", fake_session)


async def test_build_messages_new_conversation(monkeypatch) -> None:
    _patch_deps(monkeypatch)  # 无 conv / msgs
    built, full, tokens, _compact = await _build_messages("hello", None, user_id=1)
    assert built == [{"role": "user", "content": "hello"}]
    assert full == "hello"
    assert tokens > 0


async def test_build_messages_appends_history(monkeypatch) -> None:
    _patch_deps(monkeypatch, conv=SimpleNamespace(id=1), msgs=[
        _msg(id=1, role="user", content="q"),
        _msg(id=2, role="assistant", content="a"),
    ])
    built, _full, _tokens, _compact = await _build_messages("now", 1, user_id=1)
    assert [m["role"] for m in built] == ["user", "assistant", "user"]
    assert built[0]["content"] == "q"
    assert built[2]["content"] == "now"


async def test_build_messages_tool_calls_complete_pair_emitted(monkeypatch) -> None:
    _patch_deps(monkeypatch, conv=SimpleNamespace(id=1), msgs=[
        _msg(id=1, role="user", content="q"),
        _msg(id=2, role="assistant", content=None, tool_calls=[{"id": "tc1", "name": "search", "args": {"q": "x"}}]),
        _msg(id=3, role="tool", content="result", tool_call_id="tc1"),
    ])
    built, _full, _tokens, _compact = await _build_messages("now", 1, user_id=1)
    assert [m["role"] for m in built] == ["user", "assistant", "tool", "user"]
    assert built[1]["tool_calls"][0]["id"] == "tc1"
    assert built[1]["tool_calls"][0]["function"]["name"] == "search"
    assert built[2]["tool_call_id"] == "tc1"


async def test_build_messages_tool_calls_incomplete_skipped(monkeypatch) -> None:
    # assistant 带 tool_calls 但缺对应 tool 消息 → 整段跳过，避免 OpenAI 400
    _patch_deps(monkeypatch, conv=SimpleNamespace(id=1), msgs=[
        _msg(id=1, role="user", content="q"),
        _msg(id=2, role="assistant", content=None, tool_calls=[{"id": "tc1", "name": "search", "args": {}}]),
    ])
    built, _full, _tokens, _compact = await _build_messages("now", 1, user_id=1)
    assert [m["role"] for m in built] == ["user", "user"]  # 不完整 assistant 被跳过
