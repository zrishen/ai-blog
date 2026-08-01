"""平台插件的管理员配置与用户启用服务。"""

import json
import logging
from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.database.models import PlatformPlugin, UserPlugin
from src.services.plugins.mcp_client import discover_plugin_tools

logger = logging.getLogger(__name__)


class PluginNotFoundError(LookupError):
    pass


class PluginNotReadyError(ValueError):
    pass


def _json_list(value: str | list[str] | None) -> list[str]:
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _json_dict(value: str | dict[str, str] | None) -> dict[str, str]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def plugin_runtime_config(plugin: PlatformPlugin) -> dict[str, Any]:
    """仅供服务端 AI 调用；绝不暴露给普通用户 API。"""
    return {
        "id": plugin.id,
        "slug": plugin.slug,
        "name": plugin.name,
        "transport": plugin.transport,
        "command": plugin.command,
        "args": _json_list(plugin.args),
        "env_vars": _json_dict(plugin.env_vars),
        "url": plugin.url,
        "tools": plugin.tools or [],
        "is_published": plugin.is_published,
    }


def admin_plugin_to_dict(plugin: PlatformPlugin) -> dict[str, Any]:
    return {
        "id": plugin.id,
        "slug": plugin.slug,
        "name": plugin.name,
        "description": plugin.description,
        "icon": plugin.icon,
        "transport": plugin.transport,
        "command": plugin.command,
        "args": _json_list(plugin.args),
        "has_env_vars": bool(_json_dict(plugin.env_vars)),
        "url": plugin.url,
        "tools": plugin.tools or [],
        "permission_level": plugin.permission_level,
        "is_published": plugin.is_published,
        "created_at": str(plugin.created_at) if plugin.created_at else None,
        "updated_at": str(plugin.updated_at) if plugin.updated_at else None,
    }


def user_plugin_to_dict(plugin: PlatformPlugin, is_enabled: bool) -> dict[str, Any]:
    return {
        "id": plugin.id,
        "slug": plugin.slug,
        "name": plugin.name,
        "description": plugin.description,
        "icon": plugin.icon,
        "permission_level": plugin.permission_level,
        "tool_count": len(plugin.tools or []),
        "is_enabled": is_enabled,
    }


async def _discover_and_store_tools(db, plugin: PlatformPlugin) -> bool:
    discovered = await discover_plugin_tools(
        transport=plugin.transport,
        command=plugin.command,
        args=_json_list(plugin.args),
        env_vars=_json_dict(plugin.env_vars),
        url=plugin.url,
    )
    if not discovered:
        plugin.tools = []
        return False
    plugin.tools = discovered
    return True


async def list_admin_plugins(db) -> list[dict[str, Any]]:
    result = await db.execute(select(PlatformPlugin).order_by(PlatformPlugin.id.desc()))
    return [admin_plugin_to_dict(plugin) for plugin in result.scalars().all()]


async def create_admin_plugin(db, admin_id: int, data: Mapping[str, Any]) -> dict[str, Any]:
    values = dict(data)
    plugin = PlatformPlugin(
        slug=values["slug"],
        name=values["name"],
        description=values.get("description", ""),
        icon=values.get("icon", "Blocks"),
        transport=values["transport"],
        command=values.get("command"),
        args=json.dumps(values.get("args") or []),
        env_vars=json.dumps(values.get("env_vars") or {}),
        url=str(values["url"]) if values.get("url") else None,
        permission_level=values.get("permission_level", "read"),
        is_published=False,
        tools=[],
        created_by_admin_id=admin_id,
    )
    db.add(plugin)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ValueError("插件标识已存在") from exc

    # 工具发现会启动外部 MCP 进程或连接远程服务，不能在 SQLite 写事务中等待。
    # 先保存为未发布状态，避免一个慢插件阻塞用户开关等其他写操作。
    await db.commit()
    ready = await _discover_and_store_tools(db, plugin)
    requested_published = bool(values.get("is_published"))
    plugin.is_published = requested_published and ready
    await db.commit()
    await db.refresh(plugin)
    if requested_published and not ready:
        logger.warning("Plugin creation kept unpublished because discovery failed: id=%s", plugin.id)
    logger.info("Platform plugin created: id=%s slug=%s admin_id=%s", plugin.id, plugin.slug, admin_id)
    return admin_plugin_to_dict(plugin)


async def get_admin_plugin(db, plugin_id: int) -> PlatformPlugin:
    plugin = await db.get(PlatformPlugin, plugin_id)
    if not plugin:
        raise PluginNotFoundError("插件不存在")
    return plugin


