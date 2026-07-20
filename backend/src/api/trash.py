"""统一回收站路由。

GET    /api/trash                            -> {items, total}  按 deleted_at 倒序
POST   /api/trash/{type}/{id}/restore        -> {status, item}
DELETE /api/trash/{type}/{id}                永久删除（仅作用于回收站内记录）
DELETE /api/trash                            -> {status, deleted, failed, remaining}
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.file_processing import FileProcessingJobResponse
from src.schemas.trash import (
    TrashClearResponse,
    TrashListResponse,
    TrashRestoreResponse,
)
from src.services.trash_service import (
    SUPPORTED_TYPES,
    empty_trash,
    list_trash,
    purge_item,
    restore_item,
)
from src.utils.auth import get_current_user

router = APIRouter()


@router.get("/trash", response_model=TrashListResponse)
async def get_trash(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await list_trash(db, user_id=user.id)
    return TrashListResponse(items=items, total=len(items))


@router.post("/trash/{item_type}/{item_id}/restore")
async def restore_trash_item(
    item_type: str,
    item_id: int,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if item_type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=400, detail=f"不支持的类型: {item_type}")
    item = await restore_item(
        db, item_type=item_type, item_id=item_id, user_id=user.id
    )
    if item_type == "file_document":
        response.status_code = status.HTTP_202_ACCEPTED
        return FileProcessingJobResponse.model_validate(item)
    return TrashRestoreResponse(status="ok", item=item)


@router.delete("/trash/{item_type}/{item_id}")
async def purge_trash_item(
    item_type: str,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if item_type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=400, detail=f"不支持的类型: {item_type}")
    await purge_item(db, item_type=item_type, item_id=item_id, user_id=user.id)
    return {"status": "ok"}


@router.delete("/trash", response_model=TrashClearResponse)
async def empty_all_trash(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await empty_trash(db, user_id=user.id)
    return TrashClearResponse(**result)
