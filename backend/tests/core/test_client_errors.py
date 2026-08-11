"""前端错误上报 API 测试。"""

import logging

import pytest
from httpx import AsyncClient

from src.config import settings
from src.database.models import User
from src.utils.auth import create_access_token


@pytest.mark.asyncio
async def test_client_error_logs_anonymous_report_without_url_secrets(
    client: AsyncClient,
    caplog,
):
    caplog.set_level(logging.ERROR, logger="src.api.client_errors")

    response = await client.post(
        "/api/v1/client-errors",
        json={
            "message": "frontend crashed",
            "stack": "Error: frontend crashed",
            "url": "https://example.com/editor/42?access_token=secret#private",
            "source": "window",
        },
        headers={"User-Agent": "test-browser/1.0"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "client_error source=window user_id=None" in caplog.text
    assert "path=/editor/42" in caplog.text
    assert "ua=test-browser/1.0" in caplog.text
    assert "access_token" not in caplog.text
    assert "secret" not in caplog.text
    assert "private" not in caplog.text


@pytest.mark.asyncio
async def test_client_error_logs_authenticated_user(
    client: AsyncClient,
    db_session,
    caplog,
):
    user = User(username="client-error-user", password_hash="mock")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user.id, user.username)
    caplog.set_level(logging.ERROR, logger="src.api.client_errors")

    response = await client.post(
        "/api/v1/client-errors",
        json={"message": "authenticated error", "source": "logger"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert f"user_id={user.id}" in caplog.text


@pytest.mark.asyncio
async def test_client_error_rate_limited_after_threshold(
    client: AsyncClient,
    monkeypatch,
):
    monkeypatch.setattr(settings, "client_error_rate_limit", 2)
    payload = {"message": "repeated error", "source": "window"}

    for _ in range(2):
        assert (await client.post("/api/v1/client-errors", json=payload)).status_code == 200
    assert (await client.post("/api/v1/client-errors", json=payload)).status_code == 429
