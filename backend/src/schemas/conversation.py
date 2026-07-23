from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

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
    conversation_id: Optional[int] = None
    image_url: Optional[str] = None
    file_url: Optional[str] = None
    attachments: list[MessageAttachmentRequest] = Field(default_factory=list, max_length=20)
    thinking_mode: Literal["fast", "balanced", "smart"] = "balanced"
    context: Optional[dict] = None

    @model_validator(mode="after")
    def validate_attachment_fields(self) -> "MessageRequest":
        if self.attachments and (self.image_url or self.file_url):
            raise ValueError("attachments 不能与 image_url 或 file_url 同时使用")
        return self


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    image_url: Optional[str] = None
    file_url: Optional[str] = None
    attachments: list[ChatAttachmentResponse] = Field(default_factory=list)
    token_count: int
    created_at: datetime
    reasoningContent: Optional[str] = None
    thinkingContent: Optional[str] = None
    toolEvents: Optional[list[dict]] = None
    loopSteps: Optional[list[str]] = None
    thinkingDurationMs: Optional[int] = None
    thinkingMode: Optional[str] = None

    model_config = {"from_attributes": True}



