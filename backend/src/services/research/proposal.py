"""研究提案（Proposal）审核 + payload 执行。

_execute_proposal_payload 按 proposal_type 分发到 entity/relation/claim 的创建逻辑，
是 research 域的上层编排（依赖 entity/relation/claim/common）。
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    ResearchClaim,
    ResearchProposal,
    ResearchRelation,
    ResearchSource,
    ResearchTopic,
)

from .claim import _apply_conflict_resolution
from .common import (
    _clamp_confidence,
    _coerce_str_list,
    _payload_int_list,
    _safe_new_claim_proposal_reason,
    _valid_supporting_evidence,
)
from .entity import create_entity, get_or_create_entity, link_claim_entities
from .relation import create_relation

logger = logging.getLogger(__name__)


async def update_proposal(db: AsyncSession, proposal_id: int, data: dict, user_id: int) -> ResearchProposal | None:
    """审核提案：批准、拒绝或标记已应用。"""
    result = await db.execute(
        select(ResearchProposal).where(ResearchProposal.id == proposal_id, ResearchProposal.user_id == user_id)
    )
    proposal = result.scalar_one_or_none()
    if not proposal:
        logger.warning("审核提案失败：不存在 proposal_id=%s user=%s", proposal_id, user_id)
        return None

    new_status = data.get("status")
    if new_status and new_status in ("approved", "rejected", "applied", "pending"):
        proposal.status = new_status
        if new_status in ("approved", "rejected"):
            proposal.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if new_status == "applied":
            proposal.applied_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(proposal)
    logger.info("提案审核完成 proposal_id=%s status=%s", proposal_id, proposal.status)

    # 如果是 applied，执行提案的 payload
    if proposal.status == "applied" and proposal.payload_json:
        await _execute_proposal_payload(db, proposal, user_id)

    return proposal


async def _execute_proposal_payload(db: AsyncSession, proposal: ResearchProposal, user_id: int):
    """根据提案类型执行对应的操作。"""
    payload = proposal.payload_json or {}
    ptype = proposal.proposal_type
    topic_id = proposal.topic_id
    logger.info("执行提案 payload proposal_id=%s type=%s", proposal.id, ptype)

    try:
        if ptype == "new_source":
            source = ResearchSource(
                topic_id=topic_id,
                user_id=user_id,
                title=str(payload.get("title", "")),
                url=str(payload.get("url", "")),
                source_type=str(payload.get("source_type", "web")),
                publisher=str(payload.get("publisher", "")),
                trust_level=str(payload.get("trust_level", "unverified")),
                status="active",
            )
            db.add(source)

        elif ptype == "new_entity":
            entity = await create_entity(db, topic_id, payload, user_id)
            if entity:
                logger.info("new_entity 提案创建实体 proposal_id=%s entity_id=%s", proposal.id, entity.id)

        elif ptype == "new_relation":
            relation = await create_relation(db, topic_id, payload, user_id)
            if relation:
                logger.info("new_relation 提案创建关系 proposal_id=%s relation_id=%s", proposal.id, relation.id)

        elif ptype == "new_claim":
            claim_text = str(payload.get("claim_text", "")).strip()
            if not claim_text:
                logger.warning("跳过空事实提案 proposal_id=%s", proposal.id)
                return
            confidence = _clamp_confidence(payload.get("confidence"))
            evidence_ids = _payload_int_list(payload, "evidence_ids")
            entity_ids = _payload_int_list(payload, "entity_ids")
            for entity_name in _coerce_str_list(payload.get("entity_names")):
                entity = await get_or_create_entity(db, topic_id, entity_name, user_id)
                if entity and entity.id not in entity_ids:
                    entity_ids.append(entity.id)
            valid_evidence = await _valid_supporting_evidence(db, topic_id, evidence_ids, user_id)
            logger.info(
                "new_claim 提案评估: claim=%r evidence_ids=%s valid_count=%d confidence=%d",
                claim_text[:80], evidence_ids, len(valid_evidence), confidence,
            )
            auto_adopt_reason = await _safe_new_claim_proposal_reason(
                db,
                topic_id,
                payload,
                user_id,
                claim_text,
                confidence,
                valid_evidence,
            )
            auto_adopt = auto_adopt_reason == "auto_adopted"
            claim = ResearchClaim(
                topic_id=topic_id,
                user_id=user_id,
                claim_text=claim_text,
                status="supported" if auto_adopt else "pending",
                confidence=confidence,
                claim_type=str(payload.get("claim_type", "")),
                adopted=auto_adopt,
                reasoning=payload.get("reasoning"),
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
            linked_entity_ids = await link_claim_entities(db, claim.id, entity_ids, topic_id, user_id)
            logger.info(
                "new_claim 提案创建事实 proposal_id=%s claim_id=%s auto_adopt=%s reason=%s entity_count=%s",
                proposal.id,
                claim.id,
                auto_adopt,
                auto_adopt_reason,
                len(linked_entity_ids),
            )

        elif ptype == "mark_outdated":
            claim_id = payload.get("claim_id")
            if claim_id:
                claim = await db.get(ResearchClaim, int(claim_id))
                if claim and claim.user_id == user_id:
                    claim.status = "stale"

        elif ptype == "resolve_conflict":
            relation_id = payload.get("relation_id")
            accepted_claim_id = payload.get("accepted_claim_id")
            rejected_claim_id = payload.get("rejected_claim_id")
            if relation_id and accepted_claim_id and rejected_claim_id:
                rel = await db.get(ResearchRelation, int(relation_id))
                if rel and rel.user_id == user_id:
                    await _apply_conflict_resolution(
                        db,
                        rel,
                        int(accepted_claim_id),
                        int(rejected_claim_id),
                        user_id,
                    )
            elif relation_id:
                resolution = payload.get("resolution", "reject")
                rel = await db.get(ResearchRelation, int(relation_id))
                if rel and rel.user_id == user_id:
                    rel.metadata_json = {**(rel.metadata_json or {}), "resolution": resolution, "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}

        elif ptype == "update_summary":
            summary = payload.get("summary")
            if summary:
                topic = await db.get(ResearchTopic, topic_id)
                if topic and topic.user_id == user_id:
                    topic.summary = str(summary)

        await db.commit()
        logger.info("提案 payload 执行完成 proposal_id=%s type=%s", proposal.id, ptype)
    except Exception as e:
        logger.error("执行提案 payload 失败 proposal_id=%s: %s", proposal.id, e)
