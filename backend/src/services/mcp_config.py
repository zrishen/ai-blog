"""MCP 服务配置管理。支持内置工具预配置 + 用户自定义服务。"""

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# 内置工具定义：name -> module_path
BUILTIN_TOOLS: dict[str, str] = {
    "get_current_time": "src.services.mcp_server_tools",
    "get_weather": "src.services.mcp_server_tools",
    "web_search": "src.services.mcp_server_tools",
}


async def seed_default_tools(db: Session) -> None:
    """启动时插入内置工具条目（如果不存在）。内置工具默认启用。"""
    from src.models.mcp_server import MCPServer as Model

    existing = await db.execute(
        select(Model).where(Model.server_type == "builtin")
    )
    if existing.scalars().first():
        return

    tools_list = list(BUILTIN_TOOLS.keys())
    server = Model(
        name="内置工具 (Built-in Tools)",
        server_type="builtin",
        tools=tools_list,
        is_active=True,
    )
    db.add(server)
    await db.commit()
    logger.info("Seeded %d builtin tools into MCP servers table", len(tools_list))


async def list_mcp_servers(db: Session) -> list:
    from src.models.mcp_server import MCPServer as Model

    result = await db.execute(select(Model).order_by(Model.id))
    rows = result.scalars().all()
    servers = []
    for c in rows:
        srv = {
            "id": c.id,
            "name": c.name,
            "server_type": c.server_type,
            "tools": c.tools,
            "command": c.command,
            "args": json.loads(c.args) if c.args else [],
            "env_vars": json.loads(c.env_vars) if c.env_vars else {},
            "url": c.url,
            "is_active": c.is_active,
            "created_at": str(c.created_at),
            "updated_at": str(c.updated_at),
        }
        if c.server_type == "builtin" and c.tools:
            srv["command"] = "python"
            srv["args"] = ["-m", "src.services.mcp_server_tools"]
        servers.append(srv)
    return servers


async def add_mcp_server(db: Session, name: str, server_type: str, **kwargs) -> dict:
    from src.models.mcp_server import MCPServer as Model

    server = Model(
        name=name,
        server_type=server_type,
        **kwargs,
    )
    db.add(server)
    await db.commit()
    await db.refresh(server)
    return {
        "id": server.id,
        "name": server.name,
        "server_type": server.server_type,
        "tools": server.tools,
        "command": server.command,
        "args": json.loads(server.args) if server.args else [],
        "env_vars": json.loads(server.env_vars) if server.env_vars else {},
        "url": server.url,
        "is_active": server.is_active,
        "created_at": str(server.created_at),
        "updated_at": str(server.updated_at),
    }


async def toggle_builtin_server(db: Session, server_id: int, is_active: bool) -> dict:
    """切换内置工具服务的启用状态（不是删除，只是开关）。"""
    from src.models.mcp_server import MCPServer as Model

    server = await db.get(Model, server_id)
    if not server or server.server_type != "builtin":
        raise ValueError("Only builtin servers can be toggled")
    server.is_active = is_active
    await db.commit()
    await db.refresh(server)
    return {
        "id": server.id,
        "name": server.name,
        "is_active": server.is_active,
    }


async def delete_mcp_server(db: Session, server_id: int) -> bool:
    """删除自定义 MCP 服务。内置服务不能被删除，只能切换开关。"""
    from src.models.mcp_server import MCPServer as Model

    server = await db.get(Model, server_id)
    if not server:
        return False
    if server.server_type == "builtin":
        raise PermissionError("Cannot delete builtin server, use toggle instead")
    stmt = select(Model).where(Model.id == server_id)
    result = await db.execute(stmt)
    obj = result.scalar_one()
    await db.delete(obj)
    await db.commit()
    return True
