"""公开聊天服务测试。"""

from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost, User


@pytest.mark.asyncio
async def test_public_chat_does_not_send_invalid_reasoning_effort(monkeypatch):
    from src.services.public_chat import public_chat_service

    captured = {}

    class FakeLLM:
        async def astream(self, messages):
            yield type("Chunk", (), {"content": "公开回复"})()

    def fake_create_llm(model_kwargs, thinking_mode):
        captured["kwargs"] = model_kwargs
        return FakeLLM()

    async def fake_landing_context(db):
        return "公开上下文"

    monkeypatch.setattr(public_chat_service, "_create_llm", fake_create_llm)
    monkeypatch.setattr(public_chat_service, "_landing_context", fake_landing_context)

    chunks = [chunk async for chunk in public_chat_service.public_stream_chat(object(), "你好")]

    assert chunks == ["公开回复"]
    assert captured["kwargs"].get("extra_body", {}).get("reasoning_effort") != "none"


@pytest.mark.asyncio
async def test_public_chat_strips_protocol_reasoning_markers(monkeypatch):
    from src.services.public_chat import public_chat_service

    class FakeLLM:
        async def astream(self, messages):
            yield type("Chunk", (), {"content": "公开"})()
            yield type("Chunk", (), {"content": '\x00REASONING\x00{"reasoning_delta":"内部思考"}'})()
            yield type("Chunk", (), {"content": '�REASONING�{"reasoning_delta":"残留思考"}'})()
            yield type("Chunk", (), {"content": "回复"})()

    def fake_create_llm(model_kwargs, thinking_mode):
        return FakeLLM()

    async def fake_landing_context(db):
        return "公开上下文"

    monkeypatch.setattr(public_chat_service, "_create_llm", fake_create_llm)
    monkeypatch.setattr(public_chat_service, "_landing_context", fake_landing_context)

    chunks = [chunk async for chunk in public_chat_service.public_stream_chat(object(), "你好")]
    content = "".join(chunks)

    assert content == "公开回复"
    assert "REASONING" not in content
    assert "reasoning_delta" not in content
    assert "\x00" not in content


def test_public_strip_keeps_remainder_for_marker_split_across_chunks():
    from src.services.public_chat.public_chat_service import _strip_public_protocol_markers

    # chunk 切在标记 JSON 中间：不截断，保留为 remainder 等下一 chunk
    clean, remainder = _strip_public_protocol_markers('TOOLDONE{"stat')
    assert clean == ""
    assert remainder == 'TOOLDONE{"stat'

    # 与下一 chunk 拼出完整 JSON 后整体清除，后续正常文本保留
    clean, remainder = _strip_public_protocol_markers(remainder + 'us":"ok"}后续文本')
    assert clean == "后续文本"
    assert remainder == ""


def test_public_strip_final_does_not_truncate_incomplete_marker():
    from src.services.public_chat.public_chat_service import _strip_public_protocol_markers

    # 流结束仍不完整的标记：作为普通文本输出，绝不丢弃后续内容
    clean, _ = _strip_public_protocol_markers('前文TOOLDONE{"不完整', final=True)
    assert "前文" in clean
    assert "TOOLDONE" in clean


@pytest.mark.asyncio
async def test_public_chat_context_excludes_deleted_posts(db_session: AsyncSession):
    from src.services.public_chat.public_chat_service import _user_public_context

    owner = User(username="public-context-user", password_hash="mock")
    db_session.add(owner)
    await db_session.commit()
    await db_session.refresh(owner)

    db_session.add_all([
        BlogPost(
            title="公开文章",
            slug="visible-post",
            content="公开内容",
            status="published",
            user_id=owner.id,
        ),
        BlogPost(
            title="已删文章",
            slug="deleted-post",
            content="不应进入上下文",
            status="published",
            user_id=owner.id,
            deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
    ])
    await db_session.commit()

    context = await _user_public_context(db_session, owner.username)
    deleted_context = await _user_public_context(db_session, owner.username, "deleted-post")

    assert context is not None
    assert "公开文章" in context
    assert "已删文章" not in context
    assert deleted_context is not None
    assert "已删文章" not in deleted_context
    assert "暂无公开文章" in deleted_context
