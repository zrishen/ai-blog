"""compact 上下文压缩测试。

覆盖：
- estimate_history_tokens / _message_text / select_to_summarize 纯函数
- compact_history：阈值不触发、摘要+持久化、无新消息（增量）短路
- _build_messages：摘要失败兜底、摘要成功注入 system 摘要 + 保留 recent
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from src.services.chat.compact import (
    _message_text,
    compact_history,
    estimate_history_tokens,
    select_to_summarize,
)
from src.services.chat.messages import _build_messages
from src.services.chat import messages as messages_module


def _msg(**kw) -> SimpleNamespace:
    defaults: dict = {
        "id": 1,
        "role": "user",
        "content": "x",
        "tool_calls": None,
        "tool_call_id": None,
    }
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# ── 纯函数 ──


def test_message_text_extracts_str_list_and_none():
    assert _message_text("hi") == "hi"
    assert _message_text([{"type": "text", "text": "a"}, {"type": "output_text", "text": "b"}]) == "ab"
    assert _message_text(None) == ""
    assert _message_text([{"type": "image_url", "image_url": {}}]) == ""


def test_estimate_history_tokens_sums_each_message():
    msgs = [
        _msg(content="你好世界"),  # CJK → ~2
        _msg(content=[{"type": "text", "text": "hello"}]),
        _msg(content=None),
    ]
    assert estimate_history_tokens(msgs) > 0


def test_select_to_summarize_filters_already_summarized_incrementally():
    raw = [_msg(id=i) for i in range(1, 8)]  # id 1..7
    conv = SimpleNamespace(summary_until_message_id=3)
    # recent_count=3 → head = id1..4，>3 → 仅 id4
    selected = select_to_summarize(raw, conv, recent_count=3)
    assert [m.id for m in selected] == [4]


def test_select_to_summarize_no_prior_summary_takes_whole_head():
    raw = [_msg(id=i) for i in range(1, 6)]
    conv = SimpleNamespace(summary_until_message_id=None)
    selected = select_to_summarize(raw, conv, recent_count=2)
    assert [m.id for m in selected] == [1, 2, 3]


# ── compact_history ──


@pytest.mark.asyncio
async def test_compact_history_below_threshold_is_noop(db_session):
    from src.database.models import Conversation

    conv = Conversation(title="t", user_id=1)
    db_session.add(conv)
    await db_session.commit()

    async def summarizer(old, msgs):  # pragma: no cover - 不应被调用
        raise AssertionError("阈值未超不应调用 summarizer")

    raw = [_msg(id=1, content="短"), _msg(id=2, content="短")]
    out, usage = await compact_history(db_session, conv, raw, summarizer, threshold=10000, recent_count=1)
    assert out is raw
    assert usage is None
    assert conv.summary is None


@pytest.mark.asyncio
async def test_compact_history_summarizes_and_persists(db_session):
    from src.database.models import Conversation, Message

    conv = Conversation(title="t", user_id=1)
    db_session.add(conv)
    await db_session.commit()

    long_text = "字" * 500
    for i in range(15):
        db_session.add(
            Message(conversation_id=conv.id, role="user" if i % 2 else "assistant", content=long_text)
        )
    await db_session.commit()
    raw = list((await db_session.execute(select(Message).order_by(Message.id))).scalars().all())

    captured: dict = {}

    async def summarizer(old, to_summarize):
        captured["old"] = old
        captured["ids"] = [m.id for m in to_summarize]
        return "这是新摘要", {
            "input_tokens": 100,
            "output_tokens": 20,
            "reasoning_tokens": 0,
            "total_tokens": 120,
        }

    out, usage = await compact_history(db_session, conv, raw, summarizer, threshold=10, recent_count=12)

    # usage 透传
    assert usage == {
        "input_tokens": 100,
        "output_tokens": 20,
        "reasoning_tokens": 0,
        "total_tokens": 120,
    }
    # 返回最近 12 条原文
    assert len(out) == 12
    # 只摘要 15 - 12 = 3 条新消息（id 1/2/3），old_summary 初始为 None
    assert captured["old"] is None
    assert captured["ids"] == [1, 2, 3]
    # 持久化到 Conversation（db_session.get 返回同一对象，identity map）
    assert conv.summary == "这是新摘要"
    assert conv.summary_until_message_id == raw[2].id


@pytest.mark.asyncio
async def test_compact_history_no_new_messages_returns_raw(db_session):
    from src.database.models import Conversation

    # summary_until_message_id 已超过所有消息 id → 无新消息可摘要
    conv = Conversation(title="t", user_id=1, summary_until_message_id=100)
    db_session.add(conv)
    await db_session.commit()
    raw = [_msg(id=1, content="x"), _msg(id=2, content="y")]

    async def summarizer(old, msgs):  # pragma: no cover - 不应被调用
        raise AssertionError("无新消息不应调用 summarizer")

    out, usage = await compact_history(db_session, conv, raw, summarizer, threshold=1, recent_count=1)
    assert out is raw
    assert usage is None


# ── _build_messages 集成 compact ──


def _patch_build_deps(monkeypatch, *, conv, msgs):
    async def fake_get_conv(cid, uid):
        return conv

    async def fake_get_msgs(cid, uid):
        return msgs

    async def fake_prepare(db, *, message_ids, user_id):
        return {}

    @asynccontextmanager
    async def fake_session():
        class _S:
            async def get(self, model, id):
                # 模拟 attach：返回一个可变 conv（按 id 查），独立于传入的 conv
                return SimpleNamespace(id=id, summary=None, summary_until_message_id=None)

            async def commit(self):
                pass

        yield _S()

    monkeypatch.setattr(messages_module, "get_conversation", fake_get_conv)
    monkeypatch.setattr(messages_module, "get_messages", fake_get_msgs)
    monkeypatch.setattr(messages_module, "prepare_history_attachments", fake_prepare)
    monkeypatch.setattr(messages_module, "async_session", fake_session)


@pytest.mark.asyncio
async def test_build_messages_compact_fallback_on_summarizer_error(monkeypatch):
    # 历史足够长触发 compact，但 summarizer 抛异常 → 兜底回退全 raw，不崩，compact_usage None
    conv = SimpleNamespace(id=1, summary=None, summary_until_message_id=None)
    msgs = [_msg(id=i, role="user", content="字" * 200) for i in range(1, 20)]
    _patch_build_deps(monkeypatch, conv=conv, msgs=msgs)

    async def bad_summarizer(old, to_summarize):
        raise RuntimeError("boom")

    built, full, tokens, compact_usage = await _build_messages(
        "now",
        1,
        user_id=1,
        compact_summarizer=bad_summarizer,
        compact_threshold=10,
        compact_recent_count=5,
    )

    assert compact_usage is None
    assert built[-1] == {"role": "user", "content": "now"}
    # 兜底回退全 raw，未生成摘要 system 消息
    assert not any(m["role"] == "system" for m in built)
    # 全部 19 条历史 + current
    assert len(built) == 20


@pytest.mark.asyncio
async def test_build_messages_compact_success_injects_summary_and_keeps_recent(monkeypatch):
    conv = SimpleNamespace(id=1, summary=None, summary_until_message_id=None)
    msgs = [_msg(id=i, role="user", content="字" * 200) for i in range(1, 20)]
    _patch_build_deps(monkeypatch, conv=conv, msgs=msgs)

    async def good_summarizer(old, to_summarize):
        assert old is None
        return "这是历史摘要", {
            "input_tokens": 50,
            "output_tokens": 10,
            "reasoning_tokens": 0,
            "total_tokens": 60,
        }

    built, full, tokens, compact_usage = await _build_messages(
        "now",
        1,
        user_id=1,
        compact_summarizer=good_summarizer,
        compact_threshold=10,
        compact_recent_count=5,
    )

    # compact 真实 usage 透传
    assert compact_usage == {
        "input_tokens": 50,
        "output_tokens": 10,
        "reasoning_tokens": 0,
        "total_tokens": 60,
    }
    # 摘要作为 system 消息插入到最前
    assert built[0]["role"] == "system"
    assert "这是历史摘要" in built[0]["content"]
    # 保留最近 5 条原文 + current user
    user_msgs = [m for m in built if m["role"] == "user"]
    assert len(user_msgs) == 6  # 5 recent + 1 current
    assert built[-1] == {"role": "user", "content": "now"}
