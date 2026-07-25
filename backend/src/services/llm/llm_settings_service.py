from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import LLMSettings
from src.utils.secret_crypto import decrypt_secret

SUPPORTED_LLM_PROTOCOLS = ("openai", "anthropic")

# 支持可调节推理强度的模型名关键词（不区分大小写）
_THINKING_CAPABLE_KEYWORDS = (
    "deepseek",
    "qwq",
    "o1",
    "o3",
    "o4",
    "gpt-5",
    "claude",
    "glm",
    "kimi",
    "reasoning",
    "think",
    "qwen3",
)

THINKING_EFFORT_BY_MODE = {
    "fast": "low",
    "balanced": "medium",
    "smart": "high",
}


def model_supports_thinking(model_name: str | None) -> bool:
    """根据模型名判断是否支持深度思考。"""
    if not model_name:
        return False
    name_lower = model_name.lower()
    return any(kw in name_lower for kw in _THINKING_CAPABLE_KEYWORDS)


def normalize_llm_protocol(protocol: str | None) -> str:
    value = (protocol or "openai").strip().lower()
    return value if value in SUPPORTED_LLM_PROTOCOLS else "openai"


async def get_user_llm_settings(db: AsyncSession, user_id: int) -> LLMSettings | None:
    result = await db.execute(select(LLMSettings).where(LLMSettings.user_id == user_id))
    return result.scalar_one_or_none()


def build_llm_model_kwargs(
    thinking_mode: str,
    llm_settings: LLMSettings | None = None,
    *,
    allow_official_fallback: bool = False,
) -> dict[str, Any]:
    """构造 LLM 调用参数。

    - allow_official_fallback=True：DB 无记录或缺字段时回退到 .env 官方配置，
      用于访客公共聊天等"平台买单"场景。
    - allow_official_fallback=False（默认）：要求 llm_settings 必须提供 api_key，
      缺则 kwargs.api_key=None，由上层判断并拒绝调用。用于登录用户自有 key 场景。
    """
    protocol = normalize_llm_protocol(llm_settings.protocol if llm_settings else None)
    has_custom_model = bool(llm_settings and llm_settings.model_name)

    user_api_key = decrypt_secret(llm_settings.api_key) if llm_settings and llm_settings.api_key else None
    user_base_url = llm_settings.base_url if llm_settings and llm_settings.base_url else None

    if allow_official_fallback:
        api_key = user_api_key or settings.openai_api_key
        base_url = user_base_url or settings.base_url
        model = llm_settings.model_name if has_custom_model else settings.model_name
    else:
        api_key = user_api_key
        base_url = user_base_url
        model = llm_settings.model_name if has_custom_model else None

    kwargs: dict[str, Any] = {
        "protocol": protocol,
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "temperature": settings.llm_temperature,
    }

    if settings.llm_max_output_tokens:
        kwargs["max_tokens"] = settings.llm_max_output_tokens

    if thinking_mode == "smart" and allow_official_fallback and not has_custom_model:
        kwargs["model"] = settings.smart_thinking_model_name or settings.model_name

    if model_supports_thinking(kwargs.get("model")):
        kwargs["reasoning_effort"] = THINKING_EFFORT_BY_MODE.get(thinking_mode, "medium")

    return kwargs


def has_usable_api_key(model_kwargs: dict[str, Any]) -> bool:
    """判断 build_llm_model_kwargs 产出的 kwargs 是否带可用 api_key。

    用于 allow_official_fallback=False 路径下,登录用户没自填 key 时拒绝调用。
    """
    return bool(model_kwargs.get("api_key"))
