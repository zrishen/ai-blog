"""Skill 目录投影 + 用户 skill 设置持久化。

- list_skill_descriptors：从 SKILL_REGISTRY 投影前端展示用概要。
- normalize_enabled_skill_ids：PUT 写路径校验（未知 id 抛 ValidationFailedError → 422）。
- get_user_enabled_skills：GET 读路径（默认值/已保存值都过滤未知 id 不抛错，被动读不阻塞用户）。
- update_user_enabled_skills：upsert 持久化。
"""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ValidationFailedError
from src.database.models import UserSkillSettings
from src.database.models.base import _utcnow

from .descriptor import DEFAULT_ENABLED_SKILLS, SKILL_REGISTRY, SkillDescriptor


def list_skill_descriptors() -> tuple[SkillDescriptor, ...]:
    """按 SKILL_REGISTRY 声明顺序返回全部 skill 描述符。"""

    return tuple(SKILL_REGISTRY.values())


def normalize_enabled_skill_ids(enabled_skill_ids: Sequence[str]) -> list[str]:
    """PUT 写路径专用：校验 + 去重 + registry 顺序规范化。

    未知 id 抛 ValidationFailedError（→ 422），避免把无效选择写入数据库。
    """

    requested = list(dict.fromkeys(enabled_skill_ids))  # 保序去重
    requested_set = set(requested)
    unknown = sorted(requested_set.difference(SKILL_REGISTRY))
    if unknown:
        raise ValidationFailedError(
            "包含未知 skill",
            details={"unknown_skill_ids": unknown},
        )
    return [sid for sid in SKILL_REGISTRY if sid in requested_set]


async def get_user_enabled_skills(db: AsyncSession, user_id: int) -> list[str]:
    """GET 读路径：返回当前用户的有效 skill 选择，按 registry 顺序规范化。

    - 无记录：返回 DEFAULT_ENABLED_SKILLS（不创建行，保持「无偏好」与「显式全关」可区分）。
    - 已保存值：过滤掉 registry 演进后已不存在的 id（容错，不抛错）。
    """

    record = (
        await db.execute(select(UserSkillSettings).where(UserSkillSettings.user_id == user_id))
    ).scalar_one_or_none()
    if record is None:
        return [sid for sid in SKILL_REGISTRY if sid in DEFAULT_ENABLED_SKILLS]
    known = {sid for sid in record.enabled_skills if sid in SKILL_REGISTRY}
    return [sid for sid in SKILL_REGISTRY if sid in known]


async def update_user_enabled_skills(db: AsyncSession, user_id: int, enabled_skill_ids: Sequence[str]) -> list[str]:
    """PUT 写路径：校验后 upsert 持久化，返回规范化后的列表。"""

    normalized = normalize_enabled_skill_ids(enabled_skill_ids)
    now = _utcnow()
    stmt = (
        pg_insert(UserSkillSettings)
        .values(
            user_id=user_id,
            enabled_skills=normalized,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"enabled_skills": normalized, "updated_at": now},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return normalized
