"""聊天测试。"""

import inspect
import json
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
async def test_auto_mode_attaches_base_search_file_tool(monkeypatch):
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
        name = "blog_search_posts"

    class FakeChunk:
        content = "已回复"
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
        return 7, SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "add_message_pair", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    chunks = [
        chunk async for chunk in chat_service.stream_chat(
            "根据文件库中的资料总结一下",
            conversation_id=None,
            user_id=1,
        )
    ]

    assert "DONE" in "".join(chunks)
    assert "base_search_file" in captured["tool_names"]
    assert captured["agent_messages"][-1] == {"role": "user", "content": "根据文件库中的资料总结一下"}
    prompt_text = captured["prompt"]
    assert "base_search_file" in prompt_text
    assert "文件库" in prompt_text
    assert not any("[检索到的参考内容]" in m["content"] for m in captured["agent_messages"])


@pytest.mark.asyncio
async def test_normal_chat_context_excludes_research_tool_rules(monkeypatch):
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
        name = "blog_search_posts"

    class FakeChunk:
        content = "普通回复"
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
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "add_message_pair", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    chunks = [
        chunk async for chunk in chat_service.stream_chat(
            "随便聊聊",
            conversation_id=None,
            user_id=1,
            context={"page_type": "home"},
        )
    ]

    system_messages = [message["content"] for message in captured["agent_messages"] if message["role"] == "system"]
    normal_context = "\n".join(system_messages)

    assert "DONE" in "".join(chunks)
    assert captured["tool_names"] == ["blog_search_posts", "base_search_file"]
    assert "研究工具使用规则" not in normal_context
    assert not any(name.startswith("research_") for name in captured["tool_names"])


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
        name = "blog_search_posts"

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
    assert "研究工具使用规则" in trust_context
    assert "research_add_source 记录来源" in trust_context
    assert "research_add_evidence 保存可追溯原文证据片段" in trust_context
    assert "research_add_claim 抽取事实声明" in trust_context
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_input", "expected_start", "expected_delta"),
    [
        (
            {
                "post_id": 1,
                "target_text": "旧\"文本\n第二行",
                "replacement_text": "新文本\n第二行",
            },
            True,
            True,
        ),
        ({"post_id": 1, "target_text": "待删除文本", "replacement_text": ""}, True, False),
        ({"post_id": 1, "target_text": "旧文本"}, False, False),
    ],
)
async def test_blog_edit_patch_streams_from_model_tool_arguments(
    monkeypatch,
    tool_input,
    expected_start,
    expected_delta,
):
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

    class FakeBlogTool:
        name = "blog_edit_post"

    class FakeChunk:
        content = ""
        additional_kwargs = {}

        def __init__(self, tool_call_chunks):
            self.tool_call_chunks = tool_call_chunks

    args_text = json.dumps(tool_input, ensure_ascii=False)
    split_at = max(1, len(args_text) // 2)

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"index": 0, "name": "blog_edit_post", "args": args_text[:split_at]},
                    ]),
                },
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"index": 0, "name": None, "args": args_text[split_at:]},
                    ]),
                },
            }
            yield {
                "event": "on_tool_start",
                "name": "blog_edit_post",
                "data": {"input": tool_input},
            }
            yield {
                "event": "on_tool_end",
                "name": "blog_edit_post",
                "data": {"output": "文章修改完成"},
            }

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "add_message_pair", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([
        chunk async for chunk in chat_service.stream_chat(
            "修改文章",
            conversation_id=None,
            user_id=1,
        )
    ])

    tool_start_index = output.index('"status": "start"')
    tool_end_index = output.index('"status": "end"')
    assert tool_start_index < tool_end_index
    assert '"blog_patch"' not in output

    if expected_start:
        patch_start_index = output.index("PATCHSTART")
        assert patch_start_index < tool_start_index
        assert json.dumps({"target_text": tool_input["target_text"]}) in output
    else:
        assert "PATCHSTART" not in output

    if expected_delta:
        patch_delta_index = output.index("PATCHDELTA")
        assert patch_delta_index < tool_start_index
        assert json.dumps({"replacement_delta": tool_input["replacement_text"]}) in output
    else:
        assert "PATCHDELTA" not in output
