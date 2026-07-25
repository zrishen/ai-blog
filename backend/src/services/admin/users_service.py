"""管理员用户管理：用户列表（username ilike 搜索）+ 直接延期订阅。

延续 redemption_service.redeem 的续期范式：未过期 expires_at+days（叠加），过期/无 now+days。
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import User


async def list_users(
    db: AsyncSession,
    *,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[User], int]:
    """用户列表（username ilike 搜索，按 id 升序），返回 (items, total)。

    search 为 None 或空时返回全部；total 用 select(func.count()) 独立计数。
    """
    stmt = select(User).order_by(User.id.asc())
    count_stmt = select(func.count(User.id))
    if search:
        like = f"%{search}%"
        stmt = stmt.where(User.username.ilike(like))
        count_stmt = count_stmt.where(User.username.ilike(like))
    stmt = stmt.offset(offset).limit(limit)

    items = list((await db.execute(stmt)).scalars().all())
    total = int((await db.execute(count_stmt)).scalar_one())
    return items, total


async def grant_subscription(
    db: AsyncSession,
    user_id: int,
    days: int,
    *,
    now: datetime | None = None,
) -> datetime:
    """管理员直接给用户延期订阅（不走兑换码），返回新的 subscription_expires_at（naive UTC）。

    续期逻辑同 redemption_service.redeem：未过期 expires_at+days（叠加），过期/无 now+days。
    用户不存在抛 LookupError。
    """
    user = await db.get(User, user_id)
    if user is None:
        raise LookupError(f"用户不存在: {user_id}")

    now_naive = now or datetime.now(timezone.utc).replace(tzinfo=None)
    duration = timedelta(days=days)
    if user.subscription_expires_at and user.subscription_expires_at > now_naive:
        new_expires = user.subscription_expires_at + duration  # 未过期：叠加
    else:
        new_expires = now_naive + duration  # 过期/无：now + duration

    user.subscription_expires_at = new_expires
    await db.commit()
    return new_expires


async def set_admin(db: AsyncSession, user_id: int, is_admin: bool) -> User:
    """设置/撤销用户管理员身份，返回更新后的用户。用户不存在抛 LookupError。"""
    user = await db.get(User, user_id)
    if user is None:
        raise LookupError(f"用户不存在: {user_id}")
    if user.is_super_admin:
        raise ValueError("不能修改超级管理员的管理员身份")
    user.is_admin = is_admin
    await db.commit()
    await db.refresh(user)
    return user
