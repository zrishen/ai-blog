"""公开聊天服务测试。"""

import pytest


@pytest.mark.asyncio
async def test_public_chat_does_not_send_invalid_reasoning_effort(monkeypatch):
    from src.services import public_chat_service

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
    from src.services import public_chat_service

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
