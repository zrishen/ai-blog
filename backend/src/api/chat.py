"""聊天路由（流式 / 非流式）。"""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from src.database.models import User
from src.schemas.chat import ChatResponse
from src.schemas.conversation import MessageRequest
from src.services.agent import stream_chat
from src.utils.auth import get_current_user

router = APIRouter()

_ROUNDEND_MARKER = "\0ROUNDEND\0"
_STREAMERROR_MARKER = "\0STREAMERROR\0"
_DONE_MARKER = "\n\n\0DONE\0\n"


@router.post("/chat", response_model=ChatResponse)
async def chat(data: MessageRequest, user: User = Depends(get_current_user)):
    """Non-streaming chat endpoint."""
    final_content = ""
    last = None
    async for chunk in stream_chat(
        user_message=data.content,
        conversation_id=data.conversation_id,
        user_id=user.id,
        attachment_ids=[str(item.id) for item in data.attachments],
        thinking_mode=data.thinking_mode,
        context=data.context,
        enabled_skills=data.enabled_skills,
    ):
        if _STREAMERROR_MARKER in chunk:
            try:
                payload = json.loads(chunk.split(_STREAMERROR_MARKER, 1)[1])
                raise HTTPException(status_code=500, detail=payload.get("message", "聊天流错误"))
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=500, detail="聊天流错误") from exc
        if _ROUNDEND_MARKER in chunk:
            try:
                payload = json.loads(chunk.split(_ROUNDEND_MARKER, 1)[1])
            except json.JSONDecodeError:
                continue
            if payload.get("classification") == "final":
                final_content = payload.get("text", "")
            continue
        if _DONE_MARKER in chunk:
            try:
                last = json.loads(chunk.split(_DONE_MARKER, 1)[1])
            except json.JSONDecodeError:
                last = None

    if not final_content:
        raise HTTPException(status_code=502, detail="模型未返回最终回复，请稍后重试")

    return ChatResponse(
        content=final_content,
        conversation_id=last.get("conversation_id") if last else data.conversation_id,
        message_id=last.get("message_id") if last else 0,
    )


@router.post("/chat/stream")
async def chat_stream(data: MessageRequest, user: User = Depends(get_current_user)):
    """Streaming chat endpoint."""
    return StreamingResponse(
        stream_chat(
            user_message=data.content,
            conversation_id=data.conversation_id,
            user_id=user.id,
            attachment_ids=[str(item.id) for item in data.attachments],
            thinking_mode=data.thinking_mode,
            context=data.context,
            enabled_skills=data.enabled_skills,
        ),
        media_type="text/event-stream",
    )
