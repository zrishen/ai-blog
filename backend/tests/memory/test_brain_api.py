import pytest
from httpx import AsyncClient

from src.api import brain as brain_api
from src.config import settings
from src.core.exceptions import ConflictError
from src.schemas.brain import BrainFact, BrainPreference
from src.services import brain_service


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
async def test_brain_writes_respect_memory_feature_flag(monkeypatch):
    monkeypatch.setattr(settings, "memory_enabled", False)

    with pytest.raises(ConflictError):
        await brain_service.delete_memory(1, "episode", "episode-1")
