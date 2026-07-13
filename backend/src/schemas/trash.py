"""统一回收站 schemas。

支持三类资源：conversation / file_document / blog_post。
列表按 deleted_at 倒序聚合，仅返回 deleted_at 非空且属于当前用户的记录。
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


TrashType = Literal["conversation", "file_document", "blog_post"]


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
