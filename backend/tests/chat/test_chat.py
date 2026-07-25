"""聊天测试。"""

import inspect
import json
import logging
import re
from types import SimpleNamespace

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_chat(client: AsyncClient):
    resp = await client.post("/api/v1/chat", json={
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
    resp = await client.post("/api/v1/chat/stream", json={
        "content": "你好",
        "conversation_id": None,
    })
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


@pytest.mark.asyncio
async def test_build_messages_uses_empty_history_for_invalid_conversation(monkeypatch):
    from src.services.chat import messages
    from src.services.chat import orchestrator as chat_service

    async def missing_conversation(conversation_id: int, user_id: int):
        return None

    async def get_messages_should_not_run(conversation_id: int, user_id: int):
        raise AssertionError("无效会话不应该继续读取消息历史")

    monkeypatch.setattr(messages, "get_conversation", missing_conversation)
    monkeypatch.setattr(messages, "get_messages", get_messages_should_not_run)

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
    from src.services.chat import messages
    from src.services.chat import orchestrator as chat_service

    async def missing_conversation(conversation_id: int, user_id: int):
        return None

    monkeypatch.setattr(messages, "get_conversation", missing_conversation)

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
    from src.services.chat import orchestrator as chat_service

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
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
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
    from src.services.chat import orchestrator as chat_service

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
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
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
    from src.services.chat import orchestrator as chat_service

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
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "RESEARCH_TOOLS", [FakeResearchTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
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
    from src.services.chat import orchestrator as chat_service

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
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", fake_create_react_agent)
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    caplog.set_level(logging.DEBUG, logger="src.services.chat.orchestrator")

    chunks = [
        chunk async for chunk in chat_service.stream_chat(
            "需要深度分析",
            conversation_id=None,
            user_id=1,
            thinking_mode="deep",
        )
    ]

    assert "reasoning_delta" in "".join(chunks)
    reasoning_logs = [
        record.getMessage()
        for record in caplog.records
        if "[THINKING]" in record.getMessage() and "reasoning_content captured" in record.getMessage()
    ]
    assert reasoning_logs == ["[THINKING] reasoning_content captured: len=6"]


@pytest.mark.asyncio
async def test_selected_blog_context_is_injected_into_prompt_and_user_message(monkeypatch):
    from src.services.chat import orchestrator as chat_service

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
        name = "blog_edit_post"

    class FakeChunk:
        content = "已处理"
        tool_call_chunks = []
        additional_kwargs = {}

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            captured["messages"] = payload["messages"]
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk()}}

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([
        chunk async for chunk in chat_service.stream_chat(
            "请润色得更简洁",
            conversation_id=None,
            user_id=1,
            context={
                "page_type": "other",
                "post_id": 42,
                "post_title": "测试文章",
                "selected_text": "需要被润色的中文原文",
                "section_index": 2,
            },
        )
    ])

    system_text = "\n".join(message["content"] for message in captured["messages"] if message["role"] == "system")
    user_text = captured["messages"][-1]["content"]
    assert "DONE" in output
    assert "测试文章" in system_text
    assert "ID=42" in system_text
    assert "blog_edit_post" in system_text
    assert "第 2 节" in system_text
    assert user_text.startswith("请润色得更简洁")
    assert "需要被润色的中文原文" in user_text


@pytest.mark.asyncio
@pytest.mark.parametrize("split_positions", [
    (0.2, 0.5),
    (0.4, 0.7),
    (0.6, 0.9),
])
async def test_blog_edit_patch_streams_from_model_tool_arguments(monkeypatch, split_positions):
    from src.services.chat import orchestrator as chat_service

    tool_input = {
        "post_id": 1,
        "target_text": "旧文本",
        "replacement_text": "新文本",
    }

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
    a = max(1, int(len(args_text) * split_positions[0]))
    b = max(a + 1, int(len(args_text) * split_positions[1]))

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"index": 0, "name": "blog_edit_post", "args": args_text[:a]},
                    ]),
                },
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"index": 0, "name": None, "args": args_text[a:b]},
                    ]),
                },
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"index": 0, "name": None, "args": args_text[b:]},
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
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([
        chunk async for chunk in chat_service.stream_chat(
            "修改文章",
            conversation_id=None,
            user_id=1,
        )
    ])

    assert "PATCHSTART" in output
    assert "PATCHDELTA" in output
    assert '{"post_id":1,"stream_id":"1:0","target_text":"旧文本"}' in output
    assert '{"post_id":1,"stream_id":"1:0","replacement_delta":"新文本"}' in output
    assert output.count("TOOLDONE") >= 2


