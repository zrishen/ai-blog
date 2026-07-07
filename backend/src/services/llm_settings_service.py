from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import LLMSettings

SUPPORTED_LLM_PROTOCOLS = ("openai", "anthropic")


def normalize_llm_protocol(protocol: str | None) -> str:
    value = (protocol or "openai").strip().lower()
    return value if value in SUPPORTED_LLM_PROTOCOLS else "openai"


async def get_user_llm_settings(db: AsyncSession, user_id: int) -> LLMSettings | None:
    result = await db.execute(select(LLMSettings).where(LLMSettings.user_id == user_id))
    return result.scalar_one_or_none()


def build_llm_model_kwargs(
    thinking_mode: str,
    llm_settings: LLMSettings | None = None,
) -> dict[str, Any]:
    protocol = normalize_llm_protocol(llm_settings.protocol if llm_settings else None)
    has_custom_model = bool(llm_settings and llm_settings.model_name)

    kwargs: dict[str, Any] = {
        "protocol": protocol,
        "api_key": (llm_settings.api_key if llm_settings and llm_settings.api_key else settings.openai_api_key),
        "base_url": (llm_settings.base_url if llm_settings and llm_settings.base_url else settings.base_url),
        "model": (llm_settings.model_name if has_custom_model else settings.model_name),
        "temperature": settings.model_temperature,
    }

    if settings.model_max_output_tokens:
        kwargs["max_tokens"] = settings.model_max_output_tokens

    is_deep = thinking_mode == "deep"
    if is_deep:
        if not has_custom_model:
            kwargs["model"] = settings.deep_thinking_model_name or settings.model_name
        kwargs["temperature"] = settings.deep_thinking_temperature
        kwargs["max_tokens"] = settings.deep_thinking_max_output_tokens

    return kwargs
