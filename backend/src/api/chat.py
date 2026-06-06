"""聊天路由（流式 / 非流式）。"""

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from src.database.models import User
from src.schemas.chat import ChatResponse
from src.schemas.conversation import MessageRequest
from src.services.chat_service import stream_chat
from src.utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/chat", response_model=ChatResponse)
async def chat(data: MessageRequest, user: User = Depends(get_current_user)):
    """Non-streaming chat endpoint."""
    logger.info(
        "Chat request: conv=%s, chars=%d, use_rag=%s, rag_mode=%s, thinking_mode=%s",
        data.conversation_id,
        len(data.content),
        data.use_rag,
        data.rag_mode,
        data.thinking_mode,
    )
    content_chunks = []
    last = None
    async for chunk in stream_chat(
        data.content,
        data.conversation_id,
        user.id,
        data.image_url,
        data.file_url,
        data.use_rag,
        data.rag_mode,
        data.thinking_mode,
        data.context,
    ):
        marker = "\n\n\0DONE\0\n"
        if marker in chunk:
            before_marker, metadata = chunk.split(marker, 1)
            if before_marker:
                content_chunks.append(before_marker)
            last = json.loads(metadata)
            continue
        content_chunks.append(chunk)

    return ChatResponse(
        content="".join(content_chunks),
        conversation_id=last.get("conversation_id") if last else data.conversation_id,
        message_id=last.get("message_id") if last else 0,
    )


@router.post("/chat/stream")
async def chat_stream(data: MessageRequest, user: User = Depends(get_current_user)):
    """Streaming chat endpoint."""
    logger.info(
        "Chat request: conv=%s, chars=%d, use_rag=%s, rag_mode=%s, thinking_mode=%s",
        data.conversation_id,
        len(data.content),
        data.use_rag,
        data.rag_mode,
        data.thinking_mode,
    )
    return StreamingResponse(
        stream_chat(
            data.content,
            data.conversation_id,
            user.id,
            data.image_url,
            data.file_url,
            data.use_rag,
            data.rag_mode,
            data.thinking_mode,
            data.context,
        ),
        media_type="text/event-stream",
    )
