"""stream_chat 订阅接入集成测试：平台 key 选择 + 真实 usage 事后扣配额。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage


@pytest.mark.asyncio
async def test_stream_chat_charges_subscription_platform_key(monkeypatch):
    from src.config import settings
    from src.services.chat import orchestrator as chat_service

    # 订阅有效 + 平台 key 有值（避免 missing key 拒绝）
    monkeypatch.setattr(chat_service, "should_use_platform_key", AsyncMock(return_value=True))
    monkeypatch.setattr(settings, "openai_api_key", "test-platform-key")

    charged: list[tuple[int, int]] = []

    async def fake_consume(db, uid, tokens, **kw):
        charged.append((uid, tokens))

    monkeypatch.setattr(chat_service, "consume_tokens", fake_consume)

    class _Scalars:
        def all(self):
            return []

    class _Result:
        def scalars(self):
            return _Scalars()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, stmt):
            return _Result()

        async def get(self, model, id):
            return None

    class FakeAgent:
        async def astream_events(self, payload, version, config=None):
            yield {"event": "on_chat_model_stream", "data": {"chunk": AIMessage(content="hi")}}
            yield {
                "event": "on_chat_model_end",
                "data": {
                    "output": AIMessage(
                        content="hi",
                        usage_metadata={
                            "input_tokens": 10,
                            "output_tokens": 5,
                            "reasoning_tokens": 0,
                            "total_tokens": 15,
                        },
                    )
                },
            }

    async def fake_save(*args, **kwargs):
        return 1, SimpleNamespace(id=6), SimpleNamespace(id=8)

    monkeypatch.setattr(chat_service, "async_session", lambda: FakeSession())
    # 1.2 起工具由 assemble_tools 装配，不再 mock BLOG_TOOLS
    monkeypatch.setattr(chat_service, "_create_llm", lambda model_kwargs, thinking_mode: object())
    monkeypatch.setattr(chat_service, "create_react_agent", lambda *a, **kw: FakeAgent())
    monkeypatch.setattr(chat_service, "save_chat_turn", fake_save)
    monkeypatch.setattr(chat_service, "update_conversation_title", lambda *a, **kw: None)

    output = ""
    async for chunk in chat_service.stream_chat("hi", None, 1):
        output += chunk

    # 真实 usage 10+5+0=15 被扣（user_id=1）
    assert charged == [(1, 15)]
    assert "final" in output  # 正常完成
