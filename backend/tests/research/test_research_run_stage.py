from datetime import datetime, timezone

import pytest

from src.database import engine as db_engine_module
from src.database.models import ResearchRun, ResearchTopic
from src.services import research_service
from tests.conftest import TestSessionLocal


@pytest.fixture(autouse=True)
def patch_session_factory(monkeypatch):
    monkeypatch.setattr(db_engine_module, "async_session", TestSessionLocal)


async def _seed_topic_and_run(stage: str):
    async with TestSessionLocal() as db:
        topic = ResearchTopic(title="测试主题", status="draft", user_id=1)
        db.add(topic)
        await db.commit()
        await db.refresh(topic)
        run = ResearchRun(
            topic_id=topic.id,
            user_id=1,
            idempotency_key=f"test-{topic.id}",
            status="running",
            started_at=datetime.now(timezone.utc).replace(tzinfo=None),
            progress_json=dict(research_service.DEFAULT_RUN_PROGRESS),
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return topic.id, run.id


class _FakeAgent:
    def __init__(self, events):
        self._events = events

    async def astream_events(self, payload, version, config=None):
        for event in self._events:
            yield event


def _patch_agent(monkeypatch, events):
    from src.services import chat_service
    monkeypatch.setattr(chat_service, "_chat_model_kwargs", lambda mode, llm_settings=None: {"api_key": "test-key"})
    monkeypatch.setattr(chat_service, "_create_llm", lambda kw, mode: object())
    monkeypatch.setattr(
        research_service,
        "create_react_agent",
        lambda llm, tools, prompt: _FakeAgent(events),
    )


@pytest.mark.asyncio
async def test_stage_completes_when_tool_called_but_no_table_rows_added(monkeypatch):
    topic_id, run_id = await _seed_topic_and_run("search_sources")

    events = [
        {"event": "on_tool_start", "name": "research_get_topic",
         "data": {"input": {"topic_id": topic_id}}, "run_id": "r1"},
        {"event": "on_tool_end", "name": "research_get_topic",
         "data": {"output": "研究主题: 测试主题"}, "run_id": "r1"},
    ]
    _patch_agent(monkeypatch, events)

    async with TestSessionLocal() as db:
        ok = await research_service._run_agent_stage(
            db, run_id, topic_id, 1, "search_sources", "instruction"
        )
        assert ok is True

        run = await db.get(ResearchRun, run_id)
        assert run.progress_json.get("search_sources") != "failed"
        assert await research_service._count_stage_output(
            db, "search_sources", topic_id, 1
        ) == 0


@pytest.mark.asyncio
async def test_stage_fails_when_no_tool_call_and_no_output(monkeypatch):
    topic_id, run_id = await _seed_topic_and_run("search_sources")

    _patch_agent(monkeypatch, events=[])  # 没有任何事件，连 tool_start 都没有

    async with TestSessionLocal() as db:
        ok = await research_service._run_agent_stage(
            db, run_id, topic_id, 1, "search_sources", "instruction"
        )
        assert ok is False

        run = await db.get(ResearchRun, run_id)
        assert run.progress_json.get("search_sources") == "failed"


@pytest.mark.asyncio
async def test_stage_fails_when_agent_stream_raises(monkeypatch):
    class _RaisingAgent:
        async def astream_events(self, payload, version, config=None):
            raise RuntimeError("agent crashed")
            yield  # pragma: no cover - 让 astream_events 成为 async generator

    from src.services import chat_service
    monkeypatch.setattr(chat_service, "_chat_model_kwargs", lambda mode, llm_settings=None: {"api_key": "test-key"})
    monkeypatch.setattr(chat_service, "_create_llm", lambda kw, mode: object())
    monkeypatch.setattr(
        research_service,
        "create_react_agent",
        lambda llm, tools, prompt: _RaisingAgent(),
    )

    topic_id, run_id = await _seed_topic_and_run("search_sources")

    async with TestSessionLocal() as db:
        ok = await research_service._run_agent_stage(
            db, run_id, topic_id, 1, "search_sources", "instruction"
        )
        assert ok is False

        run = await db.get(ResearchRun, run_id)
        assert run.progress_json.get("search_sources") == "failed"
