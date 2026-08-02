import logging

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_api_requests_are_logged(client: AsyncClient, caplog):
    caplog.set_level(logging.INFO, logger="http.access")

    response = await client.get("/api/v1/status")

    assert response.status_code == 200
    assert "GET /api/v1/status 200" in caplog.text
