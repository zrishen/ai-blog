"""Anonymous public chat rate-limit tests."""

from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from src.config import settings
from src.main import app
from src.services.accounts.public_chat.public_chat_rate_limit_service import CHINA_TIMEZONE, consume_public_chat_request


async def _fake_public_stream_chat(*args, **kwargs):
    yield "ok"


@pytest.mark.asyncio
async def test_public_chat_endpoints_share_daily_quota_per_ip(monkeypatch):
    monkeypatch.setattr("src.api.public_chat.public_stream_chat", _fake_public_stream_chat)
    transport = ASGITransport(app=app, client=("203.0.113.10", 12345))

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for _ in range(5):
            response = await client.post("/api/v1/public/chat/stream", json={"content": "hello"})
            assert response.status_code == 200
        for _ in range(5):
            response = await client.post(
                "/api/v1/public/users/alice/chat/stream",
                json={"content": "hello"},
            )
            assert response.status_code == 200

        rejected = await client.post("/api/v1/public/chat/stream", json={"content": "hello"})
        assert rejected.status_code == 429
        assert str(settings.public_chat_daily_ip_limit) in rejected.json()["detail"]

    other_transport = ASGITransport(app=app, client=("203.0.113.11", 12345))
    async with AsyncClient(transport=other_transport, base_url="http://test") as other_client:
        accepted = await other_client.post("/api/v1/public/chat/stream", json={"content": "hello"})
        assert accepted.status_code == 200


@pytest.mark.asyncio
async def test_public_chat_quota_resets_on_next_china_calendar_day(db_session):
    day_one = datetime(2026, 7, 18, 23, 59, tzinfo=CHINA_TIMEZONE)
    for expected_count in range(1, settings.public_chat_daily_ip_limit + 1):
        assert await consume_public_chat_request(
            db_session,
            "198.51.100.20",
            now=day_one,
        ) == expected_count

    assert await consume_public_chat_request(db_session, "198.51.100.20", now=day_one) is None

    day_two = datetime(2026, 7, 19, 0, 1, tzinfo=CHINA_TIMEZONE)
    assert await consume_public_chat_request(db_session, "198.51.100.20", now=day_two) == 1
