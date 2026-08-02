from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import FileDocument, RagSource
from src.services.memory import jobs


@pytest.mark.asyncio
async def test_reconcile_removes_orphans_and_marks_missing_active_index_stale(
    db_session: AsyncSession,
    monkeypatch,
):
    document = FileDocument(
        collection_name="user_1_file",
        user_id="1",
        original_name="kept.pdf",
        file_path="kept.pdf",
        chunk_content="1 chunks",
        meta="",
    )
    db_session.add(document)
    await db_session.commit()
    await db_session.refresh(document)
    source = RagSource(
        user_id=1,
        resource_type="file",
        resource_id=document.id,
        index_status="active",
        collection_name="user_1_file",
    )
    db_session.add(source)
    await db_session.commit()

    removed = []
    reindexed = []

    async def list_resource_memory():
        return [{"user_id": 1, "resource_type": "file", "resource_id": 999}]

    async def delete_resource_memory(**kwargs):
        removed.append(kwargs)

    async def has_resource_memory(**kwargs):
        return False

    async def schedule_reindex(*args, **kwargs):
        reindexed.append(kwargs)

    monkeypatch.setattr(jobs.graph_store, "list_resource_memory", list_resource_memory)
    monkeypatch.setattr(jobs.graph_store, "delete_resource_memory", delete_resource_memory)
    monkeypatch.setattr(jobs.graph_store, "has_resource_memory", has_resource_memory)
    monkeypatch.setattr(jobs, "_schedule_reindex", schedule_reindex)

    assert await jobs.reconcile_orphans(db_session) == 2
    await db_session.refresh(source)
    assert source.index_status == "stale"
    assert source.error_message == "FalkorDB index is missing; reindex required"
    assert removed == [{"user_id": 1, "resource_type": "file", "resource_id": 999}]
    assert reindexed == [{"user_id": 1, "resource_type": "file", "resource_id": document.id}]


@pytest.mark.asyncio
async def test_decay_memories_returns_graph_count(monkeypatch):
    class Result:
        result_set = [[3]]

    captured = {}

    async def fake_write(cypher, params):
        captured["cypher"] = cypher
        captured["params"] = params
        return Result()

    monkeypatch.setattr(jobs.graph_store, "_write", fake_write)
    monkeypatch.setattr(jobs.graph_store, "_utcnow", lambda: datetime(2026, 8, 1, tzinfo=timezone.utc))

    assert await jobs.decay_memories() == 3
    assert "SET n.confidence" in captured["cypher"]
    assert "threshold" in captured["params"]