async def update_admin_plugin(db, plugin_id: int, data: Mapping[str, Any]) -> dict[str, Any]:
    plugin = await get_admin_plugin(db, plugin_id)
    changes = dict(data)
    runtime_fields = {"command", "args", "env_vars", "url"}
    runtime_changed = any(field in changes for field in runtime_fields)

    if plugin.transport == "stdio":
        if changes.get("url"):
            raise ValueError("stdio 插件不能提供 url")
        if "command" in changes and not changes["command"]:
            raise ValueError("stdio 插件必须提供 command")
    elif plugin.transport == "streamable-http":
        if changes.get("command"):
            raise ValueError("streamable-http 插件不能提供 command")
        if "url" in changes and not changes["url"]:
            raise ValueError("streamable-http 插件必须提供 url")

    for field in ("name", "description", "icon", "command", "permission_level"):
        if field in changes:
            setattr(plugin, field, changes[field])
    if "args" in changes:
        plugin.args = json.dumps(changes["args"] or [])
    if "env_vars" in changes:
        plugin.env_vars = json.dumps(changes["env_vars"] or {})
    if "url" in changes:
        plugin.url = str(changes["url"]) if changes["url"] else None

    requested_published = bool(changes["is_published"]) if "is_published" in changes else plugin.is_published
    needs_discovery = runtime_changed or (requested_published and not plugin.tools)

    if runtime_changed:
        # 新运行配置未经发现验证前，不允许继续面向用户发布。
        plugin.tools = []
        plugin.is_published = False
    elif "is_published" in changes:
        plugin.is_published = requested_published and bool(plugin.tools)

    # 与创建逻辑相同：先释放 SQLite 写锁，再执行可能很慢的外部发现。
    await db.commit()
    if needs_discovery:
        ready = await _discover_and_store_tools(db, plugin)
        plugin.is_published = requested_published and ready
        await db.commit()

    await db.refresh(plugin)
    logger.info("Platform plugin updated: id=%s slug=%s", plugin.id, plugin.slug)
    return admin_plugin_to_dict(plugin)


async def set_admin_plugin_published(db, plugin_id: int, is_published: bool) -> dict[str, Any]:
    return await update_admin_plugin(db, plugin_id, {"is_published": is_published})


async def delete_admin_plugin(db, plugin_id: int) -> None:
    plugin = await get_admin_plugin(db, plugin_id)
    await db.execute(UserPlugin.__table__.delete().where(UserPlugin.plugin_id == plugin.id))
    await db.delete(plugin)
    await db.commit()
    logger.info("Platform plugin deleted: id=%s slug=%s", plugin.id, plugin.slug)


async def list_user_plugins(db, user_id: int) -> list[dict[str, Any]]:
    result = await db.execute(
        select(PlatformPlugin, UserPlugin.is_enabled)
        .outerjoin(
            UserPlugin,
            (UserPlugin.plugin_id == PlatformPlugin.id) & (UserPlugin.user_id == user_id),
        )
        .where(PlatformPlugin.is_published)
        .order_by(PlatformPlugin.name)
    )
    return [user_plugin_to_dict(plugin, bool(is_enabled)) for plugin, is_enabled in result.all()]


async def list_enabled_plugin_runtime_configs(db, user_id: int) -> list[dict[str, Any]]:
    """返回 AI 可执行的配置（插件权限边界：平台已发布且当前用户明确启用）。"""
    result = await db.execute(
        select(PlatformPlugin)
        .join(UserPlugin, UserPlugin.plugin_id == PlatformPlugin.id)
        .where(
            UserPlugin.user_id == user_id,
            UserPlugin.is_enabled,
            PlatformPlugin.is_published,
        )
    )
    return [plugin_runtime_config(plugin) for plugin in result.scalars().all()]


async def set_user_plugin_enabled(db, user_id: int, plugin_id: int, is_enabled: bool) -> dict[str, Any]:
    plugin = await db.get(PlatformPlugin, plugin_id)
    if not plugin or not plugin.is_published:
        raise PluginNotFoundError("插件不存在或暂不可用")
    if is_enabled and not plugin.tools:
        raise PluginNotReadyError("插件尚未发现可用工具")

    result = await db.execute(
        select(UserPlugin).where(UserPlugin.user_id == user_id, UserPlugin.plugin_id == plugin_id)
    )
    installation = result.scalar_one_or_none()
    if installation is None:
        installation = UserPlugin(user_id=user_id, plugin_id=plugin_id, is_enabled=is_enabled)
        db.add(installation)
    else:
        installation.is_enabled = is_enabled
    await db.commit()
    return user_plugin_to_dict(plugin, is_enabled)
