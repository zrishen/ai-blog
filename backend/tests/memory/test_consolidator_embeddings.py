import pytest

from src.services.memory import consolidator, memory_embeddings


@pytest.mark.asyncio
async def test_consolidate_indexes_canonical_entities_facts_and_episodes(monkeypatch):
    captured = []

    async def consolidate_entity(**kwargs):
        return "entity-1", False

    async def consolidate_fact(**kwargs):
        return "fact-1"

    async def add_episode(**kwargs):
        return "episode-1"

    async def link_episode_entities(*args, **kwargs):
        return None

    async def index_refs(refs):
        captured.extend(refs)
        return memory_embeddings.EmbeddingIndexReport(embedded=len(refs))

    monkeypatch.setattr(consolidator, "consolidate_entity", consolidate_entity)
    monkeypatch.setattr(consolidator, "consolidate_fact", consolidate_fact)
    monkeypatch.setattr(consolidator.graph_store, "add_episode", add_episode)
    monkeypatch.setattr(consolidator.graph_store, "link_episode_entities", link_episode_entities)
    monkeypatch.setattr(consolidator.memory_embeddings, "index_node_refs_best_effort", index_refs)

    result = await consolidator.consolidate(
        user_id=7,
        extracted={
            "entities": [{"name": "Cortex"}, {"name": "Cortex"}],
            "facts": [{"subject_name": "Cortex", "predicate": "uses", "object_text": "FalkorDB"}],
            "episodes": [{"kind": "chat", "summary": "Discussed Cortex", "participants": ["Cortex"]}],
        },
    )

    assert result == {
        "entities": [("entity-1", False), ("entity-1", False)],
        "facts": ["fact-1"],
        "episodes": ["episode-1"],
        "preferences": [],
    }
    assert {(ref.kind, ref.memory_id) for ref in captured} == {
        ("entity", "entity-1"),
        ("fact", "fact-1"),
        ("episode", "episode-1"),
    }
