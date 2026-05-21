from datetime import datetime
from typing import Optional

from pydantic import BaseModel


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


class MessageRequest(BaseModel):
    content: str
    conversation_id: Optional[int] = None
    image_url: Optional[str] = None
    file_url: Optional[str] = None


class MemoryCompactRequest(BaseModel):
    conversation_id: int


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    image_url: Optional[str] = None
    file_url: Optional[str] = None
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    message: MessageResponse
    conversation: ConversationResponse
