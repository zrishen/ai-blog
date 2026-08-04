import pytest
from httpx import AsyncClient

from src.api import brain as brain_api
from src.config import settings
from src.core.exceptions import ConflictError
from src.schemas.brain import BrainFact, BrainGraph, BrainPreference, BrainStats
from src.services.memory import brain_service


@pytest.mark.asyncio
async def test_brain_write_endpoints_are_user_scoped(client: AsyncClient, monkeypatch):
    calls = []

    async def delete_memory(user_id, memory_type, memory_id):
        calls.append(("delete", user_id, memory_type, memory_id))

    async def correct_fact(user_id, fact_id, **payload):
        calls.append(("fact", user_id, fact_id, payload))
        return BrainFact(
            fact_id="new-fact",
            subject_id="entity-1",
            predicate="works_at",
            object_text=payload["object_text"],
        )

    async def update_preference(user_id, pref_id, **payload):
        calls.append(("preference", user_id, pref_id, payload))
        return BrainPreference(pref_id="new-pref", key="tone", value=payload["value"])

    monkeypatch.setattr(brain_api, "delete_memory", delete_memory)
    monkeypatch.setattr(brain_api, "correct_fact", correct_fact)
    monkeypatch.setattr(brain_api, "update_preference", update_preference)

    assert (await client.delete("/api/v1/brain/memories/episode/episode-1")).status_code == 204
    fact_response = await client.put(
        "/api/v1/brain/facts/old-fact",
        json={"object_text": "New company", "confidence": 0.9},
    )
    preference_response = await client.put(
        "/api/v1/brain/preferences/old-pref",
        json={"value": "detailed"},
    )

    assert fact_response.json()["fact_id"] == "new-fact"
    assert preference_response.json()["pref_id"] == "new-pref"
    assert calls == [
        ("delete", 1, "episode", "episode-1"),
        ("fact", 1, "old-fact", {"object_text": "New company", "predicate": None, "confidence": 0.9}),
        ("preference", 1, "old-pref", {"value": "detailed", "confidence": None}),
    ]


@pytest.mark.asyncio
async def test_brain_service_indexes_new_fact_and_preference_versions(monkeypatch):
    indexed = []

    async def correct_fact(**kwargs):
        return {
            "fact_id": "new-fact",
            "subject_id": "entity-1",
            "predicate": "works_at",
            "object_text": "New company",
            "confidence": 0.9,
            "source_doc_id": None,
            "valid_from": "2026-08-03T00:00:00",
            "valid_to": None,
        }

    async def update_preference(**kwargs):
        return {
            "pref_id": "new-pref",
            "key": "tone",
            "value": "detailed",
            "confidence": 0.8,
            "valid_from": "2026-08-03T00:00:00",
        }

    async def index_refs(refs):
        indexed.extend(refs)

    monkeypatch.setattr(brain_service.graph_store, "correct_fact", correct_fact)
    monkeypatch.setattr(brain_service.graph_store, "update_preference", update_preference)
    monkeypatch.setattr(
        brain_service.memory_embeddings, "index_node_refs_best_effort", index_refs
    )

    await brain_service.correct_fact(7, "old-fact", object_text="New company")
    await brain_service.update_preference(7, "old-pref", value="detailed")

    assert [(ref.kind, ref.user_id, ref.memory_id) for ref in indexed] == [
        ("fact", 7, "new-fact"),
        ("preference", 7, "new-pref"),
    ]


@pytest.mark.asyncio
async def test_brain_writes_respect_memory_feature_flag(monkeypatch):
    monkeypatch.setattr(settings, "memory_enabled", False)

    with pytest.raises(ConflictError):
        await brain_service.delete_memory(1, "episode", "episode-1")


@pytest.mark.asyncio
async def test_brain_get_endpoints_are_user_scoped(client: AsyncClient, monkeypatch):
    """6 个 GET 端点均 user-scoped 并透传 service 结果。"""
    monkeypatch.setattr(settings, "memory_enabled", True)
    captured: dict = {}

    async def get_stats(uid):
        captured["stats"] = uid
        return BrainStats(enabled=True, entities=1, facts=2, episodes=3, preferences=4)

    async def get_graph(uid, limit):
        captured["graph"] = (uid, limit)
        return BrainGraph(nodes=[], edges=[])

    async def list_entities(uid, limit, offset):
        captured["entities"] = uid
        return []

    async def list_episodes(uid, limit, offset):
        captured["episodes"] = uid
        return []

    async def list_preferences(uid):
        captured["preferences"] = uid
        return []

    async def list_facts(uid, entity_id, only_valid, limit, offset):
        captured["facts"] = (uid, entity_id, only_valid)
        return []

    monkeypatch.setattr(brain_api, "get_stats", get_stats)
    monkeypatch.setattr(brain_api, "get_graph", get_graph)
    monkeypatch.setattr(brain_api, "list_entities", list_entities)
    monkeypatch.setattr(brain_api, "list_episodes", list_episodes)
    monkeypatch.setattr(brain_api, "list_preferences", list_preferences)
    monkeypatch.setattr(brain_api, "list_facts", list_facts)

    stats_resp = await client.get("/api/v1/brain/stats")
    assert stats_resp.status_code == 200
    assert stats_resp.json()["enabled"] is True
    assert stats_resp.json()["entities"] == 1
    assert (await client.get("/api/v1/brain/graph?limit=50")).status_code == 200
    assert (await client.get("/api/v1/brain/entities")).status_code == 200
    assert (await client.get("/api/v1/brain/episodes")).status_code == 200
    assert (await client.get("/api/v1/brain/preferences")).status_code == 200
    assert (await client.get("/api/v1/brain/facts?entity_id=e1&only_valid=false")).status_code == 200

    assert captured["stats"] == 1
    assert captured["graph"] == (1, 50)
    assert captured["entities"] == 1
    assert captured["episodes"] == 1
    assert captured["preferences"] == 1
    assert captured["facts"] == (1, "e1", False)


@pytest.mark.asyncio
async def test_brain_get_returns_empty_when_memory_disabled(monkeypatch):
    """memory_enabled=False 时 GET 查询返回空结构，不触达 graph_store（前端展示空态）。"""
    monkeypatch.setattr(settings, "memory_enabled", False)

    async def fail(*args, **kwargs):
        raise AssertionError("graph_store should not be queried when memory disabled")

    monkeypatch.setattr(brain_service.graph_store, "stats", fail)
    monkeypatch.setattr(brain_service.graph_store, "graph_neighborhood", fail)
    monkeypatch.setattr(brain_service.graph_store, "list_entities", fail)
    monkeypatch.setattr(brain_service.graph_store, "list_episodes", fail)
    monkeypatch.setattr(brain_service.graph_store, "list_preferences", fail)
    monkeypatch.setattr(brain_service.graph_store, "list_facts", fail)

    assert (await brain_service.get_stats(1)).enabled is False
    assert await brain_service.get_graph(1) == BrainGraph(nodes=[], edges=[])
    assert await brain_service.list_entities(1) == []
    assert await brain_service.list_episodes(1) == []
    assert await brain_service.list_preferences(1) == []
    assert await brain_service.list_facts(1) == []
