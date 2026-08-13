from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from src.schemas.chat_attachment import ChatAttachmentResponse


class ConversationCreate(BaseModel):
    title: str = "New Chat"


class ConversationResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    conversations: list[ConversationResponse]


class MessageAttachmentRequest(BaseModel):
    id: UUID


class MessageRequest(BaseModel):
    content: str
    conversation_id: int | None = None
    attachments: list[MessageAttachmentRequest] = Field(default_factory=list, max_length=20)
    thinking_mode: Literal["fast", "balanced", "smart"] = "balanced"
    context: dict | None = None
    enabled_skills: list[str] | None = None  # None=后端默认全开；[]=显式全关；非空=显式子集


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    image_url: str | None = None
    file_url: str | None = None
    attachments: list[ChatAttachmentResponse] = Field(default_factory=list)
    token_count: int
    created_at: datetime
    reasoningContent: str | None = None
    thinkingContent: str | None = None
    toolEvents: list[dict] | None = None
    loopSteps: list[str] | None = None
    thinkingDurationMs: int | None = None
    thinkingMode: str | None = None

    model_config = {"from_attributes": True}
