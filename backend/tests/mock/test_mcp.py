"""MCP 服务器配置测试。"""

import json

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_mcp_servers(client: AsyncClient):
    resp = await client.get("/api/mcp/servers")
    assert resp.status_code == 200
    data = resp.json()
    assert "servers" in data
    assert isinstance(data["servers"], list)


@pytest.mark.asyncio
async def test_add_mcp_server(client: AsyncClient):
    resp = await client.post("/api/mcp/servers", json={
        "name": "测试MCP服务",
        "server_type": "stdio",
        "command": "python",
        "args": ["-m", "test"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "测试MCP服务"
    assert data["server_type"] == "stdio"
    assert "id" in data


@pytest.mark.asyncio
async def test_add_mcp_server_keeps_config_when_discovery_crashes(client: AsyncClient, monkeypatch):
    """工具发现抛异常时不阻断创建：配置已保存（best-effort），用户可后续启用重试。"""
    from src.services.mcp import mcp_config

    async def boom(**kwargs):
        raise RuntimeError("discovery crashed")

    monkeypatch.setattr(mcp_config, "discover_server_tools", boom)

    resp = await client.post("/api/mcp/servers", json={
        "name": "崩溃MCP",
        "server_type": "stdio",
        "command": "python",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "崩溃MCP"
    assert data["tools"] == []


@pytest.mark.asyncio
async def test_mcp_server_response_does_not_expose_env_vars(client: AsyncClient, monkeypatch):
    from src.services.mcp import mcp_config

    async def fake_discover_server_tools(**kwargs):
        return []

    monkeypatch.setattr(mcp_config, "discover_server_tools", fake_discover_server_tools, raising=False)

    create_resp = await client.post("/api/mcp/servers", json={
        "name": "带环境变量的MCP服务",
        "server_type": "stdio",
        "command": "python",
        "env_vars": {"MCP_FAKE_TOKEN": "fake-token-for-test"},
    })

    assert create_resp.status_code == 200
    created = create_resp.json()
    assert "env_vars" not in created
    assert "fake-token-for-test" not in create_resp.text

    list_resp = await client.get("/api/mcp/servers")
    assert list_resp.status_code == 200
    assert "env_vars" not in list_resp.text
    assert "fake-token-for-test" not in list_resp.text


def test_build_stdio_env_excludes_host_only_values(monkeypatch):
    from src.services.mcp.tool_client import _build_stdio_env

    monkeypatch.setenv("HOST_ONLY_SECRET", "host-secret-for-test")
    monkeypatch.setenv("PATH", "/usr/bin")

    env = _build_stdio_env({"MCP_EXPLICIT_TOKEN": "explicit-token-for-test"})

    assert env["MCP_EXPLICIT_TOKEN"] == "explicit-token-for-test"
    assert env.get("PATH") == "/usr/bin"
    assert "HOST_ONLY_SECRET" not in env


@pytest.mark.asyncio
async def test_toggle_mcp_server(client: AsyncClient):
    # 创建
    create_resp = await client.post("/api/mcp/servers", json={
        "name": "待切换",
        "server_type": "stdio",
        "command": "python",
    })
    server_id = create_resp.json()["id"]

    # 切换状态
    resp = await client.put(f"/api/mcp/servers/{server_id}/toggle", json={
        "is_active": False,
    })
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_delete_mcp_server(client: AsyncClient):
    # 创建
    create_resp = await client.post("/api/mcp/servers", json={
        "name": "待删除",
        "server_type": "stdio",
        "command": "python",
    })
    server_id = create_resp.json()["id"]

    # 删除
    resp = await client.delete(f"/api/mcp/servers/{server_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_delete_nonexistent_mcp_server(client: AsyncClient):
    resp = await client.delete("/api/mcp/servers/99999")
    assert resp.status_code == 404


async def _create_mcp_server(db_session, *, tools=None, is_active=False):
    from src.database.models import MCPServer, User

    user = User(username="testuser", password_hash="mock")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    server = MCPServer(
        user_id=user.id,
        name="bing-search",
        server_type="stdio",
        command="python",
        args=json.dumps(["-m", "bing_search"]),
        env_vars=json.dumps({}),
        tools=tools or [],
        is_active=is_active,
    )
    db_session.add(server)
    await db_session.commit()
    await db_session.refresh(server)
    return server


@pytest.mark.asyncio
async def test_enable_mcp_server_discovers_tools_when_empty(client: AsyncClient, db_session, monkeypatch):
    from src.services.mcp import mcp_config

    discovered_tools = [{
        "name": "bing_search",
        "description": "Search with Bing",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
    }]

    async def fake_discover_server_tools(**kwargs):
        return discovered_tools

    monkeypatch.setattr(mcp_config, "discover_server_tools", fake_discover_server_tools, raising=False)
    server = await _create_mcp_server(db_session, tools=[], is_active=False)

    resp = await client.put(f"/api/mcp/servers/{server.id}/toggle", json={"is_active": True})

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_active"] is True
    assert data["tools"] == ["bing_search"]

    await db_session.refresh(server)
    assert server.is_active is True
    assert server.tools == discovered_tools


@pytest.mark.asyncio
async def test_enable_mcp_server_fails_when_no_tools_discovered(client: AsyncClient, db_session, monkeypatch):
    from src.services.mcp import mcp_config

    async def fake_discover_server_tools(**kwargs):
        return []

    monkeypatch.setattr(mcp_config, "discover_server_tools", fake_discover_server_tools, raising=False)
    server = await _create_mcp_server(db_session, tools=[], is_active=False)

    resp = await client.put(f"/api/mcp/servers/{server.id}/toggle", json={"is_active": True})

    assert resp.status_code == 400
    assert "未发现可用工具" in resp.json()["detail"]

    await db_session.refresh(server)
    assert server.is_active is False
    assert server.tools == []


@pytest.mark.asyncio
async def test_enable_mcp_server_with_existing_tools_does_not_rediscover(client: AsyncClient, db_session, monkeypatch):
    from src.services.mcp import mcp_config

    existing_tools = [{
        "name": "bing_search",
        "description": "Search with Bing",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
    }]

    async def discover_should_not_run(**kwargs):
        raise AssertionError("已有 tools 时不应该重新发现")

    monkeypatch.setattr(mcp_config, "discover_server_tools", discover_should_not_run, raising=False)
    server = await _create_mcp_server(db_session, tools=existing_tools, is_active=False)

    resp = await client.put(f"/api/mcp/servers/{server.id}/toggle", json={"is_active": True})

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_active"] is True
    assert data["tools"] == ["bing_search"]

    await db_session.refresh(server)
    assert server.is_active is True
    assert server.tools == existing_tools
