"""工作区组织层 schema：目录树节点 + 资源挂靠 + AI 知识源。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ---- 目录树 ----


class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    auto_index: bool = False


class NodePatch(BaseModel):
    """就地改文件夹属性（改名 / 自动索引开关）。移动走 /move 端点（含防环）。"""
    name: Optional[str] = None
    auto_index: Optional[bool] = None


class NodeMove(BaseModel):
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class ReorderRequest(BaseModel):
    """同级节点重排：parent_id + 按顺序的节点 id 列表（folder/resource 各自在其层级内排）。"""
    parent_id: Optional[int] = None
    ordered_ids: list[int]


class WorkspaceNodeResponse(BaseModel):
    id: int
    parent_id: Optional[int] = None
    node_type: str
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None
    name: str
    slug: str
    sort_order: int
    auto_index: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceTreeResponse(BaseModel):
    nodes: list[WorkspaceNodeResponse]


# ---- 资源挂靠 ----


class AttachRequest(BaseModel):
    resource_type: str
    resource_id: int
    parent_id: int
    name: Optional[str] = None


class MoveResourceRequest(BaseModel):
    new_parent_id: int


# ---- AI 知识 ----


class RagJoinRequest(BaseModel):
    resource_type: str
    resource_id: int


class RagSourceResponse(BaseModel):
    id: int
    resource_type: str
    resource_id: int
    index_status: str
    indexed_version: Optional[str] = None
    collection_name: str
    error_message: Optional[str] = None
    indexed_at: Optional[datetime] = None
    updated_at: datetime

    model_config = {"from_attributes": True}
