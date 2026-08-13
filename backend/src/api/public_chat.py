"""公开受限 AI 聊天路由。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.services.accounts.public_chat.public_chat_rate_limit_service import consume_public_chat_request
from src.services.accounts.public_chat.public_chat_service import public_stream_chat

router = APIRouter()
logger = logging.getLogger(__name__)


class PublicChatRequest(BaseModel):
    content: str
    post_slug: str | None = None


async def _enforce_public_chat_limit(request: Request, db: AsyncSession) -> None:
    client_ip = request.client.host if request.client else "unknown"
    if await consume_public_chat_request(db, client_ip) is None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"今日公开 AI 请求次数已用完（每个 IP 每天最多 {settings.public_chat_daily_ip_limit} 次）",
        )


@router.post("/public/chat/stream")
async def public_landing_chat_stream(
    data: PublicChatRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """落地页公开 AI：只聊天，不绑定工具、MCP 或文件库。"""
    await _enforce_public_chat_limit(request, db)
    logger.info("Public landing chat request: chars=%d", len(data.content))
    return StreamingResponse(
        public_stream_chat(db, data.content),
        media_type="text/event-stream",
    )


@router.post("/public/users/{username}/chat/stream")
async def public_user_chat_stream(
    username: str,
    data: PublicChatRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """用户站点访客 AI：只基于公开内容聊天，不绑定私有能力。"""
    await _enforce_public_chat_limit(request, db)
    logger.info("Public user chat request: username=%s, chars=%d", username, len(data.content))
    return StreamingResponse(
        public_stream_chat(db, data.content, username=username, post_slug=data.post_slug),
        media_type="text/event-stream",
    )
