"""工作区资源挂靠服务：把博客/文件/研究挂进文件夹，或解绑回未归档（inbox）。

resource 节点是引用关系（不持有内容，一个资源至多一个挂靠点）；解绑=硬删挂靠点，资源本身不受影响。
"""

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


async def is_resource_alive(
    db: AsyncSession, resource_type: str | None, resource_id: int | None
) -> bool:
    """底层资源行是否存在（active 或软删均算存活；已 purge=行不存在=False）。
    research_topic 等无回收站的类型按存活处理，保留挂靠点。"""
    if resource_type is None or resource_id is None:
        return False
    model = _SOFT_DELETABLE_MODELS.get(resource_type)
    if model is None:
        return True
    return (await db.get(model, resource_id)) is not None


async def _soft_deleted_resource_node(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> WorkspaceNodeModel | None:
    """查同 (user, resource_type, resource_id) 的软删挂靠点（_resource_node 只查 active，看不见它）。"""
    stmt = select(WorkspaceNodeModel).where(
        WorkspaceNodeModel.user_id == user_id,
        WorkspaceNodeModel.node_type == "resource",
        WorkspaceNodeModel.resource_type == resource_type,
        WorkspaceNodeModel.resource_id == resource_id,
        WorkspaceNodeModel.deleted_at.is_not(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


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
    """把资源挂靠到指定文件夹。已挂靠（active）则抛 ConflictError；存在软删挂靠点则复活复用，
    绕过 uq_workspace_nodes_resource 全局唯一约束（删 folder 后资源重新归档的必要路径）。"""
    if resource_type not in RESOURCE_TYPES:
        raise ValidationFailedError(f"不支持的资源类型：{resource_type}")
    if parent_id is None:
        raise ValidationFailedError("挂靠资源必须指定父文件夹")
    if await _resource_node(db, user_id, resource_type, resource_id) is not None:
        raise ConflictError("该资源已挂靠到工作区")
    parent = await get_owned_node(db, parent_id, user_id)
    if parent.node_type != "folder":
        raise ValidationFailedError("父节点必须是文件夹")
    desired_slug = _resource_slug(resource_type, resource_id)
    display_name = name or _resource_slug(resource_type, resource_id)
    soft = await _soft_deleted_resource_node(db, user_id, resource_type, resource_id)
    if soft is not None:
        # 复活软删挂靠点：清软删、改父、重算 slug/sort_order（避免唯一约束冲突）
        soft.deleted_at = None
        soft.parent_id = parent_id
        soft.name = display_name
        soft.slug = await ensure_unique_slug(db, user_id, parent_id, desired_slug, exclude_id=soft.id)
        soft.sort_order = await next_sort_order(db, user_id, parent_id)
        node = soft
    else:
        node = WorkspaceNodeModel(
            user_id=user_id,
            parent_id=parent_id,
            node_type="resource",
            resource_type=resource_type,
            resource_id=resource_id,
            name=display_name,
            slug=await ensure_unique_slug(db, user_id, parent_id, desired_slug),
            sort_order=await next_sort_order(db, user_id, parent_id),
        )
        db.add(node)
    await db.commit()
    await db.refresh(node)
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
    return node


async def get_resource_node(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> WorkspaceNodeModel | None:
    return await _resource_node(db, user_id, resource_type, resource_id)
