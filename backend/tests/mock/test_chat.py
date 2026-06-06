"""聊天测试。"""

import inspect
import logging
from types import SimpleNamespace

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_chat(client: AsyncClient):
    resp = await client.post("/api/chat", json={
        "content": "你好",
        "conversation_id": None,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["content"] == "你好！这是一个测试回复。"
    assert "DONE" not in data["content"]
    assert data["conversation_id"] == 1
    assert data["message_id"] == 1


@pytest.mark.asyncio
async def test_chat_stream(client: AsyncClient):
    resp = await client.post("/api/chat/stream", json={
        "content": "你好",
        "conversation_id": None,
    })
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


@pytest.mark.asyncio
async def test_build_messages_uses_empty_history_for_invalid_conversation(monkeypatch):
    from src.services import chat_service

    async def missing_conversation(conversation_id: int, user_id: int):
        return None

    async def get_messages_should_not_run(conversation_id: int, user_id: int):
        raise AssertionError("无效会话不应该继续读取消息历史")

    monkeypatch.setattr(chat_service, "get_conversation", missing_conversation)
    monkeypatch.setattr(chat_service, "get_messages", get_messages_should_not_run)

    messages, full_user_message, user_token_count = await chat_service._build_messages(
        "你好",
        conversation_id=999,
        user_id=1,
        user_image_url=None,
    )

    assert messages == [{"role": "user", "content": "你好"}]
    assert full_user_message == "你好"
    assert user_token_count > 0


@pytest.mark.asyncio
async def test_build_messages_has_no_rag_context_parameter(monkeypatch):
    from src.services import chat_service

    async def missing_conversation(conversation_id: int, user_id: int):
        return None

    monkeypatch.setattr(chat_service, "get_conversation", missing_conversation)

    signature = inspect.signature(chat_service._build_messages)
    assert "rag_context" not in signature.parameters

    messages, full_user_message, user_token_count = await chat_service._build_messages(
        "根据MDCN论文重写这个博客",
        conversation_id=999,
        user_id=1,
        user_image_url=None,
    )

    assert messages == [{"role": "user", "content": "根据MDCN论文重写这个博客"}]
    assert full_user_message == "根据MDCN论文重写这个博客"
    assert user_token_count > 0


@pytest.mark.asyncio
async def test_knowledge_mode_prefetches_knowledge_before_agent(monkeypatch):
    from src.services import chat_service

    captured = {}

    class FakeScalars:
        def all(self):
            return []

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, stmt):
            return FakeResult()

    class FakeKnowledgeTool:
        name = "search_knowledge_base"

        async def ainvoke(self, args):
            captured["knowledge_args"] = args
            return "[检索到的参考内容]\nMDCN 论文片段"

    class FakeBlogTool:
        name = "blog_list_posts"

    class FakeChunk:
        content = "已基于知识库回答"
        tool_call_chunks = []
        additional_kwargs = {}

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            captured["agent_messages"] = payload["messages"]
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk()}}

    def fake_create_react_agent(llm, tools, prompt):
        captured["tool_names"] = [tool.name for tool in tools]
        captured["prompt"] = prompt
        return FakeAgent()

    async def fake_add_message_pair(*args, **kwargs):
        captured["saved_user_content"] = args[2]
        return 7, SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "search_knowledge_base", FakeKnowledgeTool())
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "add_message_pair", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    chunks = [
        chunk async for chunk in chat_service.stream_chat(
            "根据MDCN论文重写这个博客",
            conversation_id=None,
            user_id=1,
            rag_mode="knowledge",
        )
    ]

    assert "DONE" in "".join(chunks)
    assert captured["knowledge_args"] == {"query": "根据MDCN论文重写这个博客"}
    assert "search_knowledge_base" in captured["tool_names"]
    assert captured["agent_messages"][-1] == {"role": "user", "content": "根据MDCN论文重写这个博客"}
    assert any(
        message["role"] == "system" and "[检索到的参考内容]" in message["content"]
        for message in captured["agent_messages"]
    )
    assert captured["saved_user_content"] == "根据MDCN论文重写这个博客"


@pytest.mark.asyncio
async def test_trust_writing_context_includes_choice_protocol(monkeypatch):
    from src.services import chat_service

    captured = {}

    class FakeScalars:
        def all(self):
            return []

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, stmt):
            return FakeResult()

    class FakeBlogTool:
        name = "blog_list_posts"

    class FakeResearchTool:
        name = "research_get_topic"

    class FakeChunk:
        content = "已给出研究写作建议"
        tool_call_chunks = []
        additional_kwargs = {}

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            captured["agent_messages"] = payload["messages"]
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk()}}

    def fake_create_react_agent(llm, tools, prompt):
        captured["tool_names"] = [tool.name for tool in tools]
        return FakeAgent()

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "RESEARCH_TOOLS", [FakeResearchTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "add_message_pair", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    chunks = [
        chunk async for chunk in chat_service.stream_chat(
            "下一步怎么研究？",
            conversation_id=None,
            user_id=1,
            context={"trust_writing_enabled": True, "research_topic_id": 3},
        )
    ]

    system_messages = [message["content"] for message in captured["agent_messages"] if message["role"] == "system"]
    trust_context = "\n".join(system_messages)

    assert "DONE" in "".join(chunks)
    assert "research_get_topic" in captured["tool_names"]
    assert "TrustChoicePayload" in trust_context
    assert "最多 1-4 个" in trust_context
    assert "同一个 choices 数组里允许 action 和 reply 混合" in trust_context
    assert "不要求返回“不选择”" in trust_context
    assert "不要求返回“请选择下一步：”" in trust_context


@pytest.mark.asyncio
async def test_reasoning_content_debug_log_is_aggregated(monkeypatch, caplog):
    from src.services import chat_service

    class FakeScalars:
        def all(self):
            return []

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, stmt):
            return FakeResult()

    class FakeChunk:
        content = ""
        tool_call_chunks = []

        def __init__(self, reasoning: str):
            self.additional_kwargs = {"reasoning_content": reasoning}

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk("用户")}}
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk("问题")}}
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk("分析")}}

    def fake_create_react_agent(llm, tools, prompt):
        return FakeAgent()

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "add_message_pair", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    caplog.set_level(logging.DEBUG, logger="src.services.chat_service")

    chunks = [
        chunk async for chunk in chat_service.stream_chat(
            "需要深度分析",
            conversation_id=None,
            user_id=1,
            thinking_mode="deep",
        )
    ]

    assert "reasoning_delta" in "".join(chunks)
    reasoning_logs = [record.getMessage() for record in caplog.records if "reasoning_content" in record.getMessage()]
    assert reasoning_logs == ["reasoning_content total: len=6, preview=用户问题分析"]
