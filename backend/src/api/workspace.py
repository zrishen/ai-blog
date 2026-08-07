"""工作区组织层路由：目录树 + 资源挂靠 + AI 知识。

视图（草稿/已发布/资料/研究）复用各域现有 API，工作区仅提供组织层特有端点。
service 层抛 DomainError，由 main.py 全局 handler 统一转 JSON，故此处无需 try/except。
"""

from typing import Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.file_processing import FileProcessingJobResponse
from src.schemas.workspace import (
    AttachRequest,
    FolderCreate,
    MoveResourceRequest,
    NodeMove,
    NodePatch,
    RagJoinRequest,
    RagJoinResponse,
    RagSourceResponse,
    ReorderRequest,
    WorkspaceNodeResponse,
    WorkspaceTreeResponse,
)
from src.services.workspace import node_service, rag_service, resource_service
from src.utils.auth import get_current_user

router = APIRouter()


# ---- 目录树 ----


@router.get("/workspace/tree", response_model=WorkspaceTreeResponse)
async def get_workspace_tree(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    nodes = await node_service.list_all(db, user.id)
    return {"nodes": nodes}


@router.post("/workspace/folders", response_model=WorkspaceNodeResponse, status_code=201)
async def create_folder(
    data: FolderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await node_service.create_folder(
        db, user.id, name=data.name, parent_id=data.parent_id
    )


@router.patch("/workspace/nodes/{node_id}", response_model=WorkspaceNodeResponse)
async def update_node(
    node_id: int,
    data: NodePatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    node = await node_service.get_owned_node(db, node_id, user.id)
    if data.name is not None:
        node = await node_service.rename_node(db, user.id, node_id, data.name)
    return node


@router.post("/workspace/nodes/{node_id}/move", response_model=WorkspaceNodeResponse)
async def move_node(
    node_id: int,
    data: NodeMove,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await node_service.move_node(
        db, user.id, node_id, new_parent_id=data.parent_id, sort_order=data.sort_order
    )


@router.post("/workspace/nodes/reorder", response_model=list[WorkspaceNodeResponse])
async def reorder_nodes(
    data: ReorderRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """同级节点重排（拖拽排序）：按 ordered_ids 重设 sort_order。"""
    return await node_service.reorder_children(db, user.id, data.parent_id, data.ordered_ids)


@router.delete("/workspace/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await node_service.delete_node(db, user.id, node_id)
    return None


# ---- 资源挂靠 ----


@router.post("/workspace/resources/attach", response_model=WorkspaceNodeResponse, status_code=201)
async def attach_resource(
    data: AttachRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await resource_service.attach_resource(
        db,
        user.id,
        resource_type=data.resource_type,
        resource_id=data.resource_id,
        parent_id=data.parent_id,
        name=data.name,
    )


@router.delete(
    "/workspace/resources/{resource_type}/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def detach_resource(
    resource_type: str,
    resource_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await resource_service.detach_resource(db, user.id, resource_type, resource_id)
    return None


@router.post(
    "/workspace/resources/{resource_type}/{resource_id}/move",
    response_model=WorkspaceNodeResponse,
)
async def move_resource(
    resource_type: str,
    resource_id: int,
    data: MoveResourceRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await resource_service.move_resource(
        db, user.id, resource_type, resource_id, new_parent_id=data.new_parent_id
    )


# ---- AI 知识 ----


@router.post("/workspace/ai-knowledge", response_model=RagJoinResponse, status_code=201)
async def join_ai_knowledge(
    data: RagJoinRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """加入 AI 知识。file/blog_post 触发异步索引（返回 job 供前端轮询进度）；其他类型建 pending。"""
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
    index_status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await rag_service.list_ai_knowledge(db, user.id, status=index_status)
