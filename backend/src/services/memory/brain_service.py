"""大脑只读查询服务：封装 graph_store，给前端可视化 / 记忆管理 / 偏好。

memory_enabled=False（灰度默认）时所有查询返回空结构 + enabled=False，
前端据此展示「大脑未启用」空态，不报错。实跑验证留 FalkorDB 容器环境。
"""

from src.config import settings
from src.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from src.schemas.brain import (
    BrainEntity,
    BrainEpisode,
    BrainFact,
    BrainGraph,
    BrainGraphEdge,
    BrainGraphNode,
    BrainPreference,
    BrainStats,
)

from . import graph_store, memory_embeddings


def _require_memory_enabled() -> None:
    if not settings.memory_enabled:
        raise ConflictError("AI brain is not enabled")


async def get_stats(user_id: int) -> BrainStats:
    if not settings.memory_enabled:
        return BrainStats(enabled=False)
    counts = await graph_store.stats(user_id)
    return BrainStats(enabled=True, **counts)


async def get_graph(user_id: int, limit: int = 80) -> BrainGraph:
    if not settings.memory_enabled:
        return BrainGraph(nodes=[], edges=[])
    data = await graph_store.graph_neighborhood(user_id=user_id, limit=limit)
    return BrainGraph(
        nodes=[BrainGraphNode(**n) for n in data["nodes"]],
        edges=[BrainGraphEdge(**e) for e in data["edges"]],
    )


async def list_entities(user_id: int, limit: int = 200, offset: int = 0) -> list[BrainEntity]:
    if not settings.memory_enabled:
        return []
    rows = await graph_store.list_entities(user_id=user_id, limit=limit, offset=offset)
    return [BrainEntity(**r) for r in rows]


async def list_episodes(user_id: int, limit: int = 100, offset: int = 0) -> list[BrainEpisode]:
    if not settings.memory_enabled:
        return []
    rows = await graph_store.list_episodes(user_id=user_id, limit=limit, offset=offset)
    return [BrainEpisode(**r) for r in rows]


async def list_preferences(user_id: int) -> list[BrainPreference]:
    if not settings.memory_enabled:
        return []
    rows = await graph_store.list_preferences(user_id=user_id)
    return [BrainPreference(**r) for r in rows]


async def list_facts(
    user_id: int,
    entity_id: str | None = None,
    only_valid: bool = True,
    limit: int = 200,
    offset: int = 0,
) -> list[BrainFact]:
    if not settings.memory_enabled:
        return []
    rows = await graph_store.list_facts(
        user_id=user_id,
        entity_id=entity_id,
        only_valid=only_valid,
        limit=limit,
        offset=offset,
    )
    return [BrainFact(**r) for r in rows]


async def delete_memory(user_id: int, memory_type: str, memory_id: str) -> None:
    _require_memory_enabled()
    if memory_type not in {"episode", "fact", "preference"}:
        raise ValidationFailedError("Unsupported memory type")
    if not await graph_store.delete_memory(
        user_id=user_id,
        memory_type=memory_type,
        memory_id=memory_id,
    ):
        raise NotFoundError("Memory not found")


async def correct_fact(
    user_id: int,
    fact_id: str,
    *,
    object_text: str,
    predicate: str | None = None,
    confidence: float | None = None,
) -> BrainFact:
    _require_memory_enabled()
    object_text = object_text.strip()
    if not object_text:
        raise ValidationFailedError("Fact value cannot be blank")
    if predicate is not None:
        predicate = predicate.strip()
        if not predicate:
            raise ValidationFailedError("Fact predicate cannot be blank")
    fact = await graph_store.correct_fact(
        user_id=user_id,
        fact_id=fact_id,
        object_text=object_text,
        predicate=predicate,
        confidence=confidence,
    )
    if fact is None:
        raise NotFoundError("Active fact not found")
    await memory_embeddings.index_node_refs_best_effort(
        [memory_embeddings.MemoryNodeRef(kind="fact", user_id=user_id, memory_id=fact["fact_id"])]
    )
    return BrainFact(**fact)


async def update_preference(
    user_id: int,
    pref_id: str,
    *,
    value: str,
    confidence: float | None = None,
) -> BrainPreference:
    _require_memory_enabled()
    value = value.strip()
    if not value:
        raise ValidationFailedError("Preference value cannot be blank")
    preference = await graph_store.update_preference(
        user_id=user_id,
        pref_id=pref_id,
        value=value,
        confidence=confidence,
    )
    if preference is None:
        raise NotFoundError("Active preference not found")
    await memory_embeddings.index_node_refs_best_effort(
        [memory_embeddings.MemoryNodeRef(kind="preference", user_id=user_id, memory_id=preference["pref_id"])]
    )
    return BrainPreference(**preference)
