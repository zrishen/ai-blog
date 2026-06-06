"""健康检查测试。"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "model" in data


@pytest.mark.asyncio
async def test_status(client: AsyncClient):
    resp = await client.get("/api/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "model" in data
    assert "timestamp" in data
    assert "components" in data
    assert "database" in data["components"]
    assert "uploads" in data["components"]
    assert "vector_store" in data["components"]
