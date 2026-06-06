from datetime import datetime
from typing import Literal, Optional

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
    use_rag: bool = False
    rag_mode: Literal["normal", "knowledge", "auto"] | None = None
    thinking_mode: Literal["normal", "deep"] = "normal"
    context: Optional[dict] = None


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