def test_partial_int_waits_for_json_number_delimiter():
    from src.services.chat.streaming import _extract_partial_int

    assert _extract_partial_int('{"post_id": 4', "post_id") is None
    assert _extract_partial_int('{"post_id": 42, "content": "', "post_id") == 42
    assert _extract_partial_int('{"post_id": 42}', "post_id") == 42


@pytest.mark.asyncio
async def test_blog_write_stream_carries_post_and_stream_identity(monkeypatch):
    from src.services.chat import orchestrator as chat_service

    tool_input = {
        "post_id": 42,
        "content": "## 新正文\n\n实时生成内容",
    }

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
        name = "blog_write_post"

    class FakeChunk:
        content = ""
        additional_kwargs = {}

        def __init__(self, tool_call_chunks):
            self.tool_call_chunks = tool_call_chunks

    args_text = json.dumps(tool_input, ensure_ascii=False)
    split_at = args_text.index('"content"') + len('"content": "## 新')

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": FakeChunk([{
                    "index": 0,
                    "name": "blog_write_post",
                    "args": args_text[:split_at],
                }])},
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": FakeChunk([{
                    "index": 0,
                    "name": None,
                    "args": args_text[split_at:],
                }])},
            }
            yield {"event": "on_tool_start", "name": "blog_write_post", "data": {"input": tool_input}}
            yield {
                "event": "on_tool_end",
                "name": "blog_write_post",
                "data": {"output": "文章已更新: id=42, slug=test, title=测试, status=draft"},
            }

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([
        chunk async for chunk in chat_service.stream_chat("重写文章", None, 1)
    ])

    assert 'BLOGSTART\x00{"post_id":42,"stream_id":"1:0"}' in output
    delta_payloads = [
        json.loads(match)
        for match in re.findall(r"BLOGDELTA\x00(\{[^\x00]+?\})(?=\x00|\n\n|$)", output)
    ]
    assert delta_payloads
    assert all(item["post_id"] == 42 and item["stream_id"] == "1:0" for item in delta_payloads)
    assert "".join(item["content_delta"] for item in delta_payloads) == tool_input["content"]


@pytest.mark.asyncio
async def test_tool_prep_emitted_and_stream_id_propagated(monkeypatch):
    from langchain_core.messages import AIMessage
    from src.services.chat import orchestrator as chat_service

    tool_input = {"post_id": 42, "content": "正文"}

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
        additional_kwargs = {}

        def __init__(self, tool_call_chunks):
            self.tool_call_chunks = tool_call_chunks

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            # 工具参数流式生成：首块带 name → 触发 TOOLPREP
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": FakeChunk([{
                    "index": 0,
                    "name": "blog_write_post",
                    "args": json.dumps(tool_input, ensure_ascii=False),
                }])},
            }
            # 本轮模型结束 → 建立 call_id ↔ stream_id
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="", tool_calls=[
                    {"id": "call-1", "name": "blog_write_post", "args": tool_input},
                ])},
            }
            yield {"event": "on_tool_start", "name": "blog_write_post",
                   "data": {"input": tool_input, "tool_call_id": "call-1"}}
            yield {"event": "on_tool_end", "name": "blog_write_post", "data": {"output": "已写入 id=42"}}

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([chunk async for chunk in chat_service.stream_chat("写文章", None, 1)])

    # 首个带 name 的工具分片触发 TOOLPREP，携带与文章预览一致的 stream_id，且只发一次
    assert output.count('TOOLPREP\x00{"tool_name":"blog_write_post","stream_id":"1:0"}') == 1
    # on_tool_start / on_tool_end 的 TOOLDONE payload 透传同一 stream_id
    assert re.search(r'"status":\s*"start".*?"stream_id":\s*"1:0"', output), output
    assert re.search(r'"status":\s*"end".*?"stream_id":\s*"1:0"', output), output


