"""admin 用量统计 API：单用户周用量 + 全局概览。所有端点 require_admin。"""

from fastapi import APIRouter, Depends, HTTPException, status

from src.database.models import User
from src.database.session import async_session
from src.services.admin.usage_service import get_overview, get_user_weekly_usage
from src.utils.auth import require_admin

router = APIRouter(prefix="/admin/usage", tags=["admin"])


@router.get("/user/{user_id}")
async def get_user_usage(
    user_id: int,
    _: User = Depends(require_admin),
) -> dict:
    async with async_session() as db:
        try:
            return await get_user_weekly_usage(db, user_id)
        except LookupError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.get("/overview")
async def get_usage_overview(_: User = Depends(require_admin)) -> dict:
    async with async_session() as db:
        return await get_overview(db)
