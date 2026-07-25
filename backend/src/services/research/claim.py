"""研究事实声明（Claim）CRUD + 证据校验 + 冲突解决。"""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import ResearchClaim, ResearchRelation

from .common import (
    _claim_has_valid_support,
    _coerce_str_list,
    _get_owned_topic,
    _valid_supporting_evidence,
)
from .entity import get_or_create_entity, link_claim_entities

logger = logging.getLogger(__name__)


async def create_claim(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> ResearchClaim | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("创建 Claim 失败：主题不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    status = data.get("status") or "pending"
    evidence_ids = data.get("evidence_ids") or []
    requested_entity_ids = [entity_id for entity_id in data.get("entity_ids", []) if isinstance(entity_id, int)]
    for entity_name in _coerce_str_list(data.get("entity_names")):
        entity = await get_or_create_entity(db, topic_id, entity_name, user_id)
        if entity and entity.id not in requested_entity_ids:
            requested_entity_ids.append(entity.id)
    logger.info("创建 Claim topic_id=%s status=%s evidence_count=%s entity_count=%s user=%s", topic_id, status, len(evidence_ids), len(requested_entity_ids), user_id)
    valid_evidence = await _valid_supporting_evidence(db, topic_id, evidence_ids, user_id)
    if status == "supported" and not valid_evidence:
        logger.warning("创建 Claim 被拒：缺少有效证据 topic_id=%s", topic_id)
        raise ValueError("Evidence is required before a Claim can be supported")
    claim = ResearchClaim(
        topic_id=topic_id,
        user_id=user_id,
        claim_text=data["claim_text"],
        status=status,
        confidence=data.get("confidence", 0),
        claim_type=data.get("claim_type"),
        adopted=bool(data.get("adopted", False)),
        reasoning=data.get("reasoning"),
    )
    db.add(claim)
    await db.flush()
    for evidence in valid_evidence:
        db.add(ResearchRelation(
            topic_id=topic_id,
            user_id=user_id,
            from_type="evidence",
            from_id=evidence.id,
            to_type="claim",
            to_id=claim.id,
            relation_type="supports",
        ))
    linked_entity_ids = await link_claim_entities(db, claim.id, requested_entity_ids, topic_id, user_id)
    await db.commit()
    await db.refresh(claim)
    claim.entity_ids = linked_entity_ids
    logger.info("Claim 创建成功 claim_id=%s topic_id=%s entity_count=%s", claim.id, topic_id, len(linked_entity_ids))
    return claim


async def update_claim(db: AsyncSession, claim_id: int, data: dict[str, Any], user_id: int) -> ResearchClaim | None:
    result = await db.execute(select(ResearchClaim).where(ResearchClaim.id == claim_id, ResearchClaim.user_id == user_id))
    claim = result.scalar_one_or_none()
    if not claim:
        logger.warning("更新 Claim 失败：不存在 claim_id=%s user=%s", claim_id, user_id)
        return None
    logger.info("更新 Claim claim_id=%s fields=%s", claim_id, [k for k in data])
    evidence_ids = data.get("evidence_ids")
    if data.get("status") == "supported":
        valid_evidence = await _valid_supporting_evidence(db, claim.topic_id, evidence_ids or [], user_id)
        if not valid_evidence and not await _claim_has_valid_support(db, claim, user_id):
            raise ValueError("Evidence is required before a Claim can be supported")
    for field in ("status", "confidence", "adopted", "reasoning"):
        if field in data:
            setattr(claim, field, data[field])
    await db.commit()
    await db.refresh(claim)
    return claim


async def _apply_conflict_resolution(
    db: AsyncSession,
    rel: ResearchRelation,
    accepted_claim_id: int,
    rejected_claim_id: int,
    user_id: int,
) -> ResearchRelation:
    if rel.relation_type != "conflicts_with" or rel.from_type != "claim" or rel.to_type != "claim":
        raise ValueError("Only claim conflicts can be resolved")

    relation_claim_ids = {int(rel.from_id), int(rel.to_id)}
    requested_claim_ids = {int(accepted_claim_id), int(rejected_claim_id)}
    if len(requested_claim_ids) != 2 or requested_claim_ids != relation_claim_ids:
        raise ValueError("Accepted and rejected claims must match the conflict relation")

    accepted_claim = await db.get(ResearchClaim, int(accepted_claim_id))
    rejected_claim = await db.get(ResearchClaim, int(rejected_claim_id))
    if not accepted_claim or not rejected_claim:
        raise ValueError("Conflict claims not found")
    if accepted_claim.user_id != user_id or rejected_claim.user_id != user_id:
        raise ValueError("Conflict claims not found")
    if accepted_claim.topic_id != rel.topic_id or rejected_claim.topic_id != rel.topic_id:
        raise ValueError("Conflict claims must belong to the same topic")

    if not await _claim_has_valid_support(db, accepted_claim, user_id):
        raise ValueError("Evidence is required before accepting a claim")

    accepted_claim.status = "supported"
    accepted_claim.adopted = True
    rejected_claim.status = "rejected"
    rejected_claim.adopted = False
    rel.metadata_json = {
        **(rel.metadata_json or {}),
        "resolution": "accepted_rejected",
        "accepted_claim_id": accepted_claim.id,
        "rejected_claim_id": rejected_claim.id,
        "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "resolved_by": user_id,
    }
    await db.commit()
    await db.refresh(rel)
    return rel


async def resolve_conflict(
    db: AsyncSession,
    relation_id: int,
    data: dict[str, Any],
    user_id: int,
) -> ResearchRelation | None:
    rel = await db.get(ResearchRelation, relation_id)
    if not rel or rel.user_id != user_id:
        return None
    try:
        accepted_claim_id = int(data.get("accepted_claim_id"))
        rejected_claim_id = int(data.get("rejected_claim_id"))
    except (TypeError, ValueError):
        raise ValueError("Accepted and rejected claim ids are required")
    return await _apply_conflict_resolution(db, rel, accepted_claim_id, rejected_claim_id, user_id)
