"""工作区资源挂靠服务：把博客/文件/研究挂进文件夹，或解绑回未归档（inbox）。

resource 节点是引用关系（不持有内容，一个资源至多一个挂靠点）；解绑=硬删挂靠点，资源本身不受影响。
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from src.database.models import BlogPost as BlogPostModel
from src.database.models import FileDocument as FileDocumentModel
from src.database.models import WorkspaceNode as WorkspaceNodeModel
from src.services.workspace.node_service import (
    ensure_unique_slug,
    get_owned_node,
    next_sort_order,
)

logger = logging.getLogger(__name__)

RESOURCE_TYPES = {"blog_post", "file", "research_topic"}

# 工作区可挂靠且底层带软删（回收站）的资源类型 → 模型。research_topic 无回收站，不在此列。
_SOFT_DELETABLE_MODELS = {"file": FileDocumentModel, "blog_post": BlogPostModel}


async def soft_deleted_resource_ids(
    db: AsyncSession, resource_type: str, ids: list[int]
) -> set[int]:
    """返回这批 resource_id 中底层资源已软删（进回收站）的集合；底层无 deleted_at 的类型（research_topic）返回空集。"""
    if not ids:
        return set()
    model = _SOFT_DELETABLE_MODELS.get(resource_type)
    if model is None:
        return set()
    stmt = select(model.id).where(model.id.in_(ids), model.deleted_at.is_not(None))
    return {row[0] for row in (await db.execute(stmt)).all()}


async def _maybe_auto_index(
    db: AsyncSession,
    user_id: int,
    resource_type: str,
    resource_id: int,
    folder: WorkspaceNodeModel,
) -> None:
    """目录开启 auto_index 时，挂靠/移入的 file 资源自动加入 AI 知识（best-effort，失败不阻塞挂靠）。"""
    if not folder.auto_index or resource_type != "file":
        return
    from src.services.workspace.rag_service import index_file_document

    try:
        await index_file_document(db, user_id, document_id=resource_id)
    except Exception:
        logger.warning("auto_index 触发索引失败: %s/%s", resource_type, resource_id, exc_info=True)


def _resource_slug(resource_type: str, resource_id: int) -> str:
    return f"{resource_type}-{resource_id}"


async def _resource_node(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> WorkspaceNodeModel | None:
    stmt = select(WorkspaceNodeModel).where(
        WorkspaceNodeModel.user_id == user_id,
        WorkspaceNodeModel.node_type == "resource",
        WorkspaceNodeModel.resource_type == resource_type,
        WorkspaceNodeModel.resource_id == resource_id,
        WorkspaceNodeModel.deleted_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def attach_resource(
    db: AsyncSession,
    user_id: int,
    *,
    resource_type: str,
    resource_id: int,
    parent_id: int,
    name: str | None = None,
) -> WorkspaceNodeModel:
    """把资源挂靠到指定文件夹。已挂靠则抛 ConflictError。"""
    if resource_type not in RESOURCE_TYPES:
        raise ValidationFailedError(f"不支持的资源类型：{resource_type}")
    if parent_id is None:
        raise ValidationFailedError("挂靠资源必须指定父文件夹")
    if await _resource_node(db, user_id, resource_type, resource_id) is not None:
        raise ConflictError("该资源已挂靠到工作区")
    parent = await get_owned_node(db, parent_id, user_id)
    if parent.node_type != "folder":
        raise ValidationFailedError("父节点必须是文件夹")
    slug = await ensure_unique_slug(db, user_id, parent_id, _resource_slug(resource_type, resource_id))
    node = WorkspaceNodeModel(
        user_id=user_id,
        parent_id=parent_id,
        node_type="resource",
        resource_type=resource_type,
        resource_id=resource_id,
        name=name or _resource_slug(resource_type, resource_id),
        slug=slug,
        sort_order=await next_sort_order(db, user_id, parent_id),
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    await _maybe_auto_index(db, user_id, resource_type, resource_id, parent)
    return node


async def detach_resource(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> WorkspaceNodeModel:
    """解绑：硬删 resource 挂靠点，资源回到未归档。不删资源本身。"""
    node = await _resource_node(db, user_id, resource_type, resource_id)
    if node is None:
        raise NotFoundError("该资源未挂靠到工作区")
    await db.delete(node)
    await db.commit()
    return node


async def detach_resource_if_any(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> None:
    """回收站还原用：若有挂靠点则硬删（回 inbox），无则空操作；与 detach_resource 的区别：不抛 NotFound、不自行 commit（由调用方统一提交）。"""
    node = await _resource_node(db, user_id, resource_type, resource_id)
    if node is not None:
        await db.delete(node)


async def move_resource(
    db: AsyncSession,
    user_id: int,
    resource_type: str,
    resource_id: int,
    *,
    new_parent_id: int,
) -> WorkspaceNodeModel:
    """把已挂靠资源移到另一个文件夹。"""
    node = await _resource_node(db, user_id, resource_type, resource_id)
    if node is None:
        raise NotFoundError("该资源未挂靠到工作区")
    parent = await get_owned_node(db, new_parent_id, user_id)
    if parent.node_type != "folder":
        raise ValidationFailedError("目标节点必须是文件夹")
    node.parent_id = new_parent_id
    node.slug = await ensure_unique_slug(
        db, user_id, new_parent_id, _resource_slug(resource_type, resource_id), exclude_id=node.id
    )
    node.sort_order = await next_sort_order(db, user_id, new_parent_id)
    await db.commit()
    await db.refresh(node)
    await _maybe_auto_index(db, user_id, resource_type, resource_id, parent)
    return node


async def get_resource_node(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> WorkspaceNodeModel | None:
    return await _resource_node(db, user_id, resource_type, resource_id)