@pytest.mark.asyncio
async def test_blog_edit_patch_decodes_unicode_escapes_split_across_chunks(monkeypatch):
    from src.services.chat import orchestrator as chat_service

    tool_input = {
        "post_id": 1,
        "target_text": "旧文本\\n第二行",
        "replacement_text": "新文本😀",
    }

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

    args_text = json.dumps(tool_input, ensure_ascii=True)
    unicode_start = args_text.index("\\u", args_text.index('"target_text"'))
    split_points = [unicode_start + 1, unicode_start + 3, unicode_start + 6, len(args_text)]
    parts = []
    previous = 0
    for point in split_points:
        parts.append(args_text[previous:point])
        previous = point

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            for index, args in enumerate(parts):
                yield {
                    "event": "on_chat_model_stream",
                    "data": {"chunk": FakeChunk([{
                        "index": 0,
                        "name": "blog_edit_post" if index == 0 else None,
                        "args": args,
                    }])},
                }
            yield {"event": "on_tool_start", "name": "blog_edit_post", "data": {"input": tool_input}}
            yield {"event": "on_tool_end", "name": "blog_edit_post", "data": {"output": "文章修改完成"}}

    async def fake_add_message_pair(*args, **kwargs):
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [FakeBlogTool()])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_add_message_pair)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([
        chunk async for chunk in chat_service.stream_chat("修改文章", None, 1)
    ])

    assert json.dumps({
        "post_id": 1,
        "stream_id": "1:0",
        "target_text": tool_input["target_text"],
    }, ensure_ascii=False, separators=(",", ":")) in output
    assert json.dumps({
        "post_id": 1,
        "stream_id": "1:0",
        "replacement_delta": tool_input["replacement_text"],
    }, ensure_ascii=False, separators=(",", ":")) in output
    assert "u65e7" not in output


@pytest.mark.asyncio
async def test_round_protocol_streams_structured_text_and_confirms_final(monkeypatch):
    from langchain_core.messages import AIMessage
    from src.services.chat import orchestrator as chat_service

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
        tool_call_chunks = []
        additional_kwargs = {"reasoning_content": "分析"}

        def __init__(self, content):
            self.content = content

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk([
                {"type": "text", "text": "  保留"},
                {"type": "output_text", "text": "空白  "},
            ])}}
            yield {"event": "on_chat_model_end", "data": {"output": AIMessage(content="  保留空白  ")}}

    saved = {}

    async def fake_save_chat_turn(*args, **kwargs):
        saved["args"] = args
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_save_chat_turn)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([chunk async for chunk in chat_service.stream_chat("测试", None, 1)])

    assert "ROUNDDELTA" in output
    assert json.dumps({"round_id": 1, "delta": "  保留空白  "}) in output
    assert "ROUNDEND" in output
    assert '"classification": "final"' in output
    assert json.dumps("  保留空白  ") in output
    assert saved["args"][5] == "  保留空白  "
    assert "REASONING" in output


@pytest.mark.asyncio
async def test_vision_fallback_retries_without_images():
    from langchain_core.messages import AIMessage
    from src.services.chat import orchestrator as chat_service

    calls: list[list[dict]] = []

    class FakeAgent:
        def __init__(self, should_fail: bool):
            self.should_fail = should_fail

        async def astream_events(self, payload, version, config=None):
            calls.append(payload["messages"])
            if self.should_fail:
                raise RuntimeError("unknown variant `image_url`, expected `text`")
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="文字回答")},
            }

    created = 0

    def fake_create_react_agent(llm, tools, prompt):
        nonlocal created
        created += 1
        return FakeAgent(should_fail=created == 1)

    original = chat_service.create_react_agent
    chat_service.create_react_agent = fake_create_react_agent
    try:
        events = [
            event async for event in chat_service._astream_agent_with_vision_fallback(
                object(),
                [],
                "prompt",
                [{"role": "user", "content": [
                    {"type": "text", "text": "你好"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
                ]}],
                idle_timeout=1,
            )
        ]
    finally:
        chat_service.create_react_agent = original

    assert events[-1]["event"] == "on_chat_model_end"
    assert len(calls) == 2
    assert all(
        block.get("type") != "image_url"
        for block in calls[1][-1]["content"]
    )
    assert "当前模型不支持图片输入" in calls[1][-1]["content"][-1]["text"]


def test_build_current_user_content_formats_provider_images_and_documents():
    from src.services.chat import orchestrator as chat_service
    from src.services.chat.chat_attachment_service import PreparedChatAttachment

    image = SimpleNamespace(
        attachment_id="image-id",
        original_name="image.png",
        media_type="image/png",
        size_bytes=4,
    )
    document = SimpleNamespace(
        attachment_id="file-id",
        original_name="notes.txt",
        media_type="text/plain",
        size_bytes=5,
    )
    attachments = [
        PreparedChatAttachment(
            attachment=image,
            position=0,
            kind="image",
            image_base64="YWJjZA==",
        ),
        PreparedChatAttachment(
            attachment=document,
            position=1,
            kind="file",
            document_text="hello",
            extraction_truncated=True,
        ),
    ]

    openai_content = chat_service._build_current_user_content(
        "问题",
        attachments,
        provider="openai",
        legacy_image_url=None,
    )
    assert openai_content[1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/png;base64,YWJjZA=="},
    }
    assert "附件开始：notes.txt" in openai_content[2]["text"]
    assert "附件内容已按上下文预算截断" in openai_content[2]["text"]

    anthropic_content = chat_service._build_current_user_content(
        "问题",
        attachments,
        provider="anthropic",
        legacy_image_url=None,
    )
    assert anthropic_content[1] == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "YWJjZA==",
        },
    }


