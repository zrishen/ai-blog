"""LLM Settings PUT 流程的补充测试：校验、隔离、协议归一化。"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.config import settings
from src.database.models import LLMSettings
from src.main import app
from src.utils.auth import get_current_user, get_optional_user


@pytest.fixture(autouse=True)
def real_auth():
    """conftest 把所有认证请求都识别为 testuser，这里临时还原为真实 token 认证。"""
    saved_current = app.dependency_overrides.get(get_current_user)
    saved_optional = app.dependency_overrides.get(get_optional_user)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_optional_user, None)
    yield
    if saved_current is not None:
        app.dependency_overrides[get_current_user] = saved_current
    if saved_optional is not None:
        app.dependency_overrides[get_optional_user] = saved_optional


@pytest.fixture(autouse=True)
def isolated_blog_dir(tmp_path, monkeypatch):
    """注册用户会写种子文章到 blog_content_dir，必须隔离避免污染真实数据。"""
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


async def _register(client: AsyncClient, username: str) -> tuple[str, int]:
    resp = await client.post("/api/auth/register", json={
        "username": username,
        "password": "test1234",
    })
    assert resp.status_code == 201
    return resp.json()["token"], resp.json()["user"]["id"]


@pytest.mark.asyncio
async def test_unknown_protocol_falls_back_to_openai(client: AsyncClient):
    token, _ = await _register(client, "unknown_proto")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put("/api/settings/llm", headers=headers, json={
        "protocol": "gemini",
        "model": "some-model",
    })
    assert resp.status_code == 200
    assert resp.json()["protocol"] == "openai"


@pytest.mark.asyncio
async def test_empty_api_key_does_not_overwrite_existing(client: AsyncClient, db_session):
    token, user_id = await _register(client, "key_preserve")
    headers = {"Authorization": f"Bearer {token}"}

    # 首次设置 api_key
    resp = await client.put("/api/settings/llm", headers=headers, json={
        "protocol": "openai",
        "api_key": "first-key",
        "model": "m",
    })
    assert resp.status_code == 200
    assert resp.json()["has_api_key"] is True

    # 再次更新其他字段但传空 api_key，原 api_key 应保留
    resp2 = await client.put("/api/settings/llm", headers=headers, json={
        "protocol": "openai",
        "api_key": "",
        "model": "new-model",
    })
    assert resp2.status_code == 200
    assert resp2.json()["model"] == "new-model"
    assert resp2.json()["has_api_key"] is True

    record = (await db_session.execute(
        select(LLMSettings).where(LLMSettings.user_id == user_id)
    )).scalar_one()
    assert record.api_key == "first-key"


@pytest.mark.asyncio
async def test_settings_are_isolated_per_user(client: AsyncClient, db_session):
    token_a, user_id_a = await _register(client, "settings_a")
    token_b, user_id_b = await _register(client, "settings_b")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    await client.put("/api/settings/llm", headers=headers_a, json={
        "protocol": "anthropic",
        "base_url": "https://a.example.com",
        "api_key": "key-a",
        "model": "model-a",
    })
    await client.put("/api/settings/llm", headers=headers_b, json={
        "protocol": "openai",
        "base_url": "https://b.example.com",
        "api_key": "key-b",
        "model": "model-b",
    })

    rec_a = (await db_session.execute(
        select(LLMSettings).where(LLMSettings.user_id == user_id_a)
    )).scalar_one()
    rec_b = (await db_session.execute(
        select(LLMSettings).where(LLMSettings.user_id == user_id_b)
    )).scalar_one()
    assert rec_a.api_key == "key-a"
    assert rec_b.api_key == "key-b"
    assert rec_a.protocol == "anthropic"
    assert rec_b.protocol == "openai"


@pytest.mark.asyncio
async def test_get_settings_returns_default_for_new_user(client: AsyncClient):
    token, _ = await _register(client, "fresh_user")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/settings/llm", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["protocol"] == "openai"
    assert data["has_api_key"] is False
    assert data["base_url"] is None
    assert data["model"] is None
    assert "api_key" not in data


@pytest.mark.asyncio
async def test_settings_requires_auth(client: AsyncClient):
    resp = await client.get("/api/settings/llm")
    assert resp.status_code in (401, 403)

    resp = await client.put("/api/settings/llm", json={"protocol": "openai"})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_whitespace_in_inputs_is_trimmed(client: AsyncClient, db_session):
    token, user_id = await _register(client, "trim_user")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put("/api/settings/llm", headers=headers, json={
        "protocol": "  OpenAI  ",
        "base_url": "   https://spaced.example.com   ",
        "api_key": "  key-with-spaces  ",
        "model": "  trimmed-model  ",
    })
    assert resp.status_code == 200

    record = (await db_session.execute(
        select(LLMSettings).where(LLMSettings.user_id == user_id)
    )).scalar_one()
    assert record.protocol == "openai"
    assert record.base_url == "https://spaced.example.com"
    assert record.api_key == "key-with-spaces"
    assert record.model_name == "trimmed-model"
