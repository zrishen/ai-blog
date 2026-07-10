from pydantic import BaseModel, Field

from src.services.llm_settings_service import SUPPORTED_LLM_PROTOCOLS


class LLMSettingsResponse(BaseModel):
    protocol: str
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    has_api_key: bool = False
    supports_thinking: bool = False


class LLMSettingsUpdate(BaseModel):
    protocol: str = Field(default="openai")
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None

    def normalized_protocol(self) -> str:
        value = self.protocol.strip().lower()
        if value not in SUPPORTED_LLM_PROTOCOLS:
            return "openai"
        return value
