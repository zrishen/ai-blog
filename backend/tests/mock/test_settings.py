"""LLM settings API tests."""

import pytest
from httpx import AsyncClient

from src.config import settings


@pytest.fixture(autouse=True)
def isolated_blog_dir(tmp_path, monkeypatch):
    """注册会触发 _seed_intro_article 写种子文章，必须隔离避免污染真实 data 目录。"""
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    resp = await client.post("/api/auth/register", json={
        "username": "settings-user",
        "password": "test1234",
    })
    assert resp.status_code == 201
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.mark.asyncio
async def test_get_and_update_llm_settings(client: AsyncClient):
    headers = await _auth_headers(client)

    resp = await client.get("/api/settings/llm", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["protocol"] == "openai"
    assert data["has_api_key"] is False
    assert data["api_key"] is None

    resp = await client.put("/api/settings/llm", headers=headers, json={
        "protocol": "anthropic",
        "base_url": "https://api.anthropic.com",
        "api_key": "secret-key",
        "model": "claude-3-5-sonnet-latest",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["protocol"] == "anthropic"
    assert data["base_url"] == "https://api.anthropic.com"
    assert data["model"] == "claude-3-5-sonnet-latest"
    assert data["has_api_key"] is True
    assert data["api_key"] == "secret-key"

    resp = await client.put("/api/settings/llm", headers=headers, json={
        "protocol": "openai",
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-4o-mini",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["protocol"] == "openai"
    assert data["has_api_key"] is True
