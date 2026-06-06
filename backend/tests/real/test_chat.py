"""真实聊天测试 — 调用 LLM API。"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_chat(client: AsyncClient):
    resp = await client.post("/api/chat", json={
        "content": "你好，请用一句话介绍自己",
        "conversation_id": None,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "content" in data
    assert len(data["content"]) > 0
    assert "conversation_id" in data
    assert "message_id" in data


@pytest.mark.asyncio
async def test_chat_stream(client: AsyncClient):
    resp = await client.post("/api/chat/stream", json={
        "content": "说一个字：好",
        "conversation_id": None,
    })
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    # 验证有数据返回
    body = resp.text
    assert len(body) > 0
