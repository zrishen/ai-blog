"""研究实体（Entity）CRUD + Claim-Entity 关联。"""

import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import ResearchClaimEntityLink, ResearchEntity, ResearchRelation

from .common import (
    ENTITY_STATUSES,
    ENTITY_TYPES,
    _clamp_confidence,
    _coerce_str_list,
    _get_owned_topic,
    _normalize_entity_name,
)

logger = logging.getLogger(__name__)


async def _find_entity_by_name(db: AsyncSession, topic_id: int, name: str, user_id: int) -> ResearchEntity | None:
    normalized = _normalize_entity_name(name).lower()
    if not normalized:
        return None
    result = await db.execute(
        select(ResearchEntity).where(
            ResearchEntity.topic_id == topic_id,
            ResearchEntity.user_id == user_id,
        )
    )
    for entity in result.scalars().all():
        if _normalize_entity_name(entity.name).lower() == normalized:
            return entity
    return None


async def create_entity(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> ResearchEntity | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("创建实体失败：主题不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    name = _normalize_entity_name(str(data.get("name", "")))
    if not name:
        raise ValueError("Entity name is required")

    entity_type = str(data.get("entity_type") or "other")
    if entity_type not in ENTITY_TYPES:
        entity_type = "other"
    status = str(data.get("status") or "active")
    if status not in ENTITY_STATUSES:
        status = "active"
    aliases = _coerce_str_list(data.get("aliases"))
    existing = await _find_entity_by_name(db, topic_id, name, user_id)
    if existing:
        description = data.get("description")
        if description:
            existing.description = str(description)
        confidence = _clamp_confidence(data.get("confidence"))
        if confidence > existing.confidence:
            existing.confidence = confidence
        if aliases:
            existing_aliases = _coerce_str_list(existing.aliases_json)
            existing.aliases_json = existing_aliases + [alias for alias in aliases if alias not in existing_aliases]
        if not existing.entity_type or existing.entity_type == "other":
            existing.entity_type = entity_type
        existing.status = status
        await db.commit()
        await db.refresh(existing)
        return existing

    entity = ResearchEntity(
        topic_id=topic_id,
        user_id=user_id,
        name=name,
        entity_type=entity_type,
        description=data.get("description"),
        aliases_json=aliases,
        confidence=_clamp_confidence(data.get("confidence")),
        status=status,
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    logger.info("实体创建成功 entity_id=%s topic_id=%s", entity.id, topic_id)
    return entity


async def list_entities(db: AsyncSession, topic_id: int, user_id: int) -> list[ResearchEntity] | None:
    if not await _get_owned_topic(db, topic_id, user_id):
        return None
    result = await db.execute(
        select(ResearchEntity)
        .where(ResearchEntity.topic_id == topic_id, ResearchEntity.user_id == user_id)
        .order_by(ResearchEntity.id)
    )
    return list(result.scalars().all())


async def get_entity_detail(db: AsyncSession, entity_id: int, user_id: int) -> ResearchEntity | None:
    result = await db.execute(select(ResearchEntity).where(ResearchEntity.id == entity_id, ResearchEntity.user_id == user_id))
    return result.scalar_one_or_none()


async def update_entity(db: AsyncSession, entity_id: int, data: dict[str, Any], user_id: int) -> ResearchEntity | None:
    entity = await get_entity_detail(db, entity_id, user_id)
    if not entity:
        return None
    if "name" in data and data["name"] is not None:
        name = _normalize_entity_name(str(data["name"]))
        if not name:
            raise ValueError("Entity name is required")
        duplicate = await _find_entity_by_name(db, entity.topic_id, name, user_id)
        if duplicate and duplicate.id != entity.id:
            raise ValueError("Entity already exists in this topic")
        entity.name = name
    if "entity_type" in data and data["entity_type"] is not None:
        entity_type = str(data["entity_type"])
        entity.entity_type = entity_type if entity_type in ENTITY_TYPES else "other"
    if "description" in data:
        entity.description = data["description"]
    if "confidence" in data and data["confidence"] is not None:
        entity.confidence = _clamp_confidence(data["confidence"])
    if "status" in data and data["status"] is not None:
        status = str(data["status"])
        entity.status = status if status in ENTITY_STATUSES else "active"
    if "aliases" in data and data["aliases"] is not None:
        entity.aliases_json = _coerce_str_list(data["aliases"])
    await db.commit()
    await db.refresh(entity)
    return entity


async def delete_entity(db: AsyncSession, entity_id: int, user_id: int) -> bool:
    entity = await get_entity_detail(db, entity_id, user_id)
    if not entity:
        return False
    await db.execute(
        delete(ResearchClaimEntityLink).where(
            ResearchClaimEntityLink.entity_id == entity_id,
            ResearchClaimEntityLink.user_id == user_id,
        )
    )
    await db.execute(
        delete(ResearchRelation).where(
            ResearchRelation.topic_id == entity.topic_id,
            ResearchRelation.user_id == user_id,
            ((ResearchRelation.from_type == "entity") & (ResearchRelation.from_id == entity_id))
            | ((ResearchRelation.to_type == "entity") & (ResearchRelation.to_id == entity_id)),
        )
    )
    await db.delete(entity)
    await db.commit()
    return True


async def get_or_create_entity(
    db: AsyncSession,
    topic_id: int,
    name: str,
    user_id: int,
    entity_type: str = "claim_subject",
) -> ResearchEntity | None:
    normalized = _normalize_entity_name(name)
    if not normalized:
        return None
    existing = await _find_entity_by_name(db, topic_id, normalized, user_id)
    if existing:
        return existing
    return await create_entity(db, topic_id, {"name": normalized, "entity_type": entity_type}, user_id)


async def link_claim_entities(
    db: AsyncSession,
    claim_id: int,
    entity_ids: list[int],
    topic_id: int,
    user_id: int,
    role: str = "mentioned",
) -> list[int]:
    linked_ids: list[int] = []
    for entity_id in entity_ids:
        if entity_id in linked_ids:
            continue
        entity = await db.get(ResearchEntity, entity_id)
        if not entity or entity.topic_id != topic_id or entity.user_id != user_id:
            continue
        existing_link = await db.execute(
            select(ResearchClaimEntityLink).where(
                ResearchClaimEntityLink.claim_id == claim_id,
                ResearchClaimEntityLink.entity_id == entity_id,
                ResearchClaimEntityLink.user_id == user_id,
            )
        )
        if not existing_link.scalar_one_or_none():
            db.add(ResearchClaimEntityLink(
                claim_id=claim_id,
                entity_id=entity_id,
                topic_id=topic_id,
                user_id=user_id,
                role=role,
            ))
        existing_relation = await db.execute(
            select(ResearchRelation).where(
                ResearchRelation.topic_id == topic_id,
                ResearchRelation.user_id == user_id,
                ResearchRelation.from_type == "claim",
                ResearchRelation.from_id == claim_id,
                ResearchRelation.to_type == "entity",
                ResearchRelation.to_id == entity_id,
                ResearchRelation.relation_type == "mentions",
            )
        )
        if not existing_relation.scalar_one_or_none():
            db.add(ResearchRelation(
                topic_id=topic_id,
                user_id=user_id,
                from_type="claim",
                from_id=claim_id,
                to_type="entity",
                to_id=entity_id,
                relation_type="mentions",
            ))
        linked_ids.append(entity_id)
    return linked_ids
