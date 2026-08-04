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
async def test_reindex_all_delegates_to_memory_embedding_service(monkeypatch):
    expected = jobs.memory_embeddings.EmbeddingIndexReport(embedded=3)
    captured = {}

    async def reindex_all(**kwargs):
        captured.update(kwargs)
        return expected

    monkeypatch.setattr(jobs.memory_embeddings, "reindex_all", reindex_all)

    result = await jobs.reindex_all(
        user_id=7,
        kinds=["fact", "episode"],
        batch_size=4,
        force=True,
    )

    assert result is expected
    assert captured == {
        "user_id": 7,
        "kinds": ["fact", "episode"],
        "batch_size": 4,
        "force": True,
    }


def test_reindex_cli_requires_explicit_scope():
    parser = jobs._build_cli_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["reindex-all"])
    with pytest.raises(SystemExit):
        parser.parse_args(["reindex-all", "--user-id", "0"])
    with pytest.raises(SystemExit):
        parser.parse_args(["reindex-all", "--all-users", "--batch-size", "-1"])
    assert parser.parse_args(["reindex-all", "--user-id", "7"]).user_id == 7
    assert parser.parse_args(["reindex-all", "--all-users", "--kind", "fact"]).kinds == ["fact"]


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


class _FakeResult:
    def __init__(self, rows):
        self.result_set = rows


@pytest.mark.asyncio
async def test_decay_memories_skips_protected_nodes(monkeypatch):
    """decay 只降未保护节点：cypher 必须含 NOT COALESCE(n.protected, false) 跳过 brain 手动修正的记忆。"""
    captured = {}

    async def fake_write(cypher, params):
        captured["cypher"] = cypher
        return _FakeResult([[0]])

    monkeypatch.setattr(jobs.graph_store, "_write", fake_write)
    monkeypatch.setattr(
        jobs.graph_store, "_utcnow", lambda: datetime(2026, 8, 1, tzinfo=timezone.utc)
    )

    await jobs.decay_memories()
    assert "COALESCE(n.protected, false)" in captured["cypher"]  # protected 节点不衰减


@pytest.mark.asyncio
async def test_merge_same_as_dry_run_counts_sources_without_writes(monkeypatch):
    """dry_run 只统计 SAME_AS 源数量，不执行任何写。"""
    writes = []

    async def fake_read(cypher, params):
        return _FakeResult([["src-1", "canon-1", 7], ["src-2", "canon-2", 7]])

    async def fake_write(cypher, params):
        writes.append((cypher, params))

    monkeypatch.setattr(jobs.graph_store, "_read", fake_read)
    monkeypatch.setattr(jobs.graph_store, "_write", fake_write)

    result = await jobs.merge_same_as(user_id=7, dry_run=True)
    assert result == {"mode": "dry_run", "source_nodes": 2}
    assert writes == []


@pytest.mark.asyncio
async def test_merge_same_as_redirects_edges_merges_props_and_deletes_source(monkeypatch):
    """execute：每个源节点重定向 5 入边 + 1 出边、合并属性、DETACH DELETE 源。"""
    writes = []

    async def fake_read(cypher, params):
        if "RETURN src.entity_id" in cypher:
            return _FakeResult([["src-1", "canon-1", 7]])
        return _FakeResult([[[], "src note", 0.5, ["canon-alias"], "", 0.9]])

    async def fake_write(cypher, params):
        writes.append(cypher)

    monkeypatch.setattr(jobs.graph_store, "_read", fake_read)
    monkeypatch.setattr(jobs.graph_store, "_write", fake_write)

    result = await jobs.merge_same_as(user_id=7)
    assert result == {"mode": "execute", "source_nodes_merged": 1}
    assert sum("MERGE" in w for w in writes) == 6  # 5 入边 + 1 出边
    assert any("SET canon.aliases" in w for w in writes)
    assert any("DETACH DELETE src" in w for w in writes)


def test_merge_same_as_cli_requires_explicit_scope():
    parser = jobs._build_cli_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["merge-same-as"])
    with pytest.raises(SystemExit):
        parser.parse_args(["merge-same-as", "--user-id", "0"])
    args = parser.parse_args(["merge-same-as", "--user-id", "7", "--dry-run"])
    assert args.user_id == 7
    assert args.dry_run is True
    assert parser.parse_args(["merge-same-as", "--all-users"]).all_users is True
