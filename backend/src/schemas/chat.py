from typing import Optional

from pydantic import BaseModel


class ChatResponse(BaseModel):
    content: str
    conversation_id: Optional[int] = None
    message_id: int
