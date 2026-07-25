"""博客文章 ↔ 研究上下文绑定：Topic/Claim 采用到文章 + 研究摘要。"""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    BlogPostClaimLink,
    BlogPostResearchLink,
    ResearchClaim,
    ResearchEvidence,
    ResearchRelation,
    ResearchSource,
    ResearchTopic,
)

from .common import _get_owned_post, _get_owned_topic

logger = logging.getLogger(__name__)


async def attach_topic_to_post(db: AsyncSession, post_id: int, topic_id: int, user_id: int) -> dict[str, Any] | None:
    post = await _get_owned_post(db, post_id, user_id)
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not post or not topic:
        logger.warning("关联研究主题到文章失败 post_id=%s topic_id=%s user=%s", post_id, topic_id, user_id)
        return None
    logger.info("关联研究主题到文章 post_id=%s topic_id=%s", post_id, topic_id)
    result = await db.execute(
        select(BlogPostResearchLink).where(
            BlogPostResearchLink.post_id == post_id,
            BlogPostResearchLink.topic_id == topic_id,
            BlogPostResearchLink.user_id == user_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return _link_response(existing)
    link = BlogPostResearchLink(
        post_id=post_id,
        topic_id=topic_id,
        user_id=user_id,
        snapshot_json=await _build_post_snapshot(db, topic, user_id),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _link_response(link)


async def get_blog_research_summary(db: AsyncSession, post_id: int, user_id: int) -> dict[str, Any] | None:
    post = await _get_owned_post(db, post_id, user_id)
    if not post:
        logger.warning("获取博客研究摘要失败：文章不存在 post_id=%s user=%s", post_id, user_id)
        return None
    logger.info("获取博客研究摘要 post_id=%s", post_id)
    result = await db.execute(
        select(BlogPostResearchLink).where(BlogPostResearchLink.post_id == post_id, BlogPostResearchLink.user_id == user_id)
    )
    links = result.scalars().all()
    claim_result = await db.execute(
        select(BlogPostClaimLink, ResearchClaim)
        .join(ResearchClaim, ResearchClaim.id == BlogPostClaimLink.claim_id)
        .where(BlogPostClaimLink.post_id == post_id, BlogPostClaimLink.user_id == user_id)
    )
    claims = [
        {
            "id": claim.id,
            "topic_id": claim.topic_id,
            "claim_text": claim.claim_text,
            "status": claim.status,
            "confidence": claim.confidence,
            "usage_note": link.usage_note,
        }
        for link, claim in claim_result.all()
    ]
    return {
        "post_id": post_id,
        "topics": [link.snapshot_json.get("topic", {"id": link.topic_id}) for link in links],
        "claims": claims,
    }


async def _build_post_snapshot(db: AsyncSession, topic: ResearchTopic, user_id: int) -> dict[str, Any]:
    result = await db.execute(
        select(ResearchClaim).where(
            ResearchClaim.topic_id == topic.id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        )
    )
    claims = result.scalars().all()

    claim_snapshots: list[dict[str, Any]] = []
    for claim in claims:
        # 查找 supporting evidence
        ev_result = await db.execute(
            select(ResearchEvidence, ResearchRelation)
            .join(
                ResearchRelation,
                (ResearchRelation.from_type == "evidence")
                & (ResearchRelation.from_id == ResearchEvidence.id)
                & (ResearchRelation.to_type == "claim")
                & (ResearchRelation.to_id == claim.id)
                & (ResearchRelation.relation_type == "supports"),
            )
            .where(
                ResearchEvidence.topic_id == topic.id,
                ResearchEvidence.user_id == user_id,
            )
        )
        evidence_snapshots: list[dict[str, Any]] = []
        for ev, _rel in ev_result.all():
            source_snapshot = None
            if ev.source_id:
                src = await db.get(ResearchSource, ev.source_id)
                if src and src.user_id == user_id:
                    source_snapshot = {
                        "id": src.id,
                        "title": src.title,
                        "url": src.url,
                        "publisher": src.publisher,
                        "source_type": src.source_type,
                        "published_at": src.published_at.isoformat() if src.published_at else None,
                        "trust_level": src.trust_level,
                    }
            evidence_snapshots.append({
                "id": ev.id,
                "quote": ev.quote,
                "location": ev.location,
                "kind": ev.kind,
                "source": source_snapshot,
            })

        claim_snapshots.append({
            "id": claim.id,
            "claim_text": claim.claim_text,
            "status": claim.status,
            "confidence": claim.confidence,
            "evidence": evidence_snapshots,
        })

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "topic": {
            "id": topic.id,
            "title": topic.title,
            "status": topic.status,
        },
        "claims": claim_snapshots,
    }


def _link_response(link: BlogPostResearchLink) -> dict[str, Any]:
    return {
        "id": link.id,
        "post_id": link.post_id,
        "topic_id": link.topic_id,
        "snapshot": link.snapshot_json,
        "created_at": link.created_at,
    }


async def detach_topic_from_post(db: AsyncSession, post_id: int, topic_id: int, user_id: int) -> bool:
    """从博客文章移除研究主题关联。"""
    post = await _get_owned_post(db, post_id, user_id)
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not post or not topic:
        logger.warning("解除研究主题关联失败 post_id=%s topic_id=%s user=%s", post_id, topic_id, user_id)
        return False
    result = await db.execute(
        select(BlogPostResearchLink).where(
            BlogPostResearchLink.post_id == post_id,
            BlogPostResearchLink.topic_id == topic_id,
            BlogPostResearchLink.user_id == user_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        return False
    await db.delete(link)
    await db.commit()
    logger.info("解除研究主题关联 post_id=%s topic_id=%s", post_id, topic_id)
    return True


async def attach_claim_to_post(db: AsyncSession, post_id: int, claim_id: int, user_id: int, usage_note: str = "") -> dict[str, Any] | None:
    """将一条 Claim 采用到博客文章中。校验 post 和 claim 归属。"""
    post = await _get_owned_post(db, post_id, user_id)
    if not post:
        logger.warning("采用 Claim 失败：文章不存在 post_id=%s user=%s", post_id, user_id)
        return None
    claim_result = await db.execute(
        select(ResearchClaim).where(ResearchClaim.id == claim_id, ResearchClaim.user_id == user_id)
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        logger.warning("采用 Claim 失败：claim 不存在 claim_id=%s user=%s", claim_id, user_id)
        return None
    logger.info("采用 Claim 到文章 post_id=%s claim_id=%s", post_id, claim_id)
    existing = await db.execute(
        select(BlogPostClaimLink).where(
            BlogPostClaimLink.post_id == post_id,
            BlogPostClaimLink.claim_id == claim_id,
            BlogPostClaimLink.user_id == user_id,
        )
    )
    link = existing.scalar_one_or_none()
    if link:
        return {"id": link.id, "post_id": link.post_id, "claim_id": link.claim_id, "topic_id": link.topic_id, "usage_note": link.usage_note, "created_at": link.created_at}
    link = BlogPostClaimLink(
        post_id=post_id,
        claim_id=claim_id,
        topic_id=claim.topic_id,
        user_id=user_id,
        usage_note=usage_note.strip() or None,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return {"id": link.id, "post_id": link.post_id, "claim_id": link.claim_id, "topic_id": link.topic_id, "usage_note": link.usage_note, "created_at": link.created_at}


async def attach_adopted_claims_for_topic_to_post(
    db: AsyncSession,
    post_id: int,
    topic_id: int,
    user_id: int,
    usage_note: str = "",
) -> int:
    post = await _get_owned_post(db, post_id, user_id)
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not post or not topic:
        logger.warning("自动采用主题事实失败 post_id=%s topic_id=%s user=%s", post_id, topic_id, user_id)
        return 0

    claim_result = await db.execute(
        select(ResearchClaim).where(
            ResearchClaim.topic_id == topic_id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        ).order_by(ResearchClaim.id)
    )
    claims = claim_result.scalars().all()
    if not claims:
        return 0

    existing_result = await db.execute(
        select(BlogPostClaimLink.claim_id).where(
            BlogPostClaimLink.post_id == post_id,
            BlogPostClaimLink.user_id == user_id,
            BlogPostClaimLink.claim_id.in_([claim.id for claim in claims]),
        )
    )
    existing_claim_ids = set(existing_result.scalars().all())

    linked_count = 0
    for claim in claims:
        if claim.id in existing_claim_ids:
            continue
        linked = await attach_claim_to_post(db, post_id, claim.id, user_id, usage_note)
        if linked:
            linked_count += 1

    logger.info("自动采用主题事实完成 post_id=%s topic_id=%s linked=%s", post_id, topic_id, linked_count)
    return linked_count


async def detach_claim_from_post(db: AsyncSession, post_id: int, claim_id: int, user_id: int) -> bool:
    """从博客文章移除已采用的 Claim。"""
    post = await _get_owned_post(db, post_id, user_id)
    if not post:
        logger.warning("移除 Claim 失败：文章不存在 post_id=%s user=%s", post_id, user_id)
        return False
    logger.info("移除已采用 Claim post_id=%s claim_id=%s", post_id, claim_id)
    result = await db.execute(
        select(BlogPostClaimLink).where(
            BlogPostClaimLink.post_id == post_id,
            BlogPostClaimLink.claim_id == claim_id,
            BlogPostClaimLink.user_id == user_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        return False
    await db.delete(link)
    await db.commit()
    return True
