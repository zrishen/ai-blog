"""用户插件：仅展示平台已发布插件，并允许启用或停用。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.plugins import PluginEnabledRequest, UserPluginListResponse, UserPluginResponse
from src.services.infra.plugins.plugin_service import (
    PluginNotFoundError,
    PluginNotReadyError,
    list_user_plugins,
    set_user_plugin_enabled,
)
from src.utils.auth import get_current_user

router = APIRouter(prefix="/plugins", tags=["plugins"])


@router.get("", response_model=UserPluginListResponse)
async def list_plugins(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserPluginListResponse:
    plugins = await list_user_plugins(db, user.id)
    return UserPluginListResponse(plugins=[UserPluginResponse(**plugin) for plugin in plugins])


@router.put("/{plugin_id}/enabled", response_model=UserPluginResponse)
async def set_plugin_enabled(
    plugin_id: int,
    payload: PluginEnabledRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserPluginResponse:
    try:
        plugin = await set_user_plugin_enabled(db, user.id, plugin_id, payload.is_enabled)
    except PluginNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PluginNotReadyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return UserPluginResponse(**plugin)
