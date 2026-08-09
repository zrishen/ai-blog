"""订阅配额核心测试：ISO 周 + 订阅有效性 + 周用量累加 + 配额阈值。"""

from datetime import datetime, timedelta, timezone

import pytest

from src.config import settings
from src.database.models import User
from src.services.accounts.subscription import (
    compute_charge_tokens,
    consume_tokens,
    current_period_yw,
    get_weekly_usage,
    is_subscription_active,
    is_weekly_quota_available,
    should_use_platform_key,
)

_TZ = timezone(timedelta(hours=8))


def test_current_period_yw_iso_week():
    # 2024-01-01 是周一，落在 ISO 2024-W01
    assert current_period_yw(datetime(2024, 1, 1, 12, 0, tzinfo=_TZ)) == "2024-W01"


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def test_is_subscription_active_future():
    future = _naive_utc(datetime.now(timezone.utc) + timedelta(days=5))
    user = User(username="a", password_hash="h", subscription_expires_at=future)
    assert is_subscription_active(user) is True


def test_is_subscription_active_expired():
    past = _naive_utc(datetime.now(timezone.utc) - timedelta(days=1))
    user = User(username="b", password_hash="h", subscription_expires_at=past)
    assert is_subscription_active(user) is False


def test_is_subscription_active_none():
    user = User(username="c", password_hash="h")
    assert is_subscription_active(user) is False


@pytest.mark.asyncio
async def test_consume_tokens_accumulates(db_session):
    user = User(username="d", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    assert await get_weekly_usage(db_session, user.id) == 0

    assert await consume_tokens(db_session, user.id, 1000) == 1000
    assert await consume_tokens(db_session, user.id, 2500) == 3500
    assert await get_weekly_usage(db_session, user.id) == 3500


@pytest.mark.asyncio
async def test_consume_tokens_zero_or_negative_no_write(db_session):
    user = User(username="d2", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    assert await consume_tokens(db_session, user.id, 0) == 0
    assert await get_weekly_usage(db_session, user.id) == 0


@pytest.mark.asyncio
async def test_is_weekly_quota_available_threshold(db_session, monkeypatch):
    user = User(username="e", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    monkeypatch.setattr(settings, "subscription_weekly_token_limit", 5000)
    assert await is_weekly_quota_available(db_session, user.id) is True

    await consume_tokens(db_session, user.id, 5000)
    assert await is_weekly_quota_available(db_session, user.id) is False


# --- 3c 辅助：key 选择 + usage 计算 ---

@pytest.mark.asyncio
async def test_should_use_platform_key_states(db_session, monkeypatch):
    # None user
    assert await should_use_platform_key(db_session, None) is False

    # 无订阅
    user_no = User(username="p1", password_hash="h")
    db_session.add(user_no)
    await db_session.commit()
    assert await should_use_platform_key(db_session, user_no) is False

    # 订阅有效 + 配额可用
    future = _naive_utc(datetime.now(timezone.utc) + timedelta(days=5))
    user_active = User(username="p2", password_hash="h", subscription_expires_at=future)
    db_session.add(user_active)
    await db_session.commit()
    assert await should_use_platform_key(db_session, user_active) is True

    # 订阅有效但超额 → False
    monkeypatch.setattr(settings, "subscription_weekly_token_limit", 100)
    await consume_tokens(db_session, user_active.id, 100)
    assert await should_use_platform_key(db_session, user_active) is False


def test_compute_charge_tokens_prefers_usage_metadata():
    usage = {"input_tokens": 100, "output_tokens": 50, "reasoning_tokens": 30}
    assert compute_charge_tokens(usage_metadata=usage, fallback_input=999) == 180


def test_compute_charge_tokens_fallback_when_no_usage():
    assert compute_charge_tokens(
        usage_metadata=None, fallback_input=100, fallback_output=50, fallback_reasoning=30
    ) == 180


def test_compute_charge_tokens_missing_fields():
    usage = {"input_tokens": 100}  # 缺 output/reasoning
    assert compute_charge_tokens(usage_metadata=usage) == 100
