"""订阅配额核心：ISO 周窗口 + 订阅有效性 + 周用量累加 + 配额判断。

订阅用户走平台 key 按 token 周额度限制，超额/到期回退 BYOK；配额事后扣（请求后扣真实 usage）；
窗口为 ISO 周（周一 00:00 UTC+8 重置），累加用 PostgreSQL upsert（on_conflict_do_update）。
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import SubscriptionWeeklyUsage, User

CHINA_TZ = timezone(timedelta(hours=8))


def current_period_yw(now: datetime | None = None) -> str:
    """当前 ISO 周（周一 UTC+8 重置），格式 'YYYY-Www'，如 '2026-W30'。"""
    current = now or datetime.now(CHINA_TZ)
    iso = current.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def is_subscription_active(user: User, *, now: datetime | None = None) -> bool:
    """订阅是否在有效期内（subscription_expires_at 为 naive UTC）。"""
    if not user.subscription_expires_at:
        return False
    current = now or datetime.now(timezone.utc).replace(tzinfo=None)
    return user.subscription_expires_at > current


async def get_weekly_usage(db: AsyncSession, user_id: int, *, period: str | None = None) -> int:
    """本周已用 token（无记录则 0）。"""
    period = period or current_period_yw()
    result = await db.execute(
        select(SubscriptionWeeklyUsage.tokens_used).where(
            SubscriptionWeeklyUsage.user_id == user_id,
            SubscriptionWeeklyUsage.period_yw == period,
        )
    )
    return result.scalar_one_or_none() or 0


async def is_weekly_quota_available(db: AsyncSession, user_id: int) -> bool:
    """本周配额是否还有剩余（事后扣：已用 >= 上限 → 超额，下次回退 BYOK）。"""
    used = await get_weekly_usage(db, user_id)
    return used < settings.subscription_weekly_token_limit


async def consume_tokens(
    db: AsyncSession,
    user_id: int,
    tokens: int,
    *,
    period: str | None = None,
) -> int:
    """累加本周用量（upsert），返回更新后的 tokens_used。tokens<=0 时只读不写。"""
    if tokens <= 0:
        return await get_weekly_usage(db, user_id, period=period)
    period = period or current_period_yw()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    stmt = (
        pg_insert(SubscriptionWeeklyUsage)
        .values(
            user_id=user_id,
            period_yw=period,
            tokens_used=tokens,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "period_yw"],
            set_={
                "tokens_used": SubscriptionWeeklyUsage.tokens_used + tokens,
                "updated_at": now,
            },
        )
        .returning(SubscriptionWeeklyUsage.tokens_used)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.scalar_one()


async def should_use_platform_key(db: AsyncSession, user: User | None) -> bool:
    """订阅有效 + 周配额可用 → 用平台 key；否则回退 BYOK（到期/超额/无订阅）。"""
    if user is None or not is_subscription_active(user):
        return False
    return await is_weekly_quota_available(db, user.id)


def compute_charge_tokens(
    *,
    usage_metadata: dict | None,
    fallback_input: int = 0,
    fallback_output: int = 0,
    fallback_reasoning: int = 0,
) -> int:
    """本次应扣 token：优先 provider 真实 usage（input+output+reasoning），否则 fallback 估算之和。"""
    if usage_metadata:
        return (
            int(usage_metadata.get("input_tokens") or 0)
            + int(usage_metadata.get("output_tokens") or 0)
            + int(usage_metadata.get("reasoning_tokens") or 0)
        )
    return fallback_input + fallback_output + fallback_reasoning
