"""管理员用户管理 API：用户列表 + 直接延期订阅。所有端点需 require_admin 守卫。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.database.models import User
from src.database.session import async_session
from src.services.admin.users_service import grant_subscription, list_users, set_admin
from src.utils.auth import require_admin, require_super_admin

router = APIRouter(prefix="/admin/users", tags=["admin"])


class UserItem(BaseModel):
    id: int
    username: str
    is_admin: bool
    is_super_admin: bool
    subscription_expires_at: datetime | None = None
    created_at: datetime | None = None


class ListUsersResponse(BaseModel):
    items: list[UserItem]
    total: int
    offset: int
    limit: int


class GrantSubscriptionRequest(BaseModel):
    days: int = Field(..., ge=1, le=3650)


class GrantSubscriptionResponse(BaseModel):
    subscription_expires_at: datetime


def _to_item(user: User) -> UserItem:
    return UserItem(
        id=user.id,
        username=user.username,
        is_admin=user.is_admin,
        is_super_admin=user.is_super_admin,
        subscription_expires_at=user.subscription_expires_at,
        created_at=user.created_at,
    )


@router.get("", response_model=ListUsersResponse)
async def get_users(
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
    _: User = Depends(require_admin),
) -> ListUsersResponse:
    """用户列表（username ilike 搜索，支持分页）。"""
    async with async_session() as db:
        items, total = await list_users(db, search=search, offset=offset, limit=limit)
    return ListUsersResponse(
        items=[_to_item(u) for u in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/{user_id}/subscription/grant",
    response_model=GrantSubscriptionResponse,
)
async def grant_user_subscription(
    user_id: int,
    payload: GrantSubscriptionRequest,
    _: User = Depends(require_admin),
) -> GrantSubscriptionResponse:
    """管理员直接给指定用户延期订阅（不走兑换码）。用户不存在返回 404。"""
    async with async_session() as db:
        try:
            new_expires = await grant_subscription(db, user_id, payload.days)
        except LookupError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return GrantSubscriptionResponse(subscription_expires_at=new_expires)


class SetAdminRequest(BaseModel):
    is_admin: bool


@router.put("/{user_id}/admin", response_model=UserItem)
async def set_user_admin(
    user_id: int,
    payload: SetAdminRequest,
    _: User = Depends(require_super_admin),
) -> UserItem:
    """超级管理员授权/撤销普通管理员身份。用户不存在返回 404。"""
    async with async_session() as db:
        try:
            user = await set_admin(db, user_id, payload.is_admin)
        except LookupError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    return _to_item(user)
