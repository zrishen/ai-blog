"""状态检查路由。

未认证的健康检查（供探活 / 监控）：只回总体 ok/degraded 与各组件 ok/error，异常详情记
日志不外泄，避免暴露内部拓扑；IP 级限流防高频请求放大 DB / 磁盘 / 图库探测负载。
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status

from src.config import settings
from src.schemas.status import StatusComponents, StatusResponse
from src.services.workspace.file.file_service import UPLOAD_DIR
from src.utils.rate_limit import check_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()


def _enforce_status_rate_limit(request: Request) -> None:
    """per-IP 滑动窗口限流：未认证端点，防高频请求放大 DB / 磁盘 / 图库探测负载。"""
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(
        f"status:{ip}",
        limit=settings.status_rate_limit,
        window_seconds=settings.auth_rate_limit_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )


@router.get("/status", response_model=StatusResponse)
async def check_status(request: Request):
    """健康检查：database / uploads / 图库（FalkorDB）。组件状态只回 ok/error，异常详情记日志。"""
    _enforce_status_rate_limit(request)

    db_status = "ok"
    uploads_status = "ok"
    graph_status = "ok"
    brain_status = "disabled"
    overall = "ok"

    try:
        from sqlalchemy import text

        from src.database.engine import engine

        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.commit()
    except Exception:
        logger.warning("/status database check failed", exc_info=True)
        db_status = "error"
        overall = "degraded"

    try:
        # 仅确保目录存在可写，不遍历统计（防磁盘 IO 被高频请求放大）
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        logger.warning("/status uploads check failed", exc_info=True)
        uploads_status = "error"
        overall = "degraded"

    # 图库 FalkorDB：vector_store 与 brain 共用同一实例，ping 一次即可
    graph_ok = False
    try:
        from src.services.memory import graph_store

        graph_ok = await graph_store.ping()
    except Exception:
        logger.warning("/status graph store ping failed", exc_info=True)
    if not graph_ok:
        graph_status = "error"
        overall = "degraded"
    if settings.memory_enabled:
        brain_status = graph_status

    return StatusResponse(
        status=overall,
        timestamp=datetime.now(timezone.utc).isoformat(),
        components=StatusComponents(
            database=db_status,
            uploads=uploads_status,
            vector_store=graph_status,
            brain=brain_status,
        ),
    )
