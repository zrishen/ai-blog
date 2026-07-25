"""研究关系（Relation）创建 + 节点归属校验。"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    ResearchClaim,
    ResearchEntity,
    ResearchEvidence,
    ResearchRelation,
    ResearchSource,
)

from .common import (
    VALID_RELATION_NODE_TYPES,
    VALID_RELATION_TYPES,
    _coerce_int,
    _get_owned_topic,
)

logger = logging.getLogger(__name__)


async def _owned_research_node_exists(
    db: AsyncSession,
    node_type: str,
    node_id: int,
    topic_id: int,
    user_id: int,
) -> bool:
    model_by_type = {
        "source": ResearchSource,
        "evidence": ResearchEvidence,
        "claim": ResearchClaim,
        "entity": ResearchEntity,
    }
    model = model_by_type.get(node_type)
    if not model:
        return False
    item = await db.get(model, node_id)
    return bool(item and item.topic_id == topic_id and item.user_id == user_id)


async def create_relation(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> ResearchRelation | None:
    if not await _get_owned_topic(db, topic_id, user_id):
        return None
    from_type = str(data.get("from_type") or "").strip()
    to_type = str(data.get("to_type") or "").strip()
    relation_type = str(data.get("relation_type") or "related_to").strip()
    from_id = _coerce_int(data.get("from_id"))
    to_id = _coerce_int(data.get("to_id"))
    if from_type not in VALID_RELATION_NODE_TYPES or to_type not in VALID_RELATION_NODE_TYPES:
        raise ValueError("Relation node type must be source, evidence, claim, or entity")
    if relation_type not in VALID_RELATION_TYPES:
        raise ValueError("Unsupported relation type")
    if not await _owned_research_node_exists(db, from_type, from_id, topic_id, user_id):
        raise ValueError("Relation source node not found")
    if not await _owned_research_node_exists(db, to_type, to_id, topic_id, user_id):
        raise ValueError("Relation target node not found")
    existing = await db.execute(
        select(ResearchRelation).where(
            ResearchRelation.topic_id == topic_id,
            ResearchRelation.user_id == user_id,
            ResearchRelation.from_type == from_type,
            ResearchRelation.from_id == from_id,
            ResearchRelation.to_type == to_type,
            ResearchRelation.to_id == to_id,
            ResearchRelation.relation_type == relation_type,
        )
    )
    relation = existing.scalar_one_or_none()
    if relation:
        return relation
    relation = ResearchRelation(
        topic_id=topic_id,
        user_id=user_id,
        from_type=from_type,
        from_id=from_id,
        to_type=to_type,
        to_id=to_id,
        relation_type=relation_type,
        metadata_json=data.get("metadata") or data.get("metadata_json"),
    )
    db.add(relation)
    await db.commit()
    await db.refresh(relation)
    return relation
