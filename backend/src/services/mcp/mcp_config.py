"""MCP 服务配置管理。支持 stdio / streamable-http 服务。"""

import json
import logging

from sqlalchemy import select

from src.services.mcp.tool_client import discover_server_tools

logger = logging.getLogger(__name__)


class MCPToolDiscoveryError(ValueError):
    pass


def _server_runtime_config(server) -> tuple[list[str], dict[str, str]]:
    args_raw = json.loads(server.args) if isinstance(server.args, str) else (server.args or [])
    env_raw = json.loads(server.env_vars) if isinstance(server.env_vars, str) else (server.env_vars or {})
    return args_raw, env_raw


async def list_mcp_servers(db, user_id: int) -> list:
    from src.database.models import MCPServer

    result = await db.execute(
        select(MCPServer)
        .where(MCPServer.user_id == user_id)
        .order_by(MCPServer.id)
    )
    rows = result.scalars().all()
    servers = []
    for srv in rows:
        servers.append(_server_to_dict(srv))
    return servers


async def add_mcp_server(db, user_id: int, name: str, server_type: str, **kwargs) -> dict:
    from src.database.models import MCPServer

    kwargs.pop("tools", None)
    server = MCPServer(name=name, server_type=server_type, user_id=user_id, tools=[], **kwargs)
    db.add(server)
    await db.commit()
    await db.refresh(server)
    logger.info("MCP服务 [新增] id=%d name=%s type=%s user_id=%s", server.id, name, server_type, user_id)

    if server_type in ("stdio", "streamable-http"):
        args_raw, env_raw = _server_runtime_config(server)
        discovered = await discover_server_tools(
            server_type=server_type,
            command=server.command,
            args=args_raw,
            env_vars=env_raw,
            url=server.url,
        )
        if discovered:
            server.tools = discovered
            await db.commit()
            await db.refresh(server)
            logger.info("MCP服务 [新增] id=%d 发现 %d 个工具: %s",
                        server.id, len(discovered), [t.get("name", "") for t in discovered])
        else:
            logger.warning("MCP服务 [新增] id=%d 未能发现工具", server.id)

    return _server_to_dict(server)


async def toggle_server(db, user_id: int, server_id: int, is_active: bool) -> dict:
    from src.database.models import MCPServer

    server = await db.get(MCPServer, server_id)
    if not server or server.user_id != user_id:
        raise ValueError("Server not found")

    if is_active and not server.tools:
        args_raw, env_raw = _server_runtime_config(server)
        discovered = await discover_server_tools(
            server_type=server.server_type,
            command=server.command,
            args=args_raw,
            env_vars=env_raw,
            url=server.url,
        )
        if not discovered:
            server.is_active = False
            await db.commit()
            await db.refresh(server)
            logger.warning("MCP服务 [启用失败] id=%d 未能发现工具", server_id)
            raise MCPToolDiscoveryError("No tools discovered for MCP server")
        server.tools = discovered
        logger.info("MCP服务 [启用发现] id=%d 发现 %d 个工具: %s",
                    server.id, len(discovered), [t.get("name", "") for t in discovered])

    server.is_active = is_active
    await db.commit()
    await db.refresh(server)
    logger.info("MCP服务 [%s] id=%d user_id=%s", "打开" if is_active else "关闭", server_id, user_id)
    return _server_to_dict(server)


async def delete_mcp_server(db, user_id: int, server_id: int) -> bool:
    from src.database.models import MCPServer

    server = await db.get(MCPServer, server_id)
    if not server or server.user_id != user_id:
        return False
    await db.delete(server)
    await db.commit()
    logger.info("MCP服务 [删除] id=%d name=%s user_id=%s", server_id, server.name, user_id)
    return True


def _server_to_dict(srv) -> dict:
    tool_names = []
    tools_detail = []
    if srv.tools:
        for t in srv.tools:
            if isinstance(t, str):
                tool_names.append(t)
            else:
                name = t.get("name", "")
                if name:
                    tool_names.append(name)
                    tools_detail.append(t)
    return {
        "id": srv.id,
        "name": srv.name,
        "server_type": srv.server_type,
        "tools": [n for n in tool_names if n],
        "tools_detail": tools_detail or None,
        "command": srv.command,
        "args": json.loads(srv.args) if srv.args else [],
        "env_vars": json.loads(srv.env_vars) if srv.env_vars else {},
        "url": srv.url,
        "is_active": srv.is_active,
        "created_at": str(srv.created_at),
    }
