"""平台插件：管理员配置与普通用户启用边界。"""

import pytest

from src.database.models import PlatformPlugin, User
from src.main import app
from src.services.infra.plugins import plugin_service
from src.utils.auth import require_admin


async def _create_user(db_session, username: str, *, is_admin: bool = False) -> User:
    user = User(username=username, password_hash="hash", is_admin=is_admin)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_admin_plugin_keeps_runtime_config_out_of_user_response(db_session, monkeypatch):
    admin = await _create_user(db_session, "plugin-admin", is_admin=True)

    async def fake_discover_plugin_tools(**_kwargs):
        return [{"name": "search", "description": "search", "input_schema": {"type": "object"}}]

    monkeypatch.setattr(plugin_service, "discover_plugin_tools", fake_discover_plugin_tools)
    created = await plugin_service.create_admin_plugin(
        db_session,
        admin.id,
        {
            "slug": "web-search",
            "name": "网页搜索",
            "description": "搜索公开网页",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@example/mcp-search"],
            "env_vars": {"API_KEY": "secret-value"},
            "permission_level": "read",
            "is_published": True,
        },
    )

    assert created["is_published"] is True
    assert created["has_env_vars"] is True
    assert "env_vars" not in created
    assert "secret-value" not in str(created)

    user = await _create_user(db_session, "plugin-user")
    visible = await plugin_service.list_user_plugins(db_session, user.id)
    assert visible == [{
        "id": created["id"],
        "slug": "web-search",
        "name": "网页搜索",
        "description": "搜索公开网页",
        "icon": "Blocks",
        "permission_level": "read",
        "tool_count": 1,
        "is_enabled": False,
    }]
    assert "command" not in visible[0]
    assert "url" not in visible[0]
    assert "env_vars" not in visible[0]


@pytest.mark.asyncio
async def test_user_can_only_enable_published_plugin(db_session):
    admin = await _create_user(db_session, "plugin-admin-2", is_admin=True)
    user = await _create_user(db_session, "plugin-user-2")
    plugin = PlatformPlugin(
        slug="private-plugin",
        name="Private plugin",
        description="",
        transport="stdio",
        command="npx",
        args="[]",
        env_vars="{}",
        tools=[{"name": "tool"}],
        is_published=False,
        created_by_admin_id=admin.id,
    )
    db_session.add(plugin)
    await db_session.commit()
    await db_session.refresh(plugin)

    assert await plugin_service.list_user_plugins(db_session, user.id) == []
    with pytest.raises(plugin_service.PluginNotFoundError):
        await plugin_service.set_user_plugin_enabled(db_session, user.id, plugin.id, True)


@pytest.mark.asyncio
async def test_enable_plugin_creates_user_scoped_installation(db_session):
    admin = await _create_user(db_session, "plugin-admin-3", is_admin=True)
    user_a = await _create_user(db_session, "plugin-user-a")
    user_b = await _create_user(db_session, "plugin-user-b")
    plugin = PlatformPlugin(
        slug="published-plugin",
        name="Published plugin",
        description="",
        transport="stdio",
        command="npx",
        args="[]",
        env_vars="{}",
        tools=[{"name": "tool"}],
        is_published=True,
        created_by_admin_id=admin.id,
    )
    db_session.add(plugin)
    await db_session.commit()
    await db_session.refresh(plugin)

    enabled = await plugin_service.set_user_plugin_enabled(db_session, user_a.id, plugin.id, True)
    assert enabled["is_enabled"] is True
    assert (await plugin_service.list_user_plugins(db_session, user_a.id))[0]["is_enabled"] is True
    assert (await plugin_service.list_user_plugins(db_session, user_b.id))[0]["is_enabled"] is False

    runtime_plugins = await plugin_service.list_enabled_plugin_runtime_configs(db_session, user_a.id)
    assert [runtime["slug"] for runtime in runtime_plugins] == ["published-plugin"]
    assert runtime_plugins[0]["command"] == "npx"
    assert await plugin_service.list_enabled_plugin_runtime_configs(db_session, user_b.id) == []


@pytest.mark.asyncio
async def test_user_plugin_api_does_not_accept_runtime_config(client):
    # 旧的用户自定义 MCP API 已删除；普通用户没有任何提交 command/url/env 的入口。
    response = await client.post("/api/v1/mcp/servers", json={
        "name": "unsafe",
        "server_type": "stdio",
        "command": "powershell",
        "env_vars": {"TOKEN": "secret"},
    })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_user_plugin_endpoint_rejects_runtime_configuration_fields(client):
    response = await client.put("/api/v1/plugins/1/enabled", json={
        "is_enabled": True,
        "command": "powershell",
        "url": "https://unsafe.example/mcp",
        "env_vars": {"TOKEN": "secret"},
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_admin_plugin_api_requires_admin(client):
    response = await client.get("/api/v1/admin/plugins")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_create_and_publish_platform_plugin(client, db_session, monkeypatch):
    admin = await _create_user(db_session, "plugin-api-admin", is_admin=True)

    async def fake_discover_plugin_tools(**_kwargs):
        return [{"name": "search", "description": "search", "input_schema": {"type": "object"}}]

    async def override_admin():
        return admin

    monkeypatch.setattr(plugin_service, "discover_plugin_tools", fake_discover_plugin_tools)
    app.dependency_overrides[require_admin] = override_admin
    try:
        created = await client.post("/api/v1/admin/plugins", json={
            "slug": "12306-mcp",
            "name": "API Search",
            "description": "Search the web",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@example/search"],
            "env_vars": {"API_KEY": "never-return-this"},
            "permission_level": "read",
            "is_published": True,
        })
        assert created.status_code == 201
        data = created.json()
        assert data["is_published"] is True
        assert data["tools"][0]["name"] == "search"
        assert data["has_env_vars"] is True
        assert "env_vars" not in data
        assert "never-return-this" not in created.text

        listed = await client.get("/api/v1/admin/plugins")
        assert listed.status_code == 200
        assert [plugin["slug"] for plugin in listed.json()["plugins"]] == ["12306-mcp"]
    finally:
        app.dependency_overrides.pop(require_admin, None)
