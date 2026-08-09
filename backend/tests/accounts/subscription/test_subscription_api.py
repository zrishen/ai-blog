"""订阅 API 测试：/subscription/status（含周配额）+ /subscription/redeem。

client fixture 经 conftest override 自动认证为 testuser；setup_database 每测试隔离。
"""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.config import settings
from src.database.models import SubscriptionWeeklyUsage, User
from src.services.accounts.subscription import create_codes, current_period_yw


def _naive_utc(days: float) -> datetime:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(tzinfo=None)


async def _testuser(db_session) -> User:
    """获取或创建 testuser（与 conftest override_get_current_user 同名，共享 :memory: 数据）。"""
    result = await db_session.execute(select(User).where(User.username == "testuser"))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(username="testuser", password_hash="mock")
        db_session.add(user)
        await db_session.commit()
    return user


@pytest.mark.asyncio
async def test_status_no_subscription(client: AsyncClient):
    """无订阅：active=False，周配额字段齐全（used=0, limit=周上限, remaining=limit）。"""
    resp = await client.get("/api/v1/subscription/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active"] is False
    assert data["expires_at"] is None
    assert data["period"] == current_period_yw()
    assert data["used"] == 0
    assert data["limit"] == settings.subscription_weekly_token_limit
    assert data["remaining"] == settings.subscription_weekly_token_limit


@pytest.mark.asyncio
async def test_status_active_with_usage(client: AsyncClient, db_session):
    """有订阅（未来到期）+ 本周用量：active=True, used=写入值, remaining=limit-used。"""
    user = await _testuser(db_session)
    user.subscription_expires_at = _naive_utc(10)
    db_session.add(
        SubscriptionWeeklyUsage(
            user_id=user.id, period_yw=current_period_yw(), tokens_used=30_000_000,
        )
    )
    await db_session.commit()

    resp = await client.get("/api/v1/subscription/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active"] is True
    assert data["expires_at"] is not None
    assert data["used"] == 30_000_000
    assert data["limit"] == settings.subscription_weekly_token_limit
    assert data["remaining"] == settings.subscription_weekly_token_limit - 30_000_000


@pytest.mark.asyncio
async def test_redeem_valid_code_activates(client: AsyncClient, db_session):
    """有效兑换码激活：返回 active=True + expires_at 未来。"""
    user = await _testuser(db_session)
    codes = await create_codes(
        db_session, count=1, duration_days=30, created_by_admin_id=user.id
    )
    code = codes[0]

    resp = await client.post("/api/v1/subscription/redeem", json={"code": code})
    assert resp.status_code == 200
    data = resp.json()
    assert data["active"] is True
    assert data["expires_at"] is not None


@pytest.mark.asyncio
async def test_redeem_invalid_code_returns_400(client: AsyncClient):
    """无效兑换码 → 400。"""
    resp = await client.post("/api/v1/subscription/redeem", json={"code": "NOPE-CODE-XYZ"})
    assert resp.status_code == 400
