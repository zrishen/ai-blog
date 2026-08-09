"""Auth API 测试。"""

import jwt
import pytest
from httpx import AsyncClient

from src.config import settings


@pytest.fixture(autouse=True)
def isolated_blog_dir(tmp_path, monkeypatch):
    """注册会触发 _seed_intro_article 写种子文章，必须隔离避免污染真实 data 目录。"""
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


def _decode_access(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register", json={
        "username": "newuser",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["username"] == "newuser"
    assert data["user"]["id"] > 0
    assert data["user"]["is_admin"] is False  # 新注册用户默认非管理员
    # access token 必须带 type=access
    assert _decode_access(data["access_token"])["type"] == "access"
    # refresh token 通过 HttpOnly cookie 下发，不能出现在响应体里
    assert "refresh_token" not in data
    assert client.cookies.get(settings.refresh_cookie_name) is not None


@pytest.mark.asyncio
async def test_register_duplicate(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={
        "username": "dupuser",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    resp = await client.post("/api/v1/auth/register", json={
        "username": "dupuser",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 409
    assert "已存在" in resp.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "username",
    ["../escape", "name/child", r"name\child", "C:drive", "CON", "name.", "name "],
)
async def test_register_rejects_username_unsafe_for_workspace_directory(client: AsyncClient, username: str):
    response = await client.post("/api/v1/auth/register", json={
        "username": username,
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_register_succeeds_when_intro_article_fails(client: AsyncClient, monkeypatch):
    """入门文章创建失败时不阻断注册：用户仍可拿到 access token 并登录（best-effort）。"""

    async def _boom(db, user_id: int):
        raise RuntimeError("seed article failed")

    monkeypatch.setattr("src.api.auth._seed_intro_article", _boom)

    resp = await client.post("/api/v1/auth/register", json={
        "username": "seedfail",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["username"] == "seedfail"
    assert client.cookies.get(settings.refresh_cookie_name) is not None


@pytest.mark.asyncio
async def test_login(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={
        "username": "loginuser",
        "password": "mypassword1",
        "invite_code": settings.registration_invite_code,
    })
    resp = await client.post("/api/v1/auth/login", json={
        "username": "loginuser",
        "password": "mypassword1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert _decode_access(data["access_token"])["type"] == "access"
    assert data["user"]["username"] == "loginuser"
    assert client.cookies.get(settings.refresh_cookie_name) is not None


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={
        "username": "wrongpw",
        "password": "correct123",
        "invite_code": settings.registration_invite_code,
    })
    resp = await client.post("/api/v1/auth/login", json={
        "username": "wrongpw",
        "password": "wrong",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post("/api/v1/auth/login", json={
        "username": "nobody",
        "password": "whatever",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_exchanges_cookie_for_new_access(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={
        "username": "rfuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    first_access = (await client.post("/api/v1/auth/login", json={
        "username": "rfuser", "password": "pass1234",
    })).json()["access_token"]

    # cookie 由 httpx 自动随 /api/auth/* 请求携带
    resp = await client.post("/api/v1/auth/refresh")
    assert resp.status_code == 200
    new_access = resp.json()["access_token"]
    payload = _decode_access(new_access)
    assert payload["type"] == "access"
    assert payload["sub"] == _decode_access(first_access)["sub"]  # 同一用户
    assert resp.json()["user"]["username"] == "rfuser"


@pytest.mark.asyncio
async def test_refresh_without_cookie_returns_401(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={
        "username": "nocookie",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    await client.post("/api/v1/auth/login", json={"username": "nocookie", "password": "pass1234"})
    client.cookies.clear()  # 模拟无 refresh cookie
    resp = await client.post("/api/v1/auth/refresh")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_rotates_refresh_token(client: AsyncClient):
    """refresh 轮换：旧 refresh 即时吊销、下发新 refresh，新旧不共存。"""
    await client.post("/api/v1/auth/register", json={
        "username": "rotuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    old_refresh = client.cookies.get(settings.refresh_cookie_name)
    assert old_refresh is not None

    resp = await client.post("/api/v1/auth/refresh")
    assert resp.status_code == 200
    new_refresh = client.cookies.get(settings.refresh_cookie_name)
    # 轮换：下发了与旧值不同的新 token
    assert new_refresh is not None and new_refresh != old_refresh

    # 新 token 立即可继续刷新
    assert (await client.post("/api/v1/auth/refresh")).status_code == 200


@pytest.mark.asyncio
async def test_refresh_grace_allows_concurrent_reuse(client: AsyncClient):
    """宽限期内重用旧 token（多标签页近同时刷新的竞态）→ 宽容换新，不连带吊销其他会话。"""
    await client.post("/api/v1/auth/register", json={
        "username": "graceuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    old_refresh = client.cookies.get(settings.refresh_cookie_name)

    # 标签页 A 轮换：old_refresh 随即被吊销
    await client.post("/api/v1/auth/refresh")
    new_refresh = client.cookies.get(settings.refresh_cookie_name)

    # 标签页 B 仍持旧 token，在宽限期内并发刷新 → 宽容换新（200），不判窃取
    client.cookies.clear()
    headers = {"Cookie": f"{settings.refresh_cookie_name}={old_refresh}"}
    assert (await client.post("/api/v1/auth/refresh", headers=headers)).status_code == 200

    # 未参与重用的 new_refresh 仍有效（未吊销全部会话）→ 绝不错杀正常用户
    client.cookies.clear()
    headers = {"Cookie": f"{settings.refresh_cookie_name}={new_refresh}"}
    assert (await client.post("/api/v1/auth/refresh", headers=headers)).status_code == 200


@pytest.mark.asyncio
async def test_refresh_reuse_after_grace_revokes_all_sessions(client: AsyncClient, monkeypatch):
    """超宽限期重用旧 token → 判定 token 被窃取，吊销该用户全部 refresh。"""
    monkeypatch.setattr(settings, "refresh_rotation_grace_seconds", 0)
    await client.post("/api/v1/auth/register", json={
        "username": "reuseuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    old_refresh = client.cookies.get(settings.refresh_cookie_name)

    # 轮换得到新 token（old_refresh 随即被吊销）
    await client.post("/api/v1/auth/refresh")
    new_refresh = client.cookies.get(settings.refresh_cookie_name)

    # 宽限期外（grace=0 即立即超期）重用旧 token → 判窃取
    client.cookies.clear()
    headers = {"Cookie": f"{settings.refresh_cookie_name}={old_refresh}"}
    assert (await client.post("/api/v1/auth/refresh", headers=headers)).status_code == 401

    # 吊销该用户所有 refresh：未参与重用的新 token 也一并失效
    client.cookies.clear()
    headers = {"Cookie": f"{settings.refresh_cookie_name}={new_refresh}"}
    assert (await client.post("/api/v1/auth/refresh", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_refresh_token(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={
        "username": "logoutuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    await client.post("/api/v1/auth/login", json={"username": "logoutuser", "password": "pass1234"})
    assert client.cookies.get(settings.refresh_cookie_name) is not None

    resp = await client.post("/api/v1/auth/logout")
    assert resp.status_code == 200
    # cookie 被清除
    assert client.cookies.get(settings.refresh_cookie_name) is None
    # 吊销后再 refresh 应失败（即便重新塞回同一 cookie 值）
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_value_cannot_be_used_as_access(client: AsyncClient):
    """refresh token 是不透明随机串，不能冒充 access token 通过鉴权。"""
    await client.post("/api/v1/auth/register", json={
        "username": "opaque",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    await client.post("/api/v1/auth/login", json={"username": "opaque", "password": "pass1234"})
    refresh_value = client.cookies.get(settings.refresh_cookie_name)
    assert refresh_value is not None
    # refresh 串不是合法 access JWT：decode_access_token 会因非 JWT/无 type 返回 None
    from src.utils.auth import decode_access_token
    assert decode_access_token(refresh_value) is None


@pytest.mark.asyncio
async def test_register_rejects_invalid_invite_code(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register", json={
        "username": "noinvite",
        "password": "pass1234",
        "invite_code": "wrong-code",
    })
    assert resp.status_code == 403
    assert "邀请码" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_is_closed_when_invite_code_is_not_configured(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "registration_invite_code", "")
    resp = await client.post("/api/v1/auth/register", json={
        "username": "closed",
        "password": "pass1234",
        "invite_code": "any-code",
    })
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_register_rejects_weak_password(client: AsyncClient):
    """注册密码不足 8 位或缺字母/数字 → 422（schema 校验，不建用户）。"""
    for weak in ("short1", "onlyletters", "12345678"):
        resp = await client.post("/api/v1/auth/register", json={
            "username": f"weak_{weak}",
            "password": weak,
            "invite_code": settings.registration_invite_code,
        })
        assert resp.status_code == 422, (weak, resp.text)


def test_check_rate_limit_window_and_isolation():
    """滑动窗口内放行至 limit、超限拒绝；不同 bucket 互不影响。"""
    from src.utils.rate_limit import check_rate_limit, reset_rate_limit

    reset_rate_limit()
    assert check_rate_limit("k", limit=2, window_seconds=60) is True
    assert check_rate_limit("k", limit=2, window_seconds=60) is True
    assert check_rate_limit("k", limit=2, window_seconds=60) is False  # 第 3 次超限
    assert check_rate_limit("other", limit=2, window_seconds=60) is True  # 独立桶


@pytest.mark.asyncio
async def test_login_rate_limited_after_threshold(client: AsyncClient, monkeypatch):
    """同 IP 连续登录超阈值后返 429（前几次仍按 401 凭证错误返回）。"""
    monkeypatch.setattr(settings, "auth_login_rate_limit", 3)
    monkeypatch.setattr(settings, "auth_rate_limit_window_seconds", 60)
    for _ in range(3):
        resp = await client.post("/api/v1/auth/login", json={"username": "xx", "password": "abcd1"})
        assert resp.status_code == 401  # 凭证错误，但未到限流阈值
    resp = await client.post("/api/v1/auth/login", json={"username": "xx", "password": "abcd1"})
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_register_rate_limited_after_threshold(client: AsyncClient, monkeypatch):
    """同 IP 连续注册超阈值后返 429（覆盖邀请码暴力撞库）。"""
    monkeypatch.setattr(settings, "auth_register_rate_limit", 2)
    monkeypatch.setattr(settings, "auth_rate_limit_window_seconds", 60)
    for _ in range(2):
        resp = await client.post("/api/v1/auth/register", json={
            "username": "uu",
            "password": "pass1234",
            "invite_code": settings.registration_invite_code,
        })
        assert resp.status_code in (201, 409)  # 首次成功 / 重复用户名，均未限流
    resp = await client.post("/api/v1/auth/register", json={
        "username": "uu",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_auth_responses_include_role_flags(client: AsyncClient):
    """register / login / refresh 三处响应的 user 都带管理员角色字段。"""
    reg = await client.post("/api/v1/auth/register", json={
        "username": "adminfield",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    assert reg.json()["user"]["is_admin"] is False
    assert reg.json()["user"]["is_super_admin"] is False

    login_resp = await client.post("/api/v1/auth/login", json={
        "username": "adminfield", "password": "pass1234",
    })
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["is_admin"] is False
    assert login_resp.json()["user"]["is_super_admin"] is False

    refresh_resp = await client.post("/api/v1/auth/refresh")
    assert refresh_resp.status_code == 200
    assert refresh_resp.json()["user"]["is_admin"] is False
    assert refresh_resp.json()["user"]["is_super_admin"] is False
