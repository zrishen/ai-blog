from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.database.models import LLMSettings, User
from src.schemas.settings import (
    LLMSettingsResponse,
    LLMSettingsUpdate,
    SidebarSettingsResponse,
    SidebarSettingsUpdate,
)
from src.schemas.skills import SkillSettingsResponse, SkillSettingsUpdate
from src.services.agent.skill.settings_service import (
    get_user_enabled_skills,
    update_user_enabled_skills,
)
from src.services.infra.llm.llm_settings_service import (
    get_user_llm_settings,
    model_supports_thinking,
    normalize_llm_base_url,
    normalize_llm_protocol,
)
from src.utils.auth import get_current_user
from src.utils.secret_crypto import encrypt_secret

router = APIRouter()


def _response_from_settings(record: LLMSettings | None) -> LLMSettingsResponse:
    model_name = record.model_name if record and record.model_name else settings.model_name
    return LLMSettingsResponse(
        protocol=normalize_llm_protocol(record.protocol if record else None),
        base_url=normalize_llm_base_url(record.base_url if record else None),
        model=record.model_name if record and record.model_name else None,
        has_api_key=bool(record and record.api_key),
        supports_thinking=model_supports_thinking(model_name),
    )


@router.get("/settings/llm", response_model=LLMSettingsResponse)
async def get_llm_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await get_user_llm_settings(db, user.id)
    return _response_from_settings(record)


@router.put("/settings/llm", response_model=LLMSettingsResponse)
async def update_llm_settings(
    data: LLMSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await get_user_llm_settings(db, user.id)
    if record is None:
        record = LLMSettings(user_id=user.id)
        db.add(record)

    record.protocol = data.normalized_protocol()
    record.base_url = data.base_url.strip() if data.base_url else None
    record.model_name = data.model.strip() if data.model else None
    # 明确传入空值表示用户要删除 API Key；未传此字段才保留既有密钥。
    if "api_key" in data.model_fields_set:
        api_key = (data.api_key or "").strip()
        record.api_key = encrypt_secret(api_key) if api_key else None

    await db.commit()
    await db.refresh(record)
    return _response_from_settings(record)


@router.put("/settings/sidebar", response_model=SidebarSettingsResponse)
async def update_sidebar_settings(
    data: SidebarSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select

    from src.database.models import BlogSidebarSettings

    result = await db.execute(select(BlogSidebarSettings).where(BlogSidebarSettings.user_id == user.id))
    record = result.scalar_one_or_none()
    if record is None:
        record = BlogSidebarSettings(user_id=user.id, show_tags=data.show_tags)
        db.add(record)
    else:
        record.show_tags = data.show_tags
    await db.commit()
    return SidebarSettingsResponse(show_tags=record.show_tags)


@router.get("/settings/skills", response_model=SkillSettingsResponse)
async def get_skill_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    enabled = await get_user_enabled_skills(db, user.id)
    return SkillSettingsResponse(enabled_skills=enabled)


@router.put("/settings/skills", response_model=SkillSettingsResponse)
async def update_skill_settings(
    data: SkillSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    enabled = await update_user_enabled_skills(db, user.id, data.enabled_skills)
    return SkillSettingsResponse(enabled_skills=enabled)
