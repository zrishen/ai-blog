"""conversation_service CRUD 单元测试。

锁住对话/消息的持久化与隔离：列表只返回本人未删、获取/删除/改标题均校验归属、
消息按时间有序。此前这些函数仅靠 API 端到端间接覆盖，内部早返回与隔离分支无直接断言。
save_chat_turn 涉及全局 session + 附件 claim，留待后续。
"""

from datetime import datetime, timezone

import pytest

from src.database.models import Conversation, Message
from src.services.conversation.conversation_service import (
    _message_text,
    delete_conversation,
    get_conversation,
    get_messages,
    list_conversations,
    update_conversation_title,
)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _make_conv(db_session, *, user_id: int = 1, title: str = "T") -> Conversation:
    conv = Conversation(title=title, user_id=user_id, created_at=_now(), updated_at=_now())
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)
    return conv


async def test_list_conversations_only_own_active(db_session) -> None:
    a = await _make_conv(db_session, user_id=1, title="A")
    await _make_conv(db_session, user_id=2, title="B")  # 别人
    deleted = await _make_conv(db_session, user_id=1, title="C")
    deleted.deleted_at = _now()
    await db_session.commit()
    result = await list_conversations(user_id=1, session=db_session)
    assert [c.id for c in result] == [a.id]


async def test_get_conversation_ownership(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1)
    assert await get_conversation(conv.id, user_id=1, session=db_session) is not None
    assert await get_conversation(conv.id, user_id=2, session=db_session) is None  # 别人
    assert await get_conversation(9999, user_id=1, session=db_session) is None  # 不存在


async def test_delete_conversation_soft_delete(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1)
    await delete_conversation(conv.id, user_id=1, session=db_session)
    await db_session.commit()
    assert await get_conversation(conv.id, user_id=1, session=db_session) is None


async def test_delete_conversation_other_user_noop(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1)
    await delete_conversation(conv.id, user_id=2, session=db_session)  # 别人删不动
    await db_session.commit()
    assert await get_conversation(conv.id, user_id=1, session=db_session) is not None


async def test_delete_conversation_not_found_silent(db_session) -> None:
    # 不存在的对话静默返回（不抛异常）
    await delete_conversation(9999, user_id=1, session=db_session)


async def test_get_messages_ordered(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1)
    m1 = Message(conversation_id=conv.id, role="user", content="a", token_count=1, created_at=_now())
    m2 = Message(conversation_id=conv.id, role="assistant", content="b", token_count=1, created_at=_now())
    db_session.add_all([m1, m2])
    await db_session.commit()
    msgs = await get_messages(conv.id, user_id=1, session=db_session)
    assert [m.content for m in msgs] == ["a", "b"]


async def test_get_messages_conversation_not_found_empty(db_session) -> None:
    assert await get_messages(9999, user_id=1, session=db_session) == []


async def test_get_messages_other_user_empty(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1)
    db_session.add(Message(conversation_id=conv.id, role="user", content="x", token_count=1, created_at=_now()))
    await db_session.commit()
    assert await get_messages(conv.id, user_id=2, session=db_session) == []


async def test_update_conversation_title(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1, title="Old")
    await update_conversation_title(conv.id, user_id=1, title="New", session=db_session)
    await db_session.commit()
    await db_session.refresh(conv)
    assert conv.title == "New"


async def test_update_conversation_title_truncates_and_fallback(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1, title="Old")
    await update_conversation_title(conv.id, user_id=1, title="x" * 100, session=db_session)
    await db_session.commit()
    await db_session.refresh(conv)
    assert conv.title == "x" * 50  # 截断 50
    await update_conversation_title(conv.id, user_id=1, title="   ", session=db_session)
    await db_session.commit()
    await db_session.refresh(conv)
    assert conv.title == "New Chat"  # 空白兜底


async def test_update_conversation_title_other_user_noop(db_session) -> None:
    conv = await _make_conv(db_session, user_id=1, title="Old")
    await update_conversation_title(conv.id, user_id=2, title="Hacked", session=db_session)
    await db_session.commit()
    await db_session.refresh(conv)
    assert conv.title == "Old"


def test_message_text_variants() -> None:
    assert _message_text("hi") == "hi"
    assert _message_text(None) == ""
    assert _message_text(123) == "123"
    assert _message_text([{"type": "text", "text": "a"}, "b"]) == "ab"
    assert _message_text([{"type": "other"}]) == ""
