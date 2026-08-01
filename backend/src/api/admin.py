"""管理员后台 API：所有端点需 require_admin 守卫。"""

from fastapi import APIRouter, Depends

from src.database.models import User
from src.utils.auth import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/ping")
async def admin_ping(_: User = Depends(require_admin)) -> dict:
    """管理员鉴权探活：非管理员 403。"""
    return {"ok": True}
