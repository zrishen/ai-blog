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


@pytest.mark.asyncio
async def test_consolidate_fact_reuses_identical_object(monkeypatch):
    """相同 subject+predicate+object 的有效 Fact 已存在 → 复用，不新建不 supersede（去重）。"""
    actions: list = []

    async def find_active_facts(**kwargs):
        return [{"fact_id": "fact-existing", "object_text": "Google"}]

    async def add_fact(**kwargs):
        actions.append(("add", kwargs))
        return "fact-new"

    async def supersede_fact(**kwargs):
        actions.append(("supersede", kwargs))

    monkeypatch.setattr(consolidator.graph_store, "find_active_facts", find_active_facts)
    monkeypatch.setattr(consolidator.graph_store, "add_fact", add_fact)
    monkeypatch.setattr(consolidator.graph_store, "supersede_fact", supersede_fact)

    result = await consolidator.consolidate_fact(
        user_id=1, subject_id="e1", predicate="works_at", object_text="Google",
    )
    assert result == "fact-existing"  # 复用已有
    assert actions == []  # 不新建、不 supersede


@pytest.mark.asyncio
async def test_consolidate_fact_creates_and_supersedes_different_object(monkeypatch):
    """object 不同 → 新建并 SUPERSEDE 旧 Fact（冲突版本化）。"""
    actions: list = []

    async def find_active_facts(**kwargs):
        return [{"fact_id": "fact-old", "object_text": "Apple"}]

    async def add_fact(**kwargs):
        actions.append(("add", kwargs))
        return "fact-new"

    async def supersede_fact(**kwargs):
        actions.append(("supersede", kwargs))

    monkeypatch.setattr(consolidator.graph_store, "find_active_facts", find_active_facts)
    monkeypatch.setattr(consolidator.graph_store, "add_fact", add_fact)
    monkeypatch.setattr(consolidator.graph_store, "supersede_fact", supersede_fact)

    result = await consolidator.consolidate_fact(
        user_id=1, subject_id="e1", predicate="works_at", object_text="Google",
    )
    assert result == "fact-new"
    assert actions[0][0] == "add"
    assert actions[1] == ("supersede", {"new_fact_id": "fact-new", "old_fact_id": "fact-old"})


@pytest.mark.asyncio
async def test_consolidate_skips_malformed_items(monkeypatch):
    """LLM 返回的 entity/fact 项缺必需字段时跳过，合法项仍入图，整体不崩溃。"""

    async def consolidate_entity(**kwargs):
        return ("ent-" + kwargs["name"], True)

    async def consolidate_fact(**kwargs):
        return "fact-ok"

    async def add_episode(**kwargs):
        return "ep-ok"

    async def link_episode_entities(*a, **k):
        return None

    async def index_refs(refs):
        return None

    monkeypatch.setattr(consolidator, "consolidate_entity", consolidate_entity)
    monkeypatch.setattr(consolidator, "consolidate_fact", consolidate_fact)
    monkeypatch.setattr(consolidator.graph_store, "add_episode", add_episode)
    monkeypatch.setattr(consolidator.graph_store, "link_episode_entities", link_episode_entities)
    monkeypatch.setattr(consolidator.memory_embeddings, "index_node_refs_best_effort", index_refs)

    result = await consolidator.consolidate(
        user_id=1,
        extracted={
            "entities": [{"name": "Alpha"}, {"entity_type": "x"}],  # 后者缺 name
            "facts": [
                {"subject_name": "Alpha", "predicate": "uses", "object_text": "X"},  # 合法
                {"subject_name": "Alpha", "object_text": "Y"},  # 缺 predicate
            ],
            "episodes": [{"kind": "chat", "summary": "ok"}],
            "preferences": [],
        },
    )
    assert [eid for eid, _ in result["entities"]] == ["ent-Alpha"]
    assert result["facts"] == ["fact-ok"]
    assert result["episodes"] == ["ep-ok"]


@pytest.mark.asyncio
async def test_consolidate_entity_reuses_canonical_and_bumps_confidence(monkeypatch):
    """B: 同名同类型 entity 已存在 → 复用 canonical，confidence 取 max，不新建重复节点。"""
    actions: list = []

    async def find_entity_by_name(**kwargs):
        return "ent-existing"

    async def add_entity(**kwargs):
        actions.append(("add", kwargs))
        return "ent-new"

    async def bump_entity_confidence(*, user_id, entity_id, confidence):
        actions.append(("bump", entity_id, confidence))

    monkeypatch.setattr(consolidator.graph_store, "find_entity_by_name", find_entity_by_name)
    monkeypatch.setattr(consolidator.graph_store, "add_entity", add_entity)
    monkeypatch.setattr(consolidator.graph_store, "bump_entity_confidence", bump_entity_confidence)

    eid, is_new = await consolidator.consolidate_entity(
        user_id=1, name="FalkorDB", entity_type="tech", confidence=0.9,
    )
    assert eid == "ent-existing"
    assert is_new is False
    assert actions == [("bump", "ent-existing", 0.9)]  # 复用 + bump，不新建


@pytest.mark.asyncio
async def test_consolidate_entity_creates_when_absent(monkeypatch):
    """首次（无同名）→ 新建，不 bump。"""
    actions: list = []

    async def find_entity_by_name(**kwargs):
        return None

    async def add_entity(**kwargs):
        actions.append(("add", kwargs))
        return "ent-new"

    async def bump_entity_confidence(**kwargs):
        actions.append(("bump", kwargs))

    monkeypatch.setattr(consolidator.graph_store, "find_entity_by_name", find_entity_by_name)
    monkeypatch.setattr(consolidator.graph_store, "add_entity", add_entity)
    monkeypatch.setattr(consolidator.graph_store, "bump_entity_confidence", bump_entity_confidence)

    eid, is_new = await consolidator.consolidate_entity(
        user_id=1, name="FalkorDB", entity_type="tech", confidence=0.9,
    )
    assert eid == "ent-new"
    assert is_new is True
    assert actions[0][0] == "add"
    assert not any(a[0] == "bump" for a in actions)
