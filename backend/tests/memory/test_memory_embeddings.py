import asyncio

import pytest

from src.services.memory import memory_embeddings


def test_render_embedding_text_is_stable_for_all_kinds():
    assert memory_embeddings.render_embedding_text("chunk", {"content": "  source text  "}) == "source text"
    assert memory_embeddings.render_embedding_text(
        "entity",
        {
            "name": "Project Cortex",
            "entity_type": "concept",
            "description": "AI brain",
            "aliases": ["Cortex", " Project Cortex ", "Cortex", ""],
        },
    ) == (
        "name: Project Cortex\n"
        "type: concept\n"
        "description: AI brain\n"
        "aliases: Cortex, Project Cortex"
    )
    assert memory_embeddings.render_embedding_text(
        "fact",
        {"subject_name": "Cortex", "predicate": "uses", "object_text": "FalkorDB"},
    ) == "subject: Cortex\npredicate: uses\nobject: FalkorDB"
    assert memory_embeddings.render_embedding_text(
        "fact",
        {"subject_id": "entity-1", "predicate": "uses", "object_text": "FalkorDB"},
    ).startswith("subject: entity-1")
    assert memory_embeddings.render_embedding_text(
        "episode", {"kind": "chat", "summary": "Discussed memory"}
    ) == "kind: chat\nsummary: Discussed memory"
    assert memory_embeddings.render_embedding_text(
        "preference", {"key": "tone", "value": "concise"}
    ) == "key: tone\nvalue: concise"


def test_render_embedding_text_skips_incomplete_rows():
    assert memory_embeddings.render_embedding_text("entity", {"name": " "}) == ""
    assert memory_embeddings.render_embedding_text(
        "fact", {"subject_id": "entity-1", "predicate": "", "object_text": "value"}
    ) == ""
    assert memory_embeddings.render_embedding_text("episode", {"kind": "chat", "summary": ""}) == ""
    assert memory_embeddings.render_embedding_text("preference", {"key": "tone", "value": ""}) == ""


@pytest.mark.asyncio
async def test_index_node_refs_deduplicates_and_writes_current_slug(monkeypatch):
    captured = {}

    async def fetch_nodes_for_embedding(**kwargs):
        captured["fetch"] = kwargs
        return [{
            "user_id": 7,
            "memory_id": "entity-1",
            "name": "Cortex",
            "entity_type": "concept",
            "aliases": [],
            "description": "AI brain",
        }]

    async def get_embeddings(texts):
        captured["texts"] = texts
        return [[0.1, 0.2]]

    async def upsert_node_embeddings(**kwargs):
        captured["upsert"] = kwargs
        return 1

    monkeypatch.setattr(
        memory_embeddings.embedding_service, "get_embedding_collection_suffix", lambda: "_test_model"
    )
    monkeypatch.setattr(memory_embeddings.graph_store, "fetch_nodes_for_embedding", fetch_nodes_for_embedding)
    monkeypatch.setattr(memory_embeddings.embedding_service, "get_embeddings", get_embeddings)
    monkeypatch.setattr(memory_embeddings.graph_store, "upsert_node_embeddings", upsert_node_embeddings)

    ref = memory_embeddings.MemoryNodeRef(kind="entity", user_id=7, memory_id="entity-1")
    report = await memory_embeddings.index_node_refs([ref, ref])

    assert report.selected == 1
    assert report.embedded == 1
    assert captured["fetch"]["ids"] == ["entity-1"]
    assert captured["fetch"]["missing_only"] is True
    assert captured["texts"] == ["name: Cortex\ntype: concept\ndescription: AI brain"]
    assert captured["upsert"]["embedding_model"] == "_test_model"
    assert captured["upsert"]["vector_dim"] == 2


