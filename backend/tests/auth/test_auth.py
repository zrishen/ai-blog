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
    resp = await client.post("/api/auth/register", json={
        "username": "newuser",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["username"] == "newuser"
    assert data["user"]["id"] > 0
    # access token 必须带 type=access
    assert _decode_access(data["access_token"])["type"] == "access"
    # refresh token 通过 HttpOnly cookie 下发，不能出现在响应体里
    assert "refresh_token" not in data
    assert client.cookies.get(settings.refresh_cookie_name) is not None


@pytest.mark.asyncio
async def test_register_duplicate(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "username": "dupuser",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    resp = await client.post("/api/auth/register", json={
        "username": "dupuser",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 409
    assert "已存在" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_succeeds_when_intro_article_fails(client: AsyncClient, monkeypatch):
    """入门文章创建失败时不阻断注册：用户仍可拿到 access token 并登录（best-effort）。"""

    async def _boom(db, user_id: int):
        raise RuntimeError("seed article failed")

    monkeypatch.setattr("src.api.auth._seed_intro_article", _boom)

    resp = await client.post("/api/auth/register", json={
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
    await client.post("/api/auth/register", json={
        "username": "loginuser",
        "password": "mypassword",
        "invite_code": settings.registration_invite_code,
    })
    resp = await client.post("/api/auth/login", json={
        "username": "loginuser",
        "password": "mypassword",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert _decode_access(data["access_token"])["type"] == "access"
    assert data["user"]["username"] == "loginuser"
    assert client.cookies.get(settings.refresh_cookie_name) is not None


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "username": "wrongpw",
        "password": "correct",
        "invite_code": settings.registration_invite_code,
    })
    resp = await client.post("/api/auth/login", json={
        "username": "wrongpw",
        "password": "wrong",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={
        "username": "nobody",
        "password": "whatever",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_exchanges_cookie_for_new_access(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "username": "rfuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    first_access = (await client.post("/api/auth/login", json={
        "username": "rfuser", "password": "pass1234",
    })).json()["access_token"]

    # cookie 由 httpx 自动随 /api/auth/* 请求携带
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 200
    new_access = resp.json()["access_token"]
    payload = _decode_access(new_access)
    assert payload["type"] == "access"
    assert payload["sub"] == _decode_access(first_access)["sub"]  # 同一用户
    assert resp.json()["user"]["username"] == "rfuser"


@pytest.mark.asyncio
async def test_refresh_without_cookie_returns_401(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "username": "nocookie",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    await client.post("/api/auth/login", json={"username": "nocookie", "password": "pass1234"})
    client.cookies.clear()  # 模拟无 refresh cookie
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_refresh_token(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "username": "logoutuser",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    await client.post("/api/auth/login", json={"username": "logoutuser", "password": "pass1234"})
    assert client.cookies.get(settings.refresh_cookie_name) is not None

    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    # cookie 被清除
    assert client.cookies.get(settings.refresh_cookie_name) is None
    # 吊销后再 refresh 应失败（即便重新塞回同一 cookie 值）
    assert (await client.post("/api/auth/refresh")).status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_value_cannot_be_used_as_access(client: AsyncClient):
    """refresh token 是不透明随机串，不能冒充 access token 通过鉴权。"""
    await client.post("/api/auth/register", json={
        "username": "opaque",
        "password": "pass1234",
        "invite_code": settings.registration_invite_code,
    })
    await client.post("/api/auth/login", json={"username": "opaque", "password": "pass1234"})
    refresh_value = client.cookies.get(settings.refresh_cookie_name)
    assert refresh_value is not None
    # refresh 串不是合法 access JWT：decode_access_token 会因非 JWT/无 type 返回 None
    from src.utils.auth import decode_access_token
    assert decode_access_token(refresh_value) is None


@pytest.mark.asyncio
async def test_register_rejects_invalid_invite_code(client: AsyncClient):
    resp = await client.post("/api/auth/register", json={
        "username": "noinvite",
        "password": "pass1234",
        "invite_code": "wrong-code",
    })
    assert resp.status_code == 403
    assert "邀请码" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_is_closed_when_invite_code_is_not_configured(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "registration_invite_code", "")
    resp = await client.post("/api/auth/register", json={
        "username": "closed",
        "password": "pass1234",
        "invite_code": "any-code",
    })
    assert resp.status_code == 403
