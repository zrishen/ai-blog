from pydantic import BaseModel, Field, field_validator

from src.services.infra.llm.llm_settings_service import (
    SUPPORTED_LLM_PROTOCOLS,
    normalize_llm_base_url,
)


class LLMSettingsResponse(BaseModel):
    protocol: str
    base_url: str | None = None
    model: str | None = None
    has_api_key: bool = False
    supports_thinking: bool = False


class LLMSettingsUpdate(BaseModel):
    protocol: str = Field(default="openai")
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        normalized = normalize_llm_base_url(value)
        if value is not None and value.strip() and normalized is None:
            raise ValueError("Base URL 必须是以 http:// 或 https:// 开头的有效地址")
        return normalized

    def normalized_protocol(self) -> str:
        value = self.protocol.strip().lower()
        if value not in SUPPORTED_LLM_PROTOCOLS:
            return "openai"
        return value


class SidebarSettingsUpdate(BaseModel):
    show_tags: bool = True


class SidebarSettingsResponse(BaseModel):
    show_tags: bool = True
