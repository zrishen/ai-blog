"""聊天路由（流式 / 非流式）。"""

import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from src.schemas.conversation import MessageRequest
from src.services.chat_service import stream_chat

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/chat")
async def chat(data: MessageRequest):
    """Non-streaming chat endpoint."""
    logger.info("Chat request: conv=%s, chars=%d", data.conversation_id, len(data.content))
    chunks = []
    async for chunk in stream_chat(data.content, data.conversation_id, data.image_url, data.file_url):
        chunks.append(chunk)
    full_text = "".join(chunks)

    last = json.loads(chunks[-1]) if chunks[-1].startswith("{") else None
    return {
        "content": full_text,
        "conversation_id": last.get("conversation_id") if last else data.conversation_id,
        "message_id": last.get("message_id") if last else None,
    }


@router.post("/chat/stream")
async def chat_stream(data: MessageRequest):
    """Streaming chat endpoint."""
    logger.info("Chat request: conv=%s, chars=%d", data.conversation_id, len(data.content))
    return StreamingResponse(
        stream_chat(data.content, data.conversation_id, data.image_url, data.file_url),
        media_type="text/event-stream",
    )
