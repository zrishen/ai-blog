import pytest

from src.services.memory import consolidator, memory_embeddings


@pytest.mark.asyncio
async def test_consolidate_preference_first_write(monkeypatch):
    """首次：该 key 无当前有效偏好 → add_preference 创建，key 归一化为 strip+lower。"""
    found: dict = {}
    created: list = []

    async def find_active_preference(*, user_id, key):
        found.update(user_id=user_id, key=key)
        return None

    async def add_preference(*, user_id, key, value, confidence):
        created.append((user_id, key, value, confidence))
        return "pref-new"

    monkeypatch.setattr(consolidator.graph_store, "find_active_preference", find_active_preference)
    monkeypatch.setattr(consolidator.graph_store, "add_preference", add_preference)

    pid = await consolidator.consolidate_preference(
        user_id=7, key="  Reply Language  ", value="中文", confidence=0.9,
    )
    assert pid == "pref-new"
    assert found == {"user_id": 7, "key": "reply language"}
    assert created == [(7, "reply language", "中文", 0.9)]


@pytest.mark.asyncio
async def test_consolidate_preference_duplicate_skipped(monkeypatch):
    """重复：同 key 同 value → 跳过，不创建。"""

    async def find_active_preference(*, user_id, key):
        return {"pref_id": "pref-old", "value": "中文"}

    created: list = []

    async def add_preference(**kwargs):
        created.append(kwargs)
        return "pref-new"

    monkeypatch.setattr(consolidator.graph_store, "find_active_preference", find_active_preference)
    monkeypatch.setattr(consolidator.graph_store, "add_preference", add_preference)

    pid = await consolidator.consolidate_preference(
        user_id=7, key="reply language", value="中文", confidence=0.9,
    )
    assert pid is None
    assert created == []


@pytest.mark.asyncio
async def test_consolidate_preference_value_change_versions(monkeypatch):
    """value 变化 → 版本化：update_preference 置位旧值并新建新版本。"""

    async def find_active_preference(*, user_id, key):
        return {"pref_id": "pref-old", "value": "中文"}

    updated: list = []

    async def update_preference(*, user_id, pref_id, value, confidence):
        updated.append((user_id, pref_id, value, confidence))
        return {"pref_id": "pref-new", "value": value}

    monkeypatch.setattr(consolidator.graph_store, "find_active_preference", find_active_preference)
    monkeypatch.setattr(consolidator.graph_store, "update_preference", update_preference)

    pid = await consolidator.consolidate_preference(
        user_id=7, key="reply language", value="English", confidence=0.85,
    )
    assert pid == "pref-new"
    assert updated == [(7, "pref-old", "English", 0.85)]


@pytest.mark.asyncio
async def test_consolidate_preference_low_confidence_skipped(monkeypatch):
    """置信度 < 0.7 → 跳过，不查图不写。"""
    found: list = []

    async def find_active_preference(**kwargs):
        found.append(kwargs)
        return None

    monkeypatch.setattr(consolidator.graph_store, "find_active_preference", find_active_preference)

    pid = await consolidator.consolidate_preference(
        user_id=7, key="lang", value="zh", confidence=0.4,
    )
    assert pid is None
    assert found == []


@pytest.mark.asyncio
async def test_consolidate_preference_empty_key_or_value_skipped():
    """空 key 或空白 value → 跳过（在查图前返回）。"""
    assert await consolidator.consolidate_preference(
        user_id=7, key="", value="x", confidence=0.9,
    ) is None
    assert await consolidator.consolidate_preference(
        user_id=7, key="x", value="   ", confidence=0.9,
    ) is None


@pytest.mark.asyncio
async def test_consolidate_processes_preferences_and_indexes(monkeypatch):
    """consolidate 主循环处理 preferences，新偏好进入 result 与 best-effort 索引 refs。"""
    captured: list = []

    async def consolidate_entity(**kwargs):
        return "entity-1", True

    async def consolidate_fact(**kwargs):
        return "fact-1"

    async def add_episode(**kwargs):
        return "episode-1"

    async def link_episode_entities(*args, **kwargs):
        return None

    async def consolidate_preference(*, user_id, key, value, confidence):
        return "pref-1"

    async def index_refs(refs):
        captured.extend(refs)
        return memory_embeddings.EmbeddingIndexReport(embedded=len(refs))

    monkeypatch.setattr(consolidator, "consolidate_entity", consolidate_entity)
    monkeypatch.setattr(consolidator, "consolidate_fact", consolidate_fact)
    monkeypatch.setattr(consolidator.graph_store, "add_episode", add_episode)
    monkeypatch.setattr(consolidator.graph_store, "link_episode_entities", link_episode_entities)
    monkeypatch.setattr(consolidator, "consolidate_preference", consolidate_preference)
    monkeypatch.setattr(consolidator.memory_embeddings, "index_node_refs_best_effort", index_refs)

    result = await consolidator.consolidate(
        user_id=7,
        extracted={
            "entities": [{"name": "Cortex"}],
            "facts": [{"subject_name": "Cortex", "predicate": "uses", "object_text": "FalkorDB"}],
            "episodes": [{"kind": "chat", "summary": "Discussed Cortex"}],
            "preferences": [
                {"key": "reply language", "value": "中文", "confidence": 0.9},
                {"key": "code style", "value": "concise", "confidence": 0.8},
            ],
        },
    )

    assert result["preferences"] == ["pref-1", "pref-1"]
    assert ("preference", "pref-1") in {(ref.kind, ref.memory_id) for ref in captured}
