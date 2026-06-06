"""真实 MCP 测试 — 测试 MCP 服务器配置。"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_mcp_server_lifecycle(client: AsyncClient):
    """测试 MCP 服务器完整生命周期。"""
    # 列表
    resp = await client.get("/api/mcp/servers")
    assert resp.status_code == 200

    # 添加
    resp = await client.post("/api/mcp/servers", json={
        "name": "真实测试MCP",
        "server_type": "stdio",
        "command": "python",
        "args": ["-m", "http.server"],
    })
    assert resp.status_code == 200
    server_id = resp.json()["id"]

    # 切换状态
    resp = await client.put(f"/api/mcp/servers/{server_id}/toggle", json={
        "is_active": False,
    })
    assert resp.status_code == 200

    # 删除
    resp = await client.delete(f"/api/mcp/servers/{server_id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_mcp_library(client: AsyncClient):
    """测试 MCP 工具库。"""
    resp = await client.get("/api/mcp/library")
    assert resp.status_code == 200
    assert "library" in resp.json()