@pytest.mark.asyncio
async def test_best_effort_embedding_failure_does_not_raise(monkeypatch):
    async def fail(*args, **kwargs):
        raise RuntimeError("embedding unavailable")

    monkeypatch.setattr(memory_embeddings, "index_node_refs", fail)
    report = await memory_embeddings.index_node_refs_best_effort([
        memory_embeddings.MemoryNodeRef(kind="fact", user_id=7, memory_id="fact-1")
    ])

    assert report.failed == 1


@pytest.mark.asyncio
async def test_best_effort_preserves_cancellation(monkeypatch):
    async def cancel(*args, **kwargs):
        raise asyncio.CancelledError

    monkeypatch.setattr(memory_embeddings, "index_node_refs", cancel)
    with pytest.raises(asyncio.CancelledError):
        await memory_embeddings.index_node_refs_best_effort([
            memory_embeddings.MemoryNodeRef(kind="episode", user_id=7, memory_id="episode-1")
        ])


@pytest.mark.asyncio
async def test_reindex_all_uses_keyset_cursor(monkeypatch):
    fetches = []
    batches = [
        [
            {"user_id": 1, "memory_id": "a", "content": "first"},
            {"user_id": 1, "memory_id": "b", "content": "second"},
        ],
        [{"user_id": 2, "memory_id": "c", "content": "third"}],
        [],
        [],
        [],
    ]

    async def fetch_nodes_for_embedding(**kwargs):
        fetches.append(kwargs)
        return batches.pop(0) if batches else []

    async def index_rows(kind, rows, *, embedding_model):
        return memory_embeddings.EmbeddingIndexReport(
            selected=len(rows), embedded=len(rows), by_kind={kind: len(rows)}
        )

    monkeypatch.setattr(
        memory_embeddings.embedding_service, "get_embedding_collection_suffix", lambda: "_test_model"
    )
    monkeypatch.setattr(memory_embeddings.graph_store, "fetch_nodes_for_embedding", fetch_nodes_for_embedding)
    monkeypatch.setattr(memory_embeddings, "_index_rows", index_rows)

    report = await memory_embeddings.reindex_all(kinds=["chunk"], batch_size=2)

    assert report.embedded == 3
    assert fetches[0]["cursor"] is None
    assert fetches[1]["cursor"] == (1, "b")
    assert fetches[2]["cursor"] == (2, "c")
    assert fetches[3].get("cursor") is None


@pytest.mark.asyncio
async def test_reindex_all_repairs_uuid_inserted_before_cursor(monkeypatch):
    main_batches = [
        [{"user_id": 1, "memory_id": "m", "content": "main"}],
        [],
    ]
    repair_batches = [
        [{"user_id": 1, "memory_id": "b", "content": "inserted during scan"}],
        [],
        [],
    ]
    calls = []

    async def fetch_nodes_for_embedding(**kwargs):
        calls.append(kwargs)
        source = main_batches if kwargs.get("cursor") is not None or len(calls) <= 2 else repair_batches
        return source.pop(0) if source else []

    async def index_rows(kind, rows, *, embedding_model):
        return memory_embeddings.EmbeddingIndexReport(
            selected=len(rows), embedded=len(rows), by_kind={kind: len(rows)}
        )

    monkeypatch.setattr(
        memory_embeddings.embedding_service, "get_embedding_collection_suffix", lambda: "_test_model"
    )
    monkeypatch.setattr(memory_embeddings.graph_store, "fetch_nodes_for_embedding", fetch_nodes_for_embedding)
    monkeypatch.setattr(memory_embeddings, "_index_rows", index_rows)

    report = await memory_embeddings.reindex_all(kinds=["chunk"], batch_size=1)

    assert report.embedded == 2
    assert any(call.get("cursor") is None for call in calls[2:])


@pytest.mark.asyncio
async def test_reindex_all_rejects_invalid_scope_and_batch_size():
    with pytest.raises(ValueError, match="user_id"):
        await memory_embeddings.reindex_all(user_id=0)
    with pytest.raises(ValueError, match="batch_size"):
        await memory_embeddings.reindex_all(user_id=1, batch_size=0)
