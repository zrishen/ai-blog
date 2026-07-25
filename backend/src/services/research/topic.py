"""研究主题（Topic）CRUD。"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    ResearchClaim,
    ResearchClaimEntityLink,
    ResearchEntity,
    ResearchEvidence,
    ResearchProposal,
    ResearchRelation,
    ResearchSource,
    ResearchTopic,
)

from .common import _get_owned_topic, _topic_summary

logger = logging.getLogger(__name__)


async def create_topic(db: AsyncSession, data: dict[str, Any], user_id: int) -> dict[str, Any]:
    logger.info("创建研究主题 user=%s title=%s", user_id, data.get("title"))
    topic = ResearchTopic(
        user_id=user_id,
        title=data["title"],
        description=data.get("description"),
        status="draft",
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    logger.info("研究主题创建成功 id=%s", topic.id)
    return await _topic_summary(db, topic)


async def list_topics(db: AsyncSession, user_id: int) -> list[dict[str, Any]]:
    result = await db.execute(
        select(ResearchTopic)
        .where(ResearchTopic.user_id == user_id, ResearchTopic.status != "archived")
        .order_by(ResearchTopic.updated_at.desc(), ResearchTopic.id.desc())
    )
    topics = result.scalars().all()
    logger.info("列出研究主题 user=%s count=%s", user_id, len(topics))
    return [await _topic_summary(db, topic) for topic in topics]


async def get_topic_detail(db: AsyncSession, topic_id: int, user_id: int) -> dict[str, Any] | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("获取研究主题详情失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    logger.info("获取研究主题详情 topic_id=%s", topic_id)
    summary = await _topic_summary(db, topic)
    queries = {
        "sources": select(ResearchSource).where(ResearchSource.topic_id == topic_id, ResearchSource.user_id == user_id).order_by(ResearchSource.id),
        "evidence": select(ResearchEvidence).where(ResearchEvidence.topic_id == topic_id, ResearchEvidence.user_id == user_id).order_by(ResearchEvidence.id),
        "claims": select(ResearchClaim).where(ResearchClaim.topic_id == topic_id, ResearchClaim.user_id == user_id).order_by(ResearchClaim.id),
        "entities": select(ResearchEntity).where(ResearchEntity.topic_id == topic_id, ResearchEntity.user_id == user_id).order_by(ResearchEntity.id),
        "relations": select(ResearchRelation).where(ResearchRelation.topic_id == topic_id, ResearchRelation.user_id == user_id).order_by(ResearchRelation.id),
        "claim_entity_links": select(ResearchClaimEntityLink).where(
            ResearchClaimEntityLink.topic_id == topic_id,
            ResearchClaimEntityLink.user_id == user_id,
        ).order_by(ResearchClaimEntityLink.id),
        "proposals": select(ResearchProposal).where(ResearchProposal.topic_id == topic_id, ResearchProposal.user_id == user_id).order_by(ResearchProposal.id),
    }
    for key, query in queries.items():
        result = await db.execute(query)
        summary[key] = result.scalars().all()

    entity_ids_by_claim: dict[int, list[int]] = {}
    for link in summary["claim_entity_links"]:
        entity_ids_by_claim.setdefault(link.claim_id, []).append(link.entity_id)
    summary["claims"] = [
        {
            "id": claim.id,
            "topic_id": claim.topic_id,
            "claim_text": claim.claim_text,
            "status": claim.status,
            "confidence": claim.confidence,
            "claim_type": claim.claim_type,
            "adopted": claim.adopted,
            "reasoning": claim.reasoning,
            "entity_ids": entity_ids_by_claim.get(claim.id, []),
            "created_at": claim.created_at,
            "updated_at": claim.updated_at,
        }
        for claim in summary["claims"]
    ]
    return summary


async def update_topic(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> dict[str, Any] | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("更新研究主题失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    logger.info("更新研究主题 topic_id=%s fields=%s", topic_id, [k for k in data])
    for field in ("title", "description", "status", "summary"):
        if field in data:
            setattr(topic, field, data[field])
    await db.commit()
    await db.refresh(topic)
    return await _topic_summary(db, topic)


async def archive_topic(db: AsyncSession, topic_id: int, user_id: int) -> bool:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("归档研究主题失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return False
    logger.info("归档研究主题 topic_id=%s title=%s", topic_id, topic.title)
    topic.status = "archived"
    await db.commit()
    return True


async def delete_topic(db: AsyncSession, topic_id: int, user_id: int) -> bool:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("物理删除研究主题失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return False
    title = topic.title
    await db.delete(topic)
    await db.commit()
    logger.info("研究主题已物理删除 topic_id=%s title=%s user=%s", topic_id, title, user_id)
    return True