@pytest.mark.asyncio
async def test_empty_final_is_confirmed_and_saved(monkeypatch):
    from langchain_core.messages import AIMessage
    from src.services.chat import orchestrator as chat_service

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
        content = "不得提升的残余文本"
        tool_call_chunks = []
        additional_kwargs = {}

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk()}}
            yield {"event": "on_chat_model_end", "data": {"output": AIMessage(content="")}}

    saved = []

    async def fake_save_chat_turn(*args, **kwargs):
        saved.append(args)
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_save_chat_turn)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([chunk async for chunk in chat_service.stream_chat("测试", None, 1)])

    assert '"classification": "final"' in output
    assert '"text": ""' in output
    assert len(saved) == 1


@pytest.mark.asyncio
async def test_empty_agent_stream_emits_error_and_does_not_save(monkeypatch):
    from src.services.chat import orchestrator as chat_service

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

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            if False:
                yield None

    async def save_should_not_run(*args, **kwargs):
        raise AssertionError("空模型流不应保存消息")

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", save_should_not_run)

    output = "".join([chunk async for chunk in chat_service.stream_chat("测试", None, 1)])

    assert "STREAMERROR" in output
    error_payload = json.loads(output.split("\0STREAMERROR\0", 1)[1].split("\n\n", 1)[0])
    assert "模型未返回最终回复" in error_payload["message"]
    assert '"message_id": 0' in output


@pytest.mark.asyncio
async def test_stream_error_discards_unconfirmed_round_and_does_not_save(monkeypatch):
    from src.services.chat import orchestrator as chat_service

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
        content = "未确认残余"
        tool_call_chunks = []
        additional_kwargs = {}

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {"event": "on_chat_model_stream", "data": {"chunk": FakeChunk()}}
            raise RuntimeError("boom")

    async def save_should_not_run(*args, **kwargs):
        raise AssertionError("异常流不应保存假 final")

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", save_should_not_run)

    output = "".join([chunk async for chunk in chat_service.stream_chat("测试", None, 1)])

    assert "ROUNDDELTA" in output
    assert "STREAMERROR" in output
    assert '"classification": "final"' not in output


@pytest.mark.asyncio
async def test_parallel_tool_events_use_stable_call_ids(monkeypatch):
    from langchain_core.messages import AIMessage
    from src.services.chat import orchestrator as chat_service

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

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            calls = [
                {"id": "call-a", "name": "same_tool", "args": {"value": "a"}},
                {"id": "call-b", "name": "same_tool", "args": {"value": "b"}},
            ]
            yield {"event": "on_chat_model_end", "data": {"output": AIMessage(content="先调用", tool_calls=calls)}}
            yield {"event": "on_tool_start", "run_id": "run-b", "name": "same_tool", "data": {"input": {"value": "b"}}}
            yield {"event": "on_tool_start", "run_id": "run-a", "name": "same_tool", "data": {"input": {"value": "a"}}}
            yield {"event": "on_tool_end", "run_id": "run-a", "name": "same_tool", "data": {"output": "A"}}
            yield {"event": "on_tool_end", "run_id": "run-b", "name": "same_tool", "data": {"output": "B"}}
            yield {"event": "on_chat_model_end", "data": {"output": AIMessage(content="完成")}}

    saved = {}

    async def fake_save_chat_turn(*args, **kwargs):
        saved["process"] = args[4]
        saved["events"] = kwargs["final_tool_events"]
        return 7, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr("src.database.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(chat_service, "BLOG_TOOLS", [])
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda llm, tools, prompt: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_save_chat_turn)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *args, **kwargs: None)

    output = "".join([chunk async for chunk in chat_service.stream_chat("测试", None, 1)])

    assert '"call_id": "call-a"' in output
    assert '"call_id": "call-b"' in output
    assert all(event["round_id"] == 1 for event in saved["events"])
    assert all(event["loop_step_index"] == 0 for event in saved["events"])
    tool_messages = [message for message in saved["process"] if hasattr(message, "tool_call_id")]
    assert [(message.tool_call_id, message.content) for message in tool_messages] == [
        ("call-a", "A"),
        ("call-b", "B"),
    ]
