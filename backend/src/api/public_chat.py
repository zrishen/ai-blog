"""公开受限 AI 聊天路由。"""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.services.public_chat_service import public_stream_chat

router = APIRouter()
logger = logging.getLogger(__name__)


class PublicChatRequest(BaseModel):
    content: str
    post_slug: str | None = None


@router.post("/public/chat/stream")
async def public_landing_chat_stream(
    data: PublicChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """落地页公开 AI：只聊天，不绑定工具、MCP 或知识库。"""
    logger.info("Public landing chat request: chars=%d", len(data.content))
    return StreamingResponse(
        public_stream_chat(db, data.content),
        media_type="text/event-stream",
    )


@router.post("/public/users/{username}/chat/stream")
async def public_user_chat_stream(
    username: str,
    data: PublicChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """用户站点访客 AI：只基于公开内容聊天，不绑定私有能力。"""
    logger.info("Public user chat request: username=%s, chars=%d", username, len(data.content))
    return StreamingResponse(
        public_stream_chat(db, data.content, username=username, post_slug=data.post_slug),
        media_type="text/event-stream",
    )
