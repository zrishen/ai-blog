"""管理员守卫 require_admin + admin API 骨架测试。"""

import pytest
from fastapi import HTTPException

from src.database.models import User
from src.utils.auth import require_admin, require_super_admin


@pytest.mark.asyncio
async def test_require_admin_allows_admin_user():
    admin = User(username="admin", password_hash="h", is_admin=True)
    result = await require_admin(admin)
    assert result.is_admin is True


@pytest.mark.asyncio
async def test_require_admin_rejects_non_admin_user():
    user = User(username="plain", password_hash="h", is_admin=False)
    with pytest.raises(HTTPException) as exc:
        await require_admin(user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_admin_allows_super_admin_user():
    super_admin = User(username="root", password_hash="h", is_super_admin=True)
    result = await require_admin(super_admin)
    assert result.is_super_admin is True


@pytest.mark.asyncio
async def test_require_super_admin_rejects_normal_admin():
    admin = User(username="admin", password_hash="h", is_admin=True)
    with pytest.raises(HTTPException) as exc:
        await require_super_admin(admin)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_super_admin_allows_super_admin():
    super_admin = User(username="root", password_hash="h", is_super_admin=True)
    result = await require_super_admin(super_admin)
    assert result.is_super_admin is True


@pytest.mark.asyncio
async def test_admin_ping_forbidden_for_non_admin(client):
    # conftest 的 override_get_current_user 返回 testuser（非 admin）
    resp = await client.get("/api/v1/admin/ping")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_ping_ok_for_admin(client, monkeypatch):
    from src.main import app
    from src.utils.auth import get_current_user

    admin = User(username="admin", password_hash="h", is_admin=True)

    async def _as_admin():
        return admin

    # 用 monkeypatch.setitem 确保测试后恢复 conftest 的 override，
    # 避免手动 pop 误删 conftest 的 override_get_current_user，污染后续测试（trash 401）。
    monkeypatch.setitem(app.dependency_overrides, get_current_user, _as_admin)
    resp = await client.get("/api/v1/admin/ping")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
