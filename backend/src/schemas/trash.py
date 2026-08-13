"""统一回收站 schemas：conversation / file_document / blog_post 三类，仅聚合当前用户已软删记录。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

TrashType = Literal["conversation", "file_document", "blog_post", "workspace_file"]


class TrashItem(BaseModel):
    type: TrashType
    id: int
    name: str
    deleted_at: datetime


class TrashListResponse(BaseModel):
    items: list[TrashItem]
    total: int


class TrashRestoreResponse(BaseModel):
    status: str = "ok"
    item: TrashItem


class TrashDeleteItemRef(BaseModel):
    type: TrashType
    id: int


class TrashFailedItem(BaseModel):
    item: TrashDeleteItemRef
    code: str
    message: str


class TrashClearResponse(BaseModel):
    status: Literal["ok", "partial"]
    deleted: list[TrashDeleteItemRef]
    failed: list[TrashFailedItem]
    remaining: int
