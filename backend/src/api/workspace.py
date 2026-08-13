"""Workspace filesystem and AI-knowledge routes."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.file_processing import FileProcessingJobResponse
from src.schemas.workspace import (
    EntryDelete,
    EntryMove,
    EntryPatch,
    FolderCreate,
    RagJoinRequest,
    RagJoinResponse,
    RagSourceResponse,
    WorkspaceEntryResponse,
    WorkspaceTreeResponse,
)
from src.services.workspace import rag_service, workspace_file_service
from src.utils.auth import get_current_user

router = APIRouter()


@router.get("/workspace/tree", response_model=WorkspaceTreeResponse)
async def get_workspace_tree(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"entries": await workspace_file_service.list_entries(db, user.id)}


@router.post("/workspace/folders", response_model=WorkspaceEntryResponse, status_code=201)
async def create_folder(
    data: FolderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await workspace_file_service.create_folder(db, user.id, name=data.name, parent_path=data.parent_path)


@router.patch("/workspace/entries", response_model=WorkspaceEntryResponse)
async def rename_entry(
    data: EntryPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await workspace_file_service.rename_entry(db, user.id, path=data.path, name=data.name)


@router.post("/workspace/entries/move", response_model=WorkspaceEntryResponse)
async def move_entry(
    data: EntryMove,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await workspace_file_service.move_entry(db, user.id, path=data.path, target_path=data.target_path)


@router.delete("/workspace/folders", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    data: EntryDelete,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await workspace_file_service.delete_folder(db, user.id, path=data.path)
    return None


@router.delete("/workspace/entries", status_code=status.HTTP_204_NO_CONTENT)
async def delete_unmanaged_workspace_file(
    data: EntryDelete,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await workspace_file_service.delete_unmanaged_file(db, user.id, path=data.path)
    return None


@router.post("/workspace/ai-knowledge", response_model=RagJoinResponse, status_code=201)
async def join_ai_knowledge(
    data: RagJoinRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if data.resource_type == "file":
        source, job = await rag_service.index_file_document(db, user.id, data.resource_id)
    elif data.resource_type == "blog_post":
        source, job = await rag_service.index_blog_post(db, user.id, data.resource_id)
    else:
        source = await rag_service.add_to_ai_knowledge(
            db, user.id, resource_type=data.resource_type, resource_id=data.resource_id
        )
        job = None
    return RagJoinResponse(
        rag_source=source,
        job=FileProcessingJobResponse.model_validate(job) if job else None,
    )


@router.delete(
    "/workspace/ai-knowledge/{resource_type}/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def leave_ai_knowledge(
    resource_type: str,
    resource_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if resource_type == "file":
        await rag_service.unindex_file_document(db, user.id, resource_id)
    elif resource_type == "blog_post":
        await rag_service.unindex_blog_post(db, user.id, resource_id)
    else:
        await rag_service.remove_from_ai_knowledge(db, user.id, resource_type, resource_id)
    return None


@router.get("/workspace/ai-knowledge", response_model=list[RagSourceResponse])
async def list_ai_knowledge(
    index_status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await rag_service.list_ai_knowledge(db, user.id, status=index_status)
