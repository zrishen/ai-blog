"""Status API 测试。"""

import pytest
from httpx import AsyncClient

from src.config import settings


async def _ping_ok():
    return True


@pytest.fixture(autouse=True)
def _isolated_status_paths(tmp_path, monkeypatch):
    """隔离 workspace 目录；把 conftest 的同步 ping 覆盖为可 await。"""
    monkeypatch.setattr(settings, "workspace_root", str(tmp_path / "workspace"))
    monkeypatch.setattr("src.services.memory.graph_store.ping", _ping_ok)


@pytest.mark.asyncio
async def test_status_returns_structure_without_model(client: AsyncClient):
    resp = await client.get("/api/v1/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")
    assert "model" not in data  # 不再泄露模型名
    comp = data["components"]
    assert set(comp) == {"database", "uploads", "vector_store", "brain"}
    assert comp["uploads"] == "ok"  # 兼容字段名，实际检查 workspace/users 容器
    assert comp["database"] == "ok"
    assert comp["vector_store"] == "ok"
    assert comp["brain"] == "ok"


@pytest.mark.asyncio
async def test_status_does_not_leak_exception_text(client: AsyncClient, monkeypatch):
    """组件异常时只回 error，不外泄异常原文（防暴露内部拓扑）。"""
    async def _raise():
        raise RuntimeError("topology-secret-host:6379 falkordb-leak")

    monkeypatch.setattr("src.services.memory.graph_store.ping", _raise)
    resp = await client.get("/api/v1/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["components"]["vector_store"] == "error"
    assert data["status"] == "degraded"
    body = resp.text
    assert "topology-secret-host" not in body
    assert "falkordb-leak" not in body


@pytest.mark.asyncio
async def test_status_rate_limited_after_threshold(client: AsyncClient, monkeypatch):
    """同 IP 超阈值后返 429（防高频请求放大 DB/磁盘/图库探测负载）。"""
    monkeypatch.setattr(settings, "status_rate_limit", 2)
    for _ in range(2):
        assert (await client.get("/api/v1/status")).status_code == 200
    assert (await client.get("/api/v1/status")).status_code == 429


@pytest.mark.asyncio
async def test_health_does_not_leak_model(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
