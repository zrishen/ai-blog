"""大脑巩固：抽取产物入图前去重、冲突检测、实体消歧。

- Entity：按 user+name(+type) 查现有；存在则复用 canonical（confidence 取 max，不新建重复节点避免图膨胀）
- Fact：同 subject+predicate 的现存有效 Fact，object 不同 → 新 Fact SUPERSEDES 旧 Fact（旧 Fact valid_to 置位，可回溯）
- Preference：同 key 当前有效偏好，value 不同 → 版本化（旧值 valid_to 置位并新建）；value 相同则跳过
"""

import logging

from src.services.memory import graph_store, memory_embeddings

logger = logging.getLogger(__name__)


async def consolidate_entity(
    *, user_id: int, name: str, entity_type: str | None = None,
    aliases: list[str] | None = None, description: str | None = None, confidence: float = 1.0,
) -> tuple[str, bool]:
    """去重：同名同类型已存在 → 复用 canonical（confidence 取 max，不新建重复节点避免图膨胀）；否则新建。返回 (entity_id, is_new)。"""
    existing = await graph_store.find_entity_by_name(user_id=user_id, name=name, entity_type=entity_type)
    if existing:
        if confidence and confidence > 0:
            await graph_store.bump_entity_confidence(
                user_id=user_id, entity_id=existing, confidence=confidence,
            )
        return existing, False
    new_id = await graph_store.add_entity(
        user_id=user_id, name=name, entity_type=entity_type,
        aliases=aliases, description=description, confidence=confidence,
    )
    return new_id, True


async def consolidate_fact(
    *, user_id: int, subject_id: str, predicate: str, object_text: str,
    object_id: str | None = None, confidence: float = 1.0, source_doc_id: str | None = None,
) -> str:
    """冲突检测：同主体+谓词的有效 Fact 若 object 相同 → 复用（去重）；object 不同 → 新建并 SUPERSEDES 旧 Fact。object_id 非空时建 OBJECT 边。返回 fact_id。"""
    active = await graph_store.find_active_facts(user_id=user_id, subject_id=subject_id, predicate=predicate)
    for old in active:
        if old["object_text"] == object_text:
            return old["fact_id"]  # 相同事实已存在，复用避免重复累积
    new_id = await graph_store.add_fact(
        user_id=user_id, subject_id=subject_id, predicate=predicate, object_text=object_text,
        object_id=object_id, confidence=confidence, source_doc_id=source_doc_id,
    )
    for old in active:
        if old["object_text"] != object_text:
            await graph_store.supersede_fact(new_fact_id=new_id, old_fact_id=old["fact_id"])
            logger.info("Fact 冲突 SUPERSEDE: %s -> %s", new_id, old["fact_id"])
    return new_id


async def consolidate_preference(
    *, user_id: int, key: str, value: str, confidence: float = 1.0,
) -> str | None:
    """仲裁偏好：key 归一化 + 置信度门槛 + 查图判断首次/重复/版本化。返回 pref_id 或 None（跳过）。

    - 该 key 无当前有效偏好 → 首次创建（add_preference）。
    - 已存在且 value 相同 → 跳过（重复）。
    - 已存在且 value 不同 → 版本化（update_preference 置位旧值并新建新版本）。
    """
    norm_key = (key or "").strip().lower()
    norm_value = (value or "").strip()
    if not norm_key or not norm_value:
        return None
    if confidence < 0.7:
        return None
    existing = await graph_store.find_active_preference(user_id=user_id, key=norm_key)
    if existing is None:
        return await graph_store.add_preference(
            user_id=user_id, key=norm_key, value=norm_value, confidence=confidence,
        )
    if existing["value"] == norm_value:
        logger.info("Preference 重复跳过: key=%s", norm_key)
        return None
    updated = await graph_store.update_preference(
        user_id=user_id, pref_id=existing["pref_id"], value=norm_value, confidence=confidence,
    )
    logger.info("Preference 版本化: key=%s old_pref_id=%s", norm_key, existing["pref_id"])
    return updated["pref_id"] if updated else None


async def consolidate(*, user_id: int, extracted: dict) -> dict:
    """批量巩固抽取产物 {entities, facts, episodes, preferences}。

    entities 项: {name, entity_type?, aliases?, description?, confidence?}
    facts 项:    {subject_name|subject_id, predicate, object_text, confidence?, source_doc_id?}
    episodes 项: {kind, summary, occurred_at?, conversation_id?, message_id?, participants?}
    preferences 项: {key, value, confidence?}
    返回 {entities: [(id,is_new)], facts: [id], episodes: [id], preferences: [id]}。
    """
    result = {"entities": [], "facts": [], "episodes": [], "preferences": []}

    name_to_id: dict[str, str] = {}
    for ent in extracted.get("entities", []):
        try:
            eid, is_new = await consolidate_entity(user_id=user_id, **ent)
        except (TypeError, KeyError, ValueError) as e:
            logger.warning("跳过格式异常的 entity 项 %r: %s", ent, e)
            continue
        result["entities"].append((eid, is_new))
        name_to_id[ent["name"]] = eid

    for fact in extracted.get("facts", []):
        try:
            sid = fact.get("subject_id") or name_to_id.get(fact.get("subject_name", ""))
            if not sid:
                continue
            object_id = name_to_id.get(fact.get("object_text", ""))  # object 命中已抽取实体则建 OBJECT 边
            fid = await consolidate_fact(
                user_id=user_id, subject_id=sid, predicate=fact["predicate"],
                object_text=fact["object_text"], object_id=object_id,
                confidence=fact.get("confidence", 1.0),
                source_doc_id=fact.get("source_doc_id"),
            )
        except (TypeError, KeyError, ValueError) as e:
            logger.warning("跳过格式异常的 fact 项 %r: %s", fact, e)
            continue
        result["facts"].append(fid)

    for ep in extracted.get("episodes", []):
        try:
            eid = await graph_store.add_episode(user_id=user_id, **ep)
        except (TypeError, KeyError, ValueError) as e:
            logger.warning("跳过格式异常的 episode 项 %r: %s", ep, e)
            continue
        result["episodes"].append(eid)
        participants = [name_to_id[n] for n in ep.get("participants", []) if n in name_to_id]
        if participants:
            await graph_store.link_episode_entities(
                user_id=user_id, episode_id=eid, entity_ids=participants,
            )

    for pref in extracted.get("preferences", []):
        pid = await consolidate_preference(
            user_id=user_id,
            key=pref.get("key", ""),
            value=pref.get("value", ""),
            confidence=pref.get("confidence", 1.0),
        )
        if pid:
            result["preferences"].append(pid)

    refs = [
        memory_embeddings.MemoryNodeRef(kind="entity", user_id=user_id, memory_id=eid)
        for eid in dict.fromkeys(entity_id for entity_id, _ in result["entities"])
    ]
    refs.extend(
        memory_embeddings.MemoryNodeRef(kind="fact", user_id=user_id, memory_id=fid)
        for fid in result["facts"]
    )
    refs.extend(
        memory_embeddings.MemoryNodeRef(kind="episode", user_id=user_id, memory_id=eid)
        for eid in result["episodes"]
    )
    refs.extend(
        memory_embeddings.MemoryNodeRef(kind="preference", user_id=user_id, memory_id=pid)
        for pid in result["preferences"]
    )
    await memory_embeddings.index_node_refs_best_effort(refs)

    return result
