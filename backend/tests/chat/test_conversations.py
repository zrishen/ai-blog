"""对话管理测试。"""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import ChatAttachment, Message, User
from src.main import app
from src.utils.auth import get_current_user


@pytest.mark.asyncio
async def test_create_conversation(client: AsyncClient):
    resp = await client.post("/api/v1/conversations", json={"title": "测试对话"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "测试对话"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_list_conversations(client: AsyncClient):
    # 先创建一个
    await client.post("/api/v1/conversations", json={"title": "对话1"})

    resp = await client.get("/api/v1/conversations")
    assert resp.status_code == 200
    data = resp.json()
    assert "conversations" in data
    assert len(data["conversations"]) >= 1


@pytest.mark.asyncio
async def test_delete_conversation(client: AsyncClient):
    # 创建
    create_resp = await client.post("/api/v1/conversations", json={"title": "待删除"})
    conv_id = create_resp.json()["id"]

    # 删除
    resp = await client.delete(f"/api/v1/conversations/{conv_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_get_messages(client: AsyncClient):
    # 创建对话
    create_resp = await client.post("/api/v1/conversations", json={"title": "有消息"})
    conv_id = create_resp.json()["id"]

    # 获取消息（应该为空）
    resp = await client.get(f"/api/v1/conversations/{conv_id}/messages")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_conversations_are_scoped_by_current_user(client: AsyncClient):
    async def user_a():
        return User(id=101, username="user-a", password_hash="mock")

    async def user_b():
        return User(id=202, username="user-b", password_hash="mock")

    original_override = app.dependency_overrides.get(get_current_user)
    try:
        app.dependency_overrides[get_current_user] = user_a
        create_resp = await client.post("/api/v1/conversations", json={"title": "A 用户对话"})
        assert create_resp.status_code == 200
        conv_id = create_resp.json()["id"]

        list_a_resp = await client.get("/api/v1/conversations")
        assert list_a_resp.status_code == 200
        assert any(c["id"] == conv_id for c in list_a_resp.json()["conversations"])

        app.dependency_overrides[get_current_user] = user_b
        list_b_resp = await client.get("/api/v1/conversations")
        assert list_b_resp.status_code == 200
        assert all(c["id"] != conv_id for c in list_b_resp.json()["conversations"])

        messages_b_resp = await client.get(f"/api/v1/conversations/{conv_id}/messages")
        assert messages_b_resp.status_code == 200
        assert messages_b_resp.json() == []
    finally:
        if original_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = original_override


@pytest.mark.asyncio
async def test_get_messages_hides_tool_messages_but_keeps_db_history(
    client: AsyncClient,
    db_session: AsyncSession,
):
    create_resp = await client.post("/api/v1/conversations", json={"title": "工具调用历史"})
    assert create_resp.status_code == 200
    conv_id = create_resp.json()["id"]

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add_all([
        Message(
            conversation_id=conv_id,
            role="user",
            content="帮我修改文章",
            token_count=1,
            created_at=now,
        ),
        Message(
            conversation_id=conv_id,
            role="assistant",
            content="我已经帮你修改好了。",
            token_count=1,
            created_at=now,
        ),
        Message(
            conversation_id=conv_id,
            role="assistant",
            content="",
            tool_calls=[{"id": "call_123", "name": "blog_patch_post", "args": {"id": 93}}],
            token_count=0,
            created_at=now,
        ),
        Message(
            conversation_id=conv_id,
            role="tool",
            content="文章已精准修改: id=93, slug=test, title=测试",
            tool_call_id="call_123",
            token_count=0,
            created_at=now,
        ),
    ])
    await db_session.commit()

    resp = await client.get(f"/api/v1/conversations/{conv_id}/messages")

    assert resp.status_code == 200
    data = resp.json()
    assert [item["role"] for item in data] == ["user", "assistant"]
    assert [item["content"] for item in data] == ["帮我修改文章", "我已经帮你修改好了。"]
    serialized = str(data)
    assert "文章已精准修改" not in serialized
    assert "blog_patch_post" not in serialized
    assert "tool_call_id" not in serialized

    result = await db_session.execute(select(Message).where(Message.conversation_id == conv_id))
    persisted_messages = result.scalars().all()
    assert len(persisted_messages) == 4
    assert any(message.role == "tool" for message in persisted_messages)
    assert any(message.tool_calls for message in persisted_messages)


@pytest.mark.asyncio
async def test_get_messages_keeps_regular_user_and_assistant_history(
    client: AsyncClient,
    db_session: AsyncSession,
):
    create_resp = await client.post("/api/v1/conversations", json={"title": "普通历史"})
    assert create_resp.status_code == 200
    conv_id = create_resp.json()["id"]

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add_all([
        Message(
            conversation_id=conv_id,
            role="user",
            content="你好",
            token_count=1,
            created_at=now,
        ),
        Message(
            conversation_id=conv_id,
            role="assistant",
            content="你好，有什么可以帮你？",
            token_count=1,
            created_at=now,
        ),
    ])
    await db_session.commit()

    resp = await client.get(f"/api/v1/conversations/{conv_id}/messages")

    assert resp.status_code == 200
    data = resp.json()
    assert [item["role"] for item in data] == ["user", "assistant"]
    assert [item["content"] for item in data] == ["你好", "你好，有什么可以帮你？"]


@pytest.mark.asyncio
async def test_get_messages_returns_ordered_chat_attachments(
    client: AsyncClient,
    db_session: AsyncSession,
):
    create_resp = await client.post("/api/v1/conversations", json={"title": "附件历史"})
    conv_id = create_resp.json()["id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    message = Message(
        conversation_id=conv_id,
        role="user",
        content="请读取附件",
        token_count=1,
        created_at=now,
    )
    db_session.add(message)
    await db_session.flush()
    db_session.add_all([
        ChatAttachment(
            attachment_id="00000000-0000-4000-8000-000000000002",
            user_id=1,
            message_id=message.id,
            original_name="second.txt",
            stored_path="1/second.txt",
            media_type="text/plain",
            size_bytes=2,
            position=1,
            status="attached",
            expires_at=now,
            attached_at=now,
            created_at=now,
            updated_at=now,
        ),
        ChatAttachment(
            attachment_id="00000000-0000-4000-8000-000000000001",
            user_id=1,
            message_id=message.id,
            original_name="first.png",
            stored_path="1/first.png",
            media_type="image/png",
            size_bytes=1,
            position=0,
            status="attached",
            expires_at=now,
            attached_at=now,
            created_at=now,
            updated_at=now,
        ),
    ])
    await db_session.commit()

    response = await client.get(f"/api/v1/conversations/{conv_id}/messages")

    assert response.status_code == 200
    attachments = response.json()[0]["attachments"]
    assert [item["original_name"] for item in attachments] == ["first.png", "second.txt"]
    assert attachments[0]["kind"] == "image"
    assert attachments[1]["kind"] == "file"
