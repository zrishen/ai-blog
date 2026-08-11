"""统一判定 workspace 路径属于哪类受管资源。

agent 文件工具与 HTTP workspace service 共用，避免 agent 绕过 FileDocument 的
删除/RAG/恢复生命周期。精确等值匹配；仅识别 active 资源。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost, FileDocument
from src.services.workspace.file.file_service import normalize_workspace_file_path


class ResourceKind(str, Enum):
    BLOG_POST = "blog_post"
    FILE_DOCUMENT = "file_document"
    UNMANAGED = "unmanaged"


@dataclass(frozen=True)
class ResolvedResource:
    kind: ResourceKind
    relative_path: str
    resource_id: int | None = None


async def resolve_workspace_resource(
    db: AsyncSession,
    *,
    user_id: int,
    relative_path: str,
) -> ResolvedResource:
    """判定 canonical workspace 相对路径属于 BlogPost / FileDocument / 普通文件。

    FileDocument 按 ``normalize_workspace_file_path`` 归一化**存储值**后比较（非入参），
    以容忍历史无 ``uploads/`` 前缀数据。
    """

    blog_post_id = await db.scalar(
        select(BlogPost.id).where(
            BlogPost.user_id == user_id,
            BlogPost.deleted_at.is_(None),
            BlogPost.file_path == relative_path,
        )
    )
    if blog_post_id is not None:
        return ResolvedResource(ResourceKind.BLOG_POST, relative_path, int(blog_post_id))

    for document in (
        await db.execute(
            select(FileDocument).where(
                FileDocument.user_id == str(user_id),
                FileDocument.deleted_at.is_(None),
            )
        )
    ).scalars():
        try:
            if normalize_workspace_file_path(document.file_path) == relative_path:
                return ResolvedResource(ResourceKind.FILE_DOCUMENT, relative_path, document.id)
        except ValueError:
            continue

    return ResolvedResource(ResourceKind.UNMANAGED, relative_path, None)
