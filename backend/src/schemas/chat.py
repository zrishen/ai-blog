from pydantic import BaseModel


class ChatResponse(BaseModel):
    content: str
    conversation_id: int | None = None
    message_id: int
