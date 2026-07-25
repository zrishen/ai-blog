"""订阅模型测试：User 订阅/管理员字段 + 兑换码 + 周用量 upsert（配额扣减范式）。"""

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from src.database.models import (
    RedemptionCode,
    SubscriptionWeeklyUsage,
    User,
    _utcnow,
)


@pytest.mark.asyncio
async def test_user_defaults_not_admin_no_subscription(db_session):
    user = User(username="alice", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    assert user.is_admin is False
    assert user.is_super_admin is False
    assert user.subscription_expires_at is None


@pytest.mark.asyncio
async def test_redemption_code_persist(db_session):
    user = User(username="bob", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    code = RedemptionCode(
        code="ABCD-1234",
        duration_days=30,
        created_by_admin_id=user.id,
    )
    db_session.add(code)
    await db_session.commit()

    fetched = await db_session.get(RedemptionCode, code.id)
    assert fetched.code == "ABCD-1234"
    assert fetched.duration_days == 30
    assert fetched.is_used is False
    assert fetched.used_by_user_id is None


@pytest.mark.asyncio
async def test_weekly_usage_upsert_accumulates_tokens(db_session):
    """周用量 upsert：同 user+period 累加 token（订阅配额扣减范式，同 PublicChatDailyUsage）。"""
    user = User(username="carol", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    period = "2026-W30"

    async def consume(tokens: int) -> None:
        now = _utcnow()
        stmt = (
            sqlite_insert(SubscriptionWeeklyUsage)
            .values(
                user_id=user.id,
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
        )
        await db_session.execute(stmt)
        await db_session.commit()

    await consume(1000)
    await consume(2500)

    result = await db_session.execute(
        select(SubscriptionWeeklyUsage).where(
            SubscriptionWeeklyUsage.user_id == user.id,
            SubscriptionWeeklyUsage.period_yw == period,
        )
    )
    usage = result.scalar_one()
    assert usage.tokens_used == 3500
