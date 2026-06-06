"""MCP 服务配置路由。"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.mcp import (
    MCPServerCreate,
    MCPServerListResponse,
    MCPServerResponse,
    MCPServerToggleRequest,
)
from src.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/mcp/servers", response_model=MCPServerListResponse)
async def list_mcp_servers(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.mcp.mcp_config import list_mcp_servers as _list
    servers = await _list(db, user.id)
    return MCPServerListResponse(
        servers=[MCPServerResponse(**s) for s in servers]
    )


@router.post("/mcp/servers", response_model=MCPServerResponse)
async def add_mcp_server(data: MCPServerCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.mcp.mcp_config import add_mcp_server as _add
    server = await _add(
        db,
        user.id,
        name=data.name,
        server_type=data.server_type,
        command=data.command,
        args=json.dumps(data.args) if data.args else None,
        env_vars=json.dumps(data.env_vars) if data.env_vars else None,
        url=data.url,
    )
    logger.info("MCP server added: %s (type=%s, user_id=%s)", data.name, data.server_type, user.id)
    return MCPServerResponse(**server)


@router.put("/mcp/servers/{server_id}/toggle", response_model=MCPServerResponse)
async def toggle_mcp_server(
    server_id: int,
    payload: MCPServerToggleRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from src.services.mcp.mcp_config import MCPToolDiscoveryError, toggle_server as _toggle
    try:
        result = await _toggle(db, user.id, server_id, payload.is_active)
    except MCPToolDiscoveryError:
        raise HTTPException(status_code=400, detail="启用 MCP 服务失败：未发现可用工具，请检查服务命令、参数、环境变量或 URL。")
    except ValueError:
        raise HTTPException(status_code=404, detail="Server not found")
    return MCPServerResponse(**result)


@router.delete("/mcp/servers/{server_id}")
async def delete_mcp_server(server_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.mcp.mcp_config import delete_mcp_server as _delete
    deleted = await _delete(db, user.id, server_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Server not found")
    logger.info("MCP server deleted: id=%d user_id=%s", server_id, user.id)
    return {"status": "ok"}
