import pytest

from src.services.memory import graph_store
from src.services.memory.graph_store import delete_document_chunks as delete_document_chunks_impl


class _Result:
    def __init__(self, rows):
        self.result_set = rows


@pytest.mark.asyncio
async def test_ensure_graph_creates_empty_state_marker(monkeypatch):
    captured = {}

    async def fake_write(cypher, params):
        captured["cypher"] = cypher
        captured["params"] = params

    monkeypatch.setattr(graph_store, "_write", fake_write)

    await graph_store.ensure_graph()

    assert "CortexMeta" in captured["cypher"]
    assert captured["params"] == {}


@pytest.mark.asyncio
async def test_delete_document_chunks_scopes_by_collection_and_stored_name(monkeypatch):
    captured = {}

    async def fake_write(cypher, params):
        captured["cypher"] = cypher
        captured["params"] = params

    monkeypatch.setattr(graph_store, "_write", fake_write)

    assert await delete_document_chunks_impl("user_1_blog", "blog_post:1") is True
    assert "collection_name:$collection" in captured["cypher"]
    assert captured["params"] == {"collection": "user_1_blog", "stored": "blog_post:1"}


@pytest.mark.asyncio
async def test_resource_memory_helpers_scope_document_and_chunks(monkeypatch):
    reads = [_Result([[7, "file", 3]]), _Result([[7, "file", 3], [7, "blog_post", 5]])]
    writes = []

    async def fake_read(*args, **kwargs):
        return reads.pop(0)

    async def fake_write(cypher, params):
        writes.append((cypher, params))

    monkeypatch.setattr(graph_store, "_read", fake_read)
    monkeypatch.setattr(graph_store, "_write", fake_write)

    assert {
        (item["user_id"], item["resource_type"], item["resource_id"])
        for item in await graph_store.list_resource_memory()
    } == {(7, "file", 3), (7, "blog_post", 5)}

    await graph_store.delete_resource_memory(user_id=7, resource_type="file", resource_id=3)

    assert len(writes) == 2
    assert all(call[1] == {"uid": 7, "rt": "file", "rid": 3} for call in writes)
    assert "Document" in writes[0][0]
    assert "Chunk" in writes[1][0]


@pytest.mark.asyncio
async def test_has_resource_memory_requires_document_and_chunk(monkeypatch):
    async def fake_read(*args, **kwargs):
        return _Result([[1, 2]])

    monkeypatch.setattr(graph_store, "_read", fake_read)

    assert await graph_store.has_resource_memory(user_id=7, resource_type="file", resource_id=3) is True


@pytest.mark.asyncio
async def test_correct_fact_preserves_history_with_supersedes(monkeypatch):
    existing = {
        "fact_id": "old-fact",
        "subject_id": "entity-1",
        "predicate": "works_at",
        "object_text": "Old company",
        "confidence": 0.7,
        "source_doc_id": "document-1",
    }
    captured = {}

    async def get_fact(**kwargs):
        return existing

    async def add_fact(**kwargs):
        captured["new_fact"] = kwargs
        return "new-fact"

    async def supersede_fact(**kwargs):
        captured["supersedes"] = kwargs

    monkeypatch.setattr(graph_store, "get_fact", get_fact)
    monkeypatch.setattr(graph_store, "add_fact", add_fact)
    monkeypatch.setattr(graph_store, "supersede_fact", supersede_fact)

    corrected = await graph_store.correct_fact(
        user_id=7,
        fact_id="old-fact",
        object_text="New company",
        confidence=0.9,
    )

    assert corrected["fact_id"] == "new-fact"
    assert corrected["valid_to"] is None
    assert captured["new_fact"] == {
        "user_id": 7,
        "subject_id": "entity-1",
        "predicate": "works_at",
        "object_text": "New company",
        "confidence": 0.9,
        "source_doc_id": "document-1",
    }
    assert captured["supersedes"] == {"new_fact_id": "new-fact", "old_fact_id": "old-fact"}


@pytest.mark.asyncio
async def test_update_preference_versions_existing_value(monkeypatch):
    existing = {
        "pref_id": "old-pref",
        "key": "tone",
        "value": "concise",
        "confidence": 0.8,
        "valid_from": "2026-08-01T00:00:00",
    }
    writes = []

    async def get_preference(**kwargs):
        return existing

    async def fake_write(cypher, params):
        writes.append((cypher, params))

    async def add_preference(**kwargs):
        assert kwargs == {"user_id": 7, "key": "tone", "value": "detailed", "confidence": 0.8}
        return "new-pref"

    monkeypatch.setattr(graph_store, "get_preference", get_preference)
    monkeypatch.setattr(graph_store, "_write", fake_write)
    monkeypatch.setattr(graph_store, "add_preference", add_preference)

    updated = await graph_store.update_preference(user_id=7, pref_id="old-pref", value="detailed")

    assert updated["pref_id"] == "new-pref"
    assert updated["value"] == "detailed"
    assert "valid_to IS NULL" in writes[0][0]
    assert writes[0][1]["key"] == "tone"


@pytest.mark.asyncio
async def test_delete_memory_uses_user_scoped_label(monkeypatch):
    writes = []

    async def fake_read(*args, **kwargs):
        return _Result([[1]])

    async def fake_write(cypher, params):
        writes.append((cypher, params))

    monkeypatch.setattr(graph_store, "_read", fake_read)
    monkeypatch.setattr(graph_store, "_write", fake_write)

    assert await graph_store.delete_memory(user_id=7, memory_type="episode", memory_id="episode-1")
    assert "Episode" in writes[0][0]
    assert writes[0][1] == {"uid": 7, "mid": "episode-1"}
