"""管理员用户管理测试：

- service 层：list_users（列表/搜索/分页）+ grant_subscription（未过期叠加/过期 now+days/无订阅/不存在 LookupError）
- 集成层：require_admin 守卫（非 admin 访问 GET/POST → 403）
"""

from datetime import datetime, timedelta, timezone

import pytest

from src.database.models import User
from src.services.admin.users_service import grant_subscription, list_users, set_admin


def _naive_utc(days_from_now: float) -> datetime:
    """构造相对现在偏移 N 天的 naive UTC datetime。"""
    return (datetime.now(timezone.utc) + timedelta(days=days_from_now)).replace(tzinfo=None)


# --- service: list_users ---


@pytest.mark.asyncio
async def test_list_users_returns_all_sorted_by_id(db_session):
    u1 = User(username="alice", password_hash="h")
    u2 = User(username="bob", password_hash="h")
    db_session.add_all([u1, u2])
    await db_session.commit()

    items, total = await list_users(db_session)
    assert total == 2
    assert len(items) == 2
    assert items[0].id < items[1].id  # id 升序


@pytest.mark.asyncio
async def test_list_users_search_ilike_case_insensitive(db_session):
    db_session.add_all(
        [
            User(username="alice", password_hash="h"),
            User(username="ALICIA", password_hash="h"),
            User(username="bob", password_hash="h"),
        ]
    )
    await db_session.commit()

    # 子串 + 大小写不敏感
    items, total = await list_users(db_session, search="lic")
    assert total == 2
    assert {u.username for u in items} == {"alice", "ALICIA"}

    # 无匹配
    items_none, total_none = await list_users(db_session, search="zzz")
    assert total_none == 0
    assert items_none == []


@pytest.mark.asyncio
async def test_list_users_search_none_returns_all(db_session):
    db_session.add_all(
        [User(username="alice", password_hash="h"), User(username="bob", password_hash="h")]
    )
    await db_session.commit()

    items, total = await list_users(db_session, search=None)
    assert total == 2
    assert len(items) == 2


@pytest.mark.asyncio
async def test_list_users_pagination(db_session):
    for i in range(5):
        db_session.add(User(username=f"u{i}", password_hash="h"))
    await db_session.commit()

    items, total = await list_users(db_session, offset=2, limit=2)
    assert total == 5  # total 不受分页影响
    assert len(items) == 2
    assert items[0].id < items[1].id  # 仍是 id 升序的窗口


# --- service: grant_subscription ---


@pytest.mark.asyncio
async def test_grant_subscription_stacks_when_active(db_session):
    future = _naive_utc(10)  # 未过期
    user = User(username="active", password_hash="h", subscription_expires_at=future)
    db_session.add(user)
    await db_session.commit()

    now = _naive_utc(0)
    new_expires = await grant_subscription(db_session, user.id, 5, now=now)

    # 未过期：在原 expires_at 基础上叠加，而非 now+5
    assert new_expires == future + timedelta(days=5)
    await db_session.refresh(user)
    assert user.subscription_expires_at == future + timedelta(days=5)


@pytest.mark.asyncio
async def test_grant_subscription_from_now_when_expired(db_session):
    past = _naive_utc(-3)  # 已过期
    user = User(username="expired", password_hash="h", subscription_expires_at=past)
    db_session.add(user)
    await db_session.commit()

    now = _naive_utc(0)
    new_expires = await grant_subscription(db_session, user.id, 7, now=now)

    assert new_expires == now + timedelta(days=7)  # 过期：now + days


@pytest.mark.asyncio
async def test_grant_subscription_from_now_when_no_subscription(db_session):
    user = User(username="fresh", password_hash="h")  # 无 subscription_expires_at
    db_session.add(user)
    await db_session.commit()

    now = _naive_utc(0)
    new_expires = await grant_subscription(db_session, user.id, 30, now=now)

    assert new_expires == now + timedelta(days=30)


@pytest.mark.asyncio
async def test_grant_subscription_user_not_found_raises_lookup_error(db_session):
    with pytest.raises(LookupError):
        await grant_subscription(db_session, 99999, 5)


# --- 集成：require_admin 守卫（非 admin → 403）---


@pytest.fixture
def _admin_users_routes():
    """把 admin_users 路由临时挂到 app：本模块测试自洽，不依赖 routes.py 注册。

    用例后还原 app.router.routes，避免污染全局 app（其他 agent / 既有用例不受影响）。
    """
    from src.api.admin_users import router as admin_users_router
    from src.main import app

    saved = list(app.router.routes)
    # 范式同 main.py：在 app 上以 /api/v1 前缀挂载（routes.py 在 wire 阶段同样挂到 /api/v1）
    app.include_router(admin_users_router, prefix="/api/v1")
    yield
    app.router.routes[:] = saved


@pytest.mark.asyncio
async def test_list_users_endpoint_forbidden_for_non_admin(client, _admin_users_routes):
    # conftest 的 override_get_current_user 返回 testuser（非 admin）→ 403
    resp = await client.get("/api/v1/admin/users")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_grant_subscription_endpoint_forbidden_for_non_admin(client, _admin_users_routes):
    resp = await client.post(
        "/api/v1/admin/users/1/subscription/grant",
        json={"days": 30},
    )
    assert resp.status_code == 403


# --- service: set_admin ---


@pytest.mark.asyncio
async def test_set_admin_grants(db_session):
    user = User(username="plain", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    updated = await set_admin(db_session, user.id, True)
    assert updated.is_admin is True
    await db_session.refresh(user)
    assert user.is_admin is True


@pytest.mark.asyncio
async def test_set_admin_revokes(db_session):
    user = User(username="boss", password_hash="h", is_admin=True)
    db_session.add(user)
    await db_session.commit()

    updated = await set_admin(db_session, user.id, False)
    assert updated.is_admin is False


@pytest.mark.asyncio
async def test_set_admin_user_not_found_raises(db_session):
    with pytest.raises(LookupError):
        await set_admin(db_session, 99999, True)


@pytest.mark.asyncio
async def test_set_admin_rejects_super_admin(db_session):
    super_admin = User(username="root", password_hash="h", is_admin=True, is_super_admin=True)
    db_session.add(super_admin)
    await db_session.commit()

    with pytest.raises(ValueError, match="超级管理员"):
        await set_admin(db_session, super_admin.id, False)


@pytest.mark.asyncio
async def test_set_admin_endpoint_forbidden_for_non_admin(client, _admin_users_routes):
    resp = await client.put("/api/v1/admin/users/1/admin", json={"is_admin": True})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_set_admin_endpoint_forbidden_for_normal_admin(client, _admin_users_routes, monkeypatch):
    from src.main import app
    from src.utils.auth import get_current_user

    async def _as_normal_admin():
        return User(username="normal-admin", password_hash="h", is_admin=True)

    monkeypatch.setitem(app.dependency_overrides, get_current_user, _as_normal_admin)
    resp = await client.put("/api/v1/admin/users/1/admin", json={"is_admin": True})
    assert resp.status_code == 403
