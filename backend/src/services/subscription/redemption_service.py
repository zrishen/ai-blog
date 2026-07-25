"""兑换码：批量生成 + 激活/续期订阅。

续期策略：未过期则 expires_at + duration_days，已过期/无订阅则 now + duration_days。
"""

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import RedemptionCode, User

# 去歧义字符（无 I/O/0/1 等），降低用户手输错误
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_code(length: int = 12) -> str:
    """生成兑换码（默认 12 位去歧义字母数字）。"""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


async def create_codes(
    db: AsyncSession,
    *,
    count: int,
    duration_days: int,
    created_by_admin_id: int | None = None,
    note: str | None = None,
) -> list[str]:
    """批量生成兑换码（admin 用），返回生成的码列表。"""
    codes: list[str] = []
    for _ in range(count):
        code_str = generate_code()
        db.add(
            RedemptionCode(
                code=code_str,
                duration_days=duration_days,
                created_by_admin_id=created_by_admin_id,
                note=note,
            )
        )
        codes.append(code_str)
    await db.commit()
    return codes


async def redeem(db: AsyncSession, *, user_id: int, code_str: str) -> datetime:
    """兑换码激活/续期订阅，返回新的 subscription_expires_at（naive UTC）。

    续期：未过期叠加，过期/无 now+duration。
    抛 ValueError：码无效 / 已使用 / 用户不存在。
    """
    result = await db.execute(select(RedemptionCode).where(RedemptionCode.code == code_str))
    code = result.scalar_one_or_none()
    if code is None:
        raise ValueError("兑换码无效")
    if code.is_used:
        raise ValueError("兑换码已被使用")

    user = await db.get(User, user_id)
    if user is None:
        raise ValueError("用户不存在")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    duration = timedelta(days=code.duration_days)
    if user.subscription_expires_at and user.subscription_expires_at > now:
        new_expires = user.subscription_expires_at + duration  # 未过期：叠加
    else:
        new_expires = now + duration  # 过期/无：now + duration

    user.subscription_expires_at = new_expires
    code.is_used = True
    code.used_by_user_id = user_id
    code.used_at = now
    await db.commit()
    return new_expires
