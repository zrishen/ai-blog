"""admin 用量统计测试：get_user_weekly_usage + get_overview + require_admin 守卫。

service 层用 db_session fixture（内存 SQLite）；集成测试通过临时挂载 usage_router
到 app（带 /api/v1 前缀，结束后清理）验证非 admin 403。
"""

from datetime import datetime, timedelta, timezone

import pytest

from src.config import settings
from src.database.models import RedemptionCode, SubscriptionWeeklyUsage, User
from src.services.admin.usage_service import get_overview, get_user_weekly_usage
from src.services.subscription import consume_tokens, current_period_yw


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


# --- get_user_weekly_usage ---

@pytest.mark.asyncio
async def test_get_user_weekly_usage_with_record(db_session):
    user = User(username="u1", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    period = current_period_yw()
    db_session.add(
        SubscriptionWeeklyUsage(user_id=user.id, period_yw=period, tokens_used=3000)
    )
    await db_session.commit()

    limit = settings.subscription_weekly_token_limit
    result = await get_user_weekly_usage(db_session, user.id)
    assert result == {
        "user_id": user.id,
        "username": "u1",
        "active": False,
        "period": period,
        "used": 3000,
        "limit": limit,
        "remaining": max(0, limit - 3000),
    }


@pytest.mark.asyncio
async def test_get_user_weekly_usage_no_record_zero(db_session):
    user = User(username="u2", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    result = await get_user_weekly_usage(db_session, user.id)
    assert result["used"] == 0
    assert result["remaining"] == settings.subscription_weekly_token_limit
    assert result["active"] is False


@pytest.mark.asyncio
async def test_get_user_weekly_usage_active_subscription(db_session):
    future = _naive_utc(datetime.now(timezone.utc) + timedelta(days=3))
    user = User(username="u3", password_hash="h", subscription_expires_at=future)
    db_session.add(user)
    await db_session.commit()

    result = await get_user_weekly_usage(db_session, user.id)
    assert result["active"] is True


@pytest.mark.asyncio
async def test_get_user_weekly_usage_remaining_clamped_to_zero(db_session, monkeypatch):
    monkeypatch.setattr(settings, "subscription_weekly_token_limit", 100)
    user = User(username="u4", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    await consume_tokens(db_session, user.id, 300)  # used=300 > limit=100

    result = await get_user_weekly_usage(db_session, user.id)
    assert result["used"] == 300
    assert result["limit"] == 100
    assert result["remaining"] == 0


@pytest.mark.asyncio
async def test_get_user_weekly_usage_user_not_found(db_session):
    with pytest.raises(LookupError):
        await get_user_weekly_usage(db_session, 99999)


# --- get_overview ---

@pytest.mark.asyncio
async def test_get_overview_counts(db_session):
    now = _naive_utc(datetime.now(timezone.utc))
    future = now + timedelta(days=5)
    past = now - timedelta(days=1)

    # 3 用户：1 有效订阅 / 1 过期订阅 / 1 无订阅
    u_active = User(username="a1", password_hash="h", subscription_expires_at=future)
    u_expired = User(username="a2", password_hash="h", subscription_expires_at=past)
    u_none = User(username="a3", password_hash="h")
    db_session.add_all([u_active, u_expired, u_none])
    await db_session.commit()

    # 4 兑换码：2 已用 / 2 未用
    for i in range(4):
        db_session.add(
            RedemptionCode(code=f"C{i}", duration_days=30, is_used=(i < 2))
        )
    await db_session.commit()

    # 本周用量：active 1000 + expired 2500 = 3500；另加一条上周记录不计入
    period = current_period_yw()
    db_session.add(
        SubscriptionWeeklyUsage(user_id=u_active.id, period_yw=period, tokens_used=1000)
    )
    db_session.add(
        SubscriptionWeeklyUsage(user_id=u_expired.id, period_yw=period, tokens_used=2500)
    )
    db_session.add(
        SubscriptionWeeklyUsage(
            user_id=u_none.id, period_yw="2020-W01", tokens_used=9999
        )
    )
    await db_session.commit()

    result = await get_overview(db_session)
    assert result["total_users"] == 3
    assert result["active_subscriptions"] == 1
    assert result["codes_total"] == 4
    assert result["codes_used"] == 2
    assert result["this_week_tokens"] == 3500
    assert result["registration_invite_code"] == settings.registration_invite_code


@pytest.mark.asyncio
async def test_get_overview_empty_db(db_session):
    result = await get_overview(db_session)
    assert result == {
        "total_users": 0,
        "active_subscriptions": 0,
        "codes_total": 0,
        "codes_used": 0,
        "this_week_tokens": 0,
        "registration_invite_code": settings.registration_invite_code,
    }


# --- require_admin 集成（非 admin 403）---

@pytest.mark.asyncio
async def test_usage_endpoints_forbidden_for_non_admin(client):
    """conftest override_get_current_user 返回非 admin testuser → 所有 usage 端点 403。

    routes.py 尚未注册 usage_router（由 wire agent 聚合），这里临时挂载到 app 并在
    finally 中清理，避免污染其他测试。
    """
    from src.main import app
    from src.api.admin_usage import router as usage_router

    before = len(app.router.routes)
    app.include_router(usage_router, prefix="/api/v1")
    try:
        resp_overview = await client.get("/api/v1/admin/usage/overview")
        assert resp_overview.status_code == 403

        resp_user = await client.get("/api/v1/admin/usage/user/1")
        assert resp_user.status_code == 403
    finally:
        del app.router.routes[before:]
