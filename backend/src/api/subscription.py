"""用户订阅 API：兑换码激活 + 订阅状态查询（含周配额）。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.database.models import User
from src.services.accounts.subscription import (
    current_period_yw,
    get_weekly_usage,
    is_subscription_active,
    redeem,
)
from src.utils.auth import get_current_user

router = APIRouter(prefix="/subscription", tags=["subscription"])


class RedeemRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)


class SubscriptionStatus(BaseModel):
    active: bool
    expires_at: datetime | None = None
    period: str | None = None
    used: int = 0
    limit: int = 0
    remaining: int = 0


@router.post("/redeem", response_model=SubscriptionStatus)
async def redeem_code(
    payload: RedeemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionStatus:
    try:
        new_expires = await redeem(db, user_id=user.id, code_str=payload.code.strip())
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return SubscriptionStatus(active=True, expires_at=new_expires)


@router.get("/status", response_model=SubscriptionStatus)
async def get_subscription_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionStatus:
    """订阅状态 + 本周 token 配额（used/limit/remaining/period）。"""
    limit = settings.subscription_weekly_token_limit
    used = await get_weekly_usage(db, user.id)
    return SubscriptionStatus(
        active=is_subscription_active(user),
        expires_at=user.subscription_expires_at,
        period=current_period_yw(),
        used=used,
        limit=limit,
        remaining=max(0, limit - used),
    )
