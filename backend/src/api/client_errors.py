"""前端错误上报：接收浏览器运行时错误，写进 app.log 与后端日志统一回溯。

未认证端点（get_optional_user 不抛 401）：登录则记 user_id，未登录匿名，登录页崩溃也能上报。
日志走 src.api.client_errors logger，自动进 app.log（_OriginFilter 放行 src.*）并带 request_id。
per-IP 限流防前端死循环刷爆日志文件。
"""

import logging
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from src.config import settings
from src.database.models import User
from src.utils.auth import get_optional_user
from src.utils.rate_limit import check_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(tags=["client-errors"])


def _safe_client_path(url: str | None) -> str:
    """只保留路径，避免 query/fragment 中的 token、搜索词等进入日志。"""
    if not url:
        return "-"
    return urlsplit(url).path or "/"


class ClientErrorReport(BaseModel):
    message: str = Field(..., max_length=2000)
    stack: str | None = Field(default=None, max_length=8000)
    url: str | None = Field(default=None, max_length=1000)
    source: str = Field(default="window", max_length=50)  # window / unhandledrejection / error_boundary / logger


def _enforce_client_error_rate_limit(request: Request) -> None:
    """per-IP 滑动窗口限流：未认证端点，防前端死循环刷爆日志。"""
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(
        f"client_errors:{ip}",
        limit=settings.client_error_rate_limit,
        window_seconds=settings.auth_rate_limit_window_seconds,
    ):
        logger.warning("client_error rate limited ip=%s", ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )


@router.post("/client-errors")
async def report_client_error(
    body: ClientErrorReport,
    request: Request,
    user: Optional[User] = Depends(get_optional_user),
) -> dict:
    _enforce_client_error_rate_limit(request)
    ip = request.client.host if request.client else "unknown"
    user_id = user.id if user else None
    user_agent = request.headers.get("user-agent", "-")
    logger.error(
        "client_error source=%s user_id=%s ip=%s path=%s message=%.500s stack=%.1000s ua=%.500s",
        body.source, user_id, ip, _safe_client_path(body.url),
        body.message, body.stack or "", user_agent,
    )
    return {"status": "ok"}
