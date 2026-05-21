"""MCP 服务配置路由。"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/mcp/servers")
async def list_mcp_servers(db: AsyncSession = Depends(get_db)):
    from src.services.mcp_config import list_mcp_servers as _list
    servers = await _list(db)
    return {"servers": servers}


@router.post("/mcp/servers")
async def add_mcp_server(data: dict, db: AsyncSession = Depends(get_db)):
    from src.services.mcp_config import add_mcp_server as _add
    server = await _add(
        db,
        name=data["name"],
        server_type=data["server_type"],
        command=data.get("command"),
        args=json.dumps(data.get("args", [])) if data.get("args") else None,
        env_vars=json.dumps(data.get("env_vars", {})) if data.get("env_vars") else None,
        url=data.get("url"),
        tools=data.get("tools"),
    )
    logger.info("MCP server added: %s (type=%s)", data["name"], data["server_type"])
    return server


@router.put("/mcp/servers/{server_id}/toggle")
async def toggle_mcp_server(server_id: int, payload: dict, db: AsyncSession = Depends(get_db)):
    from src.services.mcp_config import toggle_builtin_server as _toggle
    result = await _toggle(db, server_id, payload.get("is_active", True))
    return result


@router.delete("/mcp/servers/{server_id}")
async def delete_mcp_server(server_id: int, db: AsyncSession = Depends(get_db)):
    from src.services.mcp_config import delete_mcp_server as _delete
    try:
        deleted = await _delete(db, server_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Server not found")
        logger.info("MCP server deleted: id=%d", server_id)
        return {"status": "ok"}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/mcp/seed")
async def seed_builtins(db: AsyncSession = Depends(get_db)):
    """手动触发内置工具种子数据写入（应用启动时未自动调用时可用此接口）。"""
    from src.services.mcp_config import seed_default_tools
    await seed_default_tools(db)
    return {"status": "ok", "message": "Built-in tools seeded"}
