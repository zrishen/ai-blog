"""admin 用量统计 service：单用户周用量 + 全局概览指标（只读聚合查询）。"""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import RedemptionCode, SubscriptionWeeklyUsage, User
from src.services.accounts.subscription import (
    current_period_yw,
    get_weekly_usage,
    is_subscription_active,
)


def _naive_utc_now() -> datetime:
    """naive UTC now（与 subscription_expires_at 存储口径一致）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def get_user_weekly_usage(db: AsyncSession, user_id: int) -> dict:
    """单用户本周用量概览，返回 {user_id, username, active, period, used, limit, remaining}；用户不存在抛 LookupError。"""
    user = await db.get(User, user_id)
    if user is None:
        raise LookupError(f"用户不存在: user_id={user_id}")

    limit = settings.subscription_weekly_token_limit
    used = await get_weekly_usage(db, user_id)
    return {
        "user_id": user.id,
        "username": user.username,
        "active": is_subscription_active(user),
        "period": current_period_yw(),
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
    }


async def get_overview(db: AsyncSession) -> dict:
    """全局指标与注册状态：用户、订阅、兑换码、本周 token、邀请码。"""
    period = current_period_yw()
    now = _naive_utc_now()

    total_users = (
        await db.execute(select(func.count(User.id)))
    ).scalar_one()

    active_subscriptions = (
        await db.execute(
            select(func.count(User.id)).where(
                User.subscription_expires_at.is_not(None),
                User.subscription_expires_at > now,
            )
        )
    ).scalar_one()

    codes_total = (
        await db.execute(select(func.count(RedemptionCode.id)))
    ).scalar_one()

    codes_used = (
        await db.execute(
            select(func.count(RedemptionCode.id)).where(
                RedemptionCode.is_used.is_(True)
            )
        )
    ).scalar_one()

    this_week_tokens = (
        await db.execute(
            select(
                func.coalesce(func.sum(SubscriptionWeeklyUsage.tokens_used), 0)
            ).where(SubscriptionWeeklyUsage.period_yw == period)
        )
    ).scalar_one()

    return {
        "total_users": total_users,
        "active_subscriptions": active_subscriptions,
        "codes_total": codes_total,
        "codes_used": codes_used,
        "this_week_tokens": this_week_tokens,
        "registration_invite_code": settings.registration_invite_code.strip() or None,
    }
