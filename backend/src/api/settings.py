from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.database.models import LLMSettings, User
from src.schemas.settings import LLMSettingsResponse, LLMSettingsUpdate
from src.services.llm_settings_service import get_user_llm_settings, model_supports_thinking, normalize_llm_protocol
from src.utils.auth import get_current_user
from src.utils.secret_crypto import decrypt_secret, encrypt_secret

router = APIRouter()


def _response_from_settings(record: LLMSettings | None) -> LLMSettingsResponse:
    model_name = record.model_name if record and record.model_name else settings.model_name
    return LLMSettingsResponse(
        protocol=normalize_llm_protocol(record.protocol if record else None),
        base_url=record.base_url if record and record.base_url else None,
        model=record.model_name if record and record.model_name else None,
        api_key=decrypt_secret(record.api_key) if record and record.api_key else None,
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
    if data.api_key and data.api_key.strip():
        record.api_key = encrypt_secret(data.api_key.strip())

    await db.commit()
    await db.refresh(record)
    return _response_from_settings(record)
