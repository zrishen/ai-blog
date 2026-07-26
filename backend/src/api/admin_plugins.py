"""管理员平台插件 API；MCP 的运行配置只允许可信管理员提交。"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.plugins import (
    AdminPluginCreate,
    AdminPluginListResponse,
    AdminPluginPublishRequest,
    AdminPluginResponse,
    AdminPluginUpdate,
)
from src.services.plugins.plugin_service import (
    PluginNotFoundError,
    create_admin_plugin,
    delete_admin_plugin,
    list_admin_plugins,
    set_admin_plugin_published,
    update_admin_plugin,
)
from src.utils.auth import require_admin

router = APIRouter(prefix="/admin/plugins", tags=["admin"])


@router.get("", response_model=AdminPluginListResponse)
async def list_plugins(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminPluginListResponse:
    plugins = await list_admin_plugins(db)
    return AdminPluginListResponse(plugins=[AdminPluginResponse(**plugin) for plugin in plugins])


@router.post("", response_model=AdminPluginResponse, status_code=status.HTTP_201_CREATED)
async def create_plugin(
    payload: AdminPluginCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AdminPluginResponse:
    try:
        plugin = await create_admin_plugin(db, admin.id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return AdminPluginResponse(**plugin)


@router.put("/{plugin_id}", response_model=AdminPluginResponse)
async def update_plugin(
    plugin_id: int,
    payload: AdminPluginUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminPluginResponse:
    try:
        plugin = await update_admin_plugin(db, plugin_id, payload.model_dump(exclude_unset=True))
    except PluginNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AdminPluginResponse(**plugin)


@router.put("/{plugin_id}/publish", response_model=AdminPluginResponse)
async def publish_plugin(
    plugin_id: int,
    payload: AdminPluginPublishRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminPluginResponse:
    try:
        plugin = await set_admin_plugin_published(db, plugin_id, payload.is_published)
    except PluginNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AdminPluginResponse(**plugin)


@router.delete("/{plugin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plugin(
    plugin_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    try:
        await delete_admin_plugin(db, plugin_id)
    except PluginNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
