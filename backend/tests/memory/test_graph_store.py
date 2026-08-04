import pytest

from src.services.memory import graph_store
from src.services.memory.graph_store import add_document_chunks as add_document_chunks_impl
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
async def test_add_document_chunks_normalizes_embedding_slug(monkeypatch):
    captured = {}

    async def fake_ensure_vector_index(slug, dim):
        captured["index"] = (slug, dim)

    async def fake_write(cypher, params):
        captured["cypher"] = cypher
        captured["params"] = params

    monkeypatch.setattr(graph_store, "ensure_vector_index", fake_ensure_vector_index)
    monkeypatch.setattr(graph_store, "_write", fake_write)

    await add_document_chunks_impl(
        user_id=7,
        collection_name="user_7_kb",
        stored_name="memory.pdf",
        chunks=["memory content"],
        embeddings=[[0.1, 0.2]],
        metadata_list=[{"source": "memory.pdf"}],
        embedding_model="_test_model",
        vector_dim=2,
    )

    assert captured["index"] == ("_test_model", 2)
    assert "c.embedding_test_model=vecf32($emb)" in captured["cypher"]
    assert "embedding__test_model" not in captured["cypher"]
    assert captured["params"]["cid"] == "memory.pdf:0"


@pytest.mark.asyncio
async def test_upsert_knowledge_embedding_scopes_user_and_kind(monkeypatch):
    captured = {}

    async def fake_ensure(slug, dim, *, kind="chunk"):
        captured["index"] = (slug, dim, kind)

    async def fake_write(cypher, params):
        captured["cypher"] = cypher
        captured["params"] = params
        return _Result([[1]])

    monkeypatch.setattr(graph_store, "ensure_vector_index", fake_ensure)
    monkeypatch.setattr(graph_store, "_write", fake_write)

    assert await graph_store.upsert_node_embeddings(
        kind="fact",
        embedding_model="_test_model",
        vector_dim=2,
        rows=[{
            "user_id": 7,
            "memory_id": "fact-1",
            "text": "subject: Cortex\npredicate: uses\nobject: FalkorDB",
            "embedding": [0.1, 0.2],
        }],
    ) == 1

    assert captured["index"] == ("_test_model", 2, "fact")
    assert "MATCH (node:Fact {user_id:$uid, fact_id:$mid})" in captured["cypher"]
    assert "embedding_test_model=vecf32($embedding)" in captured["cypher"]
    assert "embedding_source_test_model=$text" in captured["cypher"]
    assert captured["params"]["uid"] == 7


@pytest.mark.asyncio
async def test_fetch_fact_embedding_rows_are_user_scoped(monkeypatch):
    captured = {}

    async def fake_read(cypher, params):
        captured["cypher"] = cypher
        captured["params"] = params
        return _Result([[7, "fact-1", "entity-1", "Cortex", "uses", "FalkorDB"]])

    monkeypatch.setattr(graph_store, "_read", fake_read)

    rows = await graph_store.fetch_nodes_for_embedding(
        kind="fact",
        embedding_model="_test_model",
        user_id=7,
        ids=["fact-1"],
    )

    assert "node.user_id=$uid" in captured["cypher"]
    assert "subject.user_id=node.user_id" in captured["cypher"]
    assert "node.embedding_test_model IS NULL" in captured["cypher"]
    assert captured["params"]["uid"] == 7
    assert rows[0]["subject_name"] == "Cortex"


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
    reads = [
        _Result([[7, "file", 3]]),
        _Result([[7, "file", 3], [7, "blog_post", 5]]),
        _Result([]),  # delete_resource_memory 的 doc_id 查询（无 Document → 跳过 Fact 清理）
    ]
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

    delete_writes = [w for w in writes if "DETACH DELETE" in w[0]]
    assert len(delete_writes) == 3
    assert any("Document" in w[0] and w[1] == {"uid": 7, "rt": "file", "rid": 3} for w in delete_writes)
    assert any("Chunk" in w[0] and w[1] == {"uid": 7, "rt": "file", "rid": 3} for w in delete_writes)
    assert any("Entity" in w[0] and w[1] == {"uid": 7} for w in delete_writes)


@pytest.mark.asyncio
async def test_delete_resource_memory_removes_sourced_facts_and_orphan_entities(monkeypatch):
    reads = [_Result([["document-1"]])]
    writes = []

    async def fake_read(*args, **kwargs):
        return reads.pop(0)

    async def fake_write(cypher, params):
        writes.append((cypher, params))

    monkeypatch.setattr(graph_store, "_read", fake_read)
    monkeypatch.setattr(graph_store, "_write", fake_write)

    await graph_store.delete_resource_memory(
        user_id=7,
        resource_type="file",
        resource_id=3,
    )

    assert len(writes) == 4
    assert "f.source_doc_id IN $doc_ids" in writes[0][0]
    assert writes[0][1]["doc_ids"] == ["document-1"]
    assert "Document" in writes[1][0]
    assert "Chunk" in writes[2][0]
    assert "NOT (e)<-[:MENTIONS|SOURCES|SUBJECT|OBJECT|INVOLVES]-()" in writes[3][0]
    assert all(call[1].get("uid") == 7 for call in writes)


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
