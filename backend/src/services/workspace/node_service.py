"""工作区目录树服务：文件夹节点的建/改名/移动/删除/排序。

folder 软删（可从回收站恢复）；resource 挂靠点硬删（资源不受影响，回未归档）。所有操作 user-scoped。
"""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.database.models import BlogPost as BlogPostModel
from src.database.models import WorkspaceNode as WorkspaceNodeModel
from src.database.models import _utcnow

_SLUG_RE = re.compile(r"[^\w一-龥]+")


def slugify(name: str) -> str:
    """节点 slug：保留中文/字母/数字/下划线，其余折成 -，小写。空名兜底 untitled。"""
    slug = _SLUG_RE.sub("-", (name or "").strip()).strip("-").lower()
    return slug or "untitled"


async def get_owned_node(db: AsyncSession, node_id: int, user_id: int) -> WorkspaceNodeModel:
    """取节点并校验归属；不存在或已软删抛 NotFoundError，跨用户抛 OwnershipError。"""
    node = await db.get(WorkspaceNodeModel, node_id)
    if node is None or node.deleted_at is not None:
        raise NotFoundError("工作区节点不存在")
    if node.user_id != user_id:
        raise OwnershipError("无权访问该工作区节点")
    return node


async def ensure_unique_slug(
    db: AsyncSession,
    user_id: int,
    parent_id: int | None,
    slug: str,
    *,
    exclude_id: int | None = None,
) -> str:
    """同父目录下 slug 唯一；冲突则追加 -2/-3。根目录(parent_id=None)单独处理。"""
    base = slug
    n = 2
    while True:
        stmt = select(WorkspaceNodeModel).where(
            WorkspaceNodeModel.user_id == user_id,
            WorkspaceNodeModel.deleted_at.is_(None),
            WorkspaceNodeModel.slug == slug,
            WorkspaceNodeModel.parent_id.is_(None) if parent_id is None else WorkspaceNodeModel.parent_id == parent_id,
        )
        if exclude_id is not None:
            stmt = stmt.where(WorkspaceNodeModel.id != exclude_id)
        if (await db.execute(stmt)).scalar_one_or_none() is None:
            return slug
        slug = f"{base}-{n}"
        n += 1


async def next_sort_order(db: AsyncSession, user_id: int, parent_id: int | None) -> int:
    """同级末尾的 sort_order。"""
    stmt = select(WorkspaceNodeModel).where(
        WorkspaceNodeModel.user_id == user_id,
        WorkspaceNodeModel.deleted_at.is_(None),
        WorkspaceNodeModel.parent_id.is_(None) if parent_id is None else WorkspaceNodeModel.parent_id == parent_id,
    )
    nodes = (await db.execute(stmt)).scalars().all()
    return max((nd.sort_order for nd in nodes), default=-1) + 1


async def create_folder(
    db: AsyncSession,
    user_id: int,
    *,
    name: str,
    parent_id: int | None = None,
    auto_index: bool = False,
) -> WorkspaceNodeModel:
    name = (name or "").strip()
    if not name:
        raise ValidationFailedError("文件夹名称不能为空")
    if parent_id is not None:
        parent = await get_owned_node(db, parent_id, user_id)
        if parent.node_type != "folder":
            raise ValidationFailedError("父节点必须是文件夹")
    slug = await ensure_unique_slug(db, user_id, parent_id, slugify(name))
    node = WorkspaceNodeModel(
        user_id=user_id,
        parent_id=parent_id,
        node_type="folder",
        name=name,
        slug=slug,
        sort_order=await next_sort_order(db, user_id, parent_id),
        auto_index=auto_index,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return node


async def rename_node(db: AsyncSession, user_id: int, node_id: int, name: str) -> WorkspaceNodeModel:
    name = (name or "").strip()
    if not name:
        raise ValidationFailedError("名称不能为空")
    node = await get_owned_node(db, node_id, user_id)
    node.name = name
    node.slug = await ensure_unique_slug(db, user_id, node.parent_id, slugify(name), exclude_id=node.id)
    await db.commit()
    await db.refresh(node)
    return node


async def move_node(
    db: AsyncSession,
    user_id: int,
    node_id: int,
    *,
    new_parent_id: int | None = None,
    sort_order: int | None = None,
) -> WorkspaceNodeModel:
    """移动节点；禁止移入自身或自身子树（防环）。"""
    node = await get_owned_node(db, node_id, user_id)
    if new_parent_id is not None:
        if new_parent_id == node_id:
            raise ConflictError("不能将节点移入自身")
        parent = await get_owned_node(db, new_parent_id, user_id)
        if parent.node_type != "folder":
            raise ValidationFailedError("目标节点必须是文件夹")
        if await is_descendant(db, new_parent_id, node_id):
            raise ConflictError("不能将节点移入其子目录")
    node.parent_id = new_parent_id
    node.slug = await ensure_unique_slug(db, user_id, new_parent_id, node.slug, exclude_id=node.id)
    if sort_order is not None:
        node.sort_order = sort_order
    await db.commit()
    await db.refresh(node)
    return node


async def is_descendant(db: AsyncSession, candidate_id: int, ancestor_id: int) -> bool:
    """candidate 是否是 ancestor 的后代（沿 parent_id 上溯）。"""
    current_id = candidate_id
    while current_id is not None:
        if current_id == ancestor_id:
            return True
        cur = await db.get(WorkspaceNodeModel, current_id)
        if cur is None or cur.deleted_at is not None:
            return False
        current_id = cur.parent_id
    return False


async def delete_node(db: AsyncSession, user_id: int, node_id: int) -> WorkspaceNodeModel:
    """删除节点：folder 软删（可恢复）并递归处理子树；resource 挂靠点硬删（资源回未归档）。"""
    node = await get_owned_node(db, node_id, user_id)
    await _remove_subtree(db, node_id)
    await db.commit()
    return node


async def _remove_subtree(db: AsyncSession, node_id: int) -> None:
    for child in await _raw_children(db, node_id):
        await _remove_subtree(db, child.id)
    node = await db.get(WorkspaceNodeModel, node_id)
    if node is None:
        return
    if node.node_type == "resource":
        await db.delete(node)
    else:
        node.deleted_at = _utcnow()


async def _raw_children(db: AsyncSession, parent_id: int) -> list[WorkspaceNodeModel]:
    stmt = select(WorkspaceNodeModel).where(
        WorkspaceNodeModel.parent_id == parent_id,
        WorkspaceNodeModel.deleted_at.is_(None),
    )
    return list((await db.execute(stmt)).scalars().all())


async def reorder_children(
    db: AsyncSession, user_id: int, parent_id: int | None, ordered_ids: list[int]
) -> list[WorkspaceNodeModel]:
    """按 ordered_ids 重排某父目录下子节点；返回重排后的子节点列表。"""
    for idx, nid in enumerate(ordered_ids):
        node = await get_owned_node(db, nid, user_id)
        if node.parent_id != parent_id:
            raise ValidationFailedError("节点不在指定父目录下")
        node.sort_order = idx
    await db.commit()
    return await list_children(db, user_id, parent_id)


async def list_children(
    db: AsyncSession, user_id: int, parent_id: int | None = None
) -> list[WorkspaceNodeModel]:
    stmt = select(WorkspaceNodeModel).where(
        WorkspaceNodeModel.user_id == user_id,
        WorkspaceNodeModel.deleted_at.is_(None),
        WorkspaceNodeModel.parent_id.is_(None) if parent_id is None else WorkspaceNodeModel.parent_id == parent_id,
    ).order_by(WorkspaceNodeModel.sort_order, WorkspaceNodeModel.id)
    return list((await db.execute(stmt)).scalars().all())


async def list_all(db: AsyncSession, user_id: int) -> list[WorkspaceNodeModel]:
    """用户全部可见节点（扁平列表，前端组装树）。

    resource 挂靠点是引用关系：底层资源进回收站后节点仍存留，返回前剔除已软删的
    file/blog_post 挂靠点，使工作区与删除状态一致；恢复后自动重现。
    """
    stmt = select(WorkspaceNodeModel).where(
        WorkspaceNodeModel.user_id == user_id,
        WorkspaceNodeModel.deleted_at.is_(None),
    ).order_by(WorkspaceNodeModel.parent_id, WorkspaceNodeModel.sort_order, WorkspaceNodeModel.id)
    nodes = list((await db.execute(stmt)).scalars().all())
    visible_nodes = await _without_soft_deleted_resources(db, nodes)
    return await _with_blog_status(db, user_id, visible_nodes)


async def _with_blog_status(
    db: AsyncSession, user_id: int, nodes: list[WorkspaceNodeModel]
) -> list[WorkspaceNodeModel]:
    """为文章挂靠节点补充发布状态，供工作区视图选择对应图标。"""
    post_ids = [
        node.resource_id
        for node in nodes
        if node.resource_type == "blog_post" and node.resource_id is not None
    ]
    if not post_ids:
        return nodes

    stmt = select(BlogPostModel.id, BlogPostModel.status).where(
        BlogPostModel.id.in_(post_ids),
        BlogPostModel.user_id == user_id,
        BlogPostModel.deleted_at.is_(None),
    )
    statuses = dict((await db.execute(stmt)).all())
    for node in nodes:
        if node.resource_type == "blog_post" and node.resource_id is not None:
            node.blog_status = statuses.get(node.resource_id)
    return nodes


async def _without_soft_deleted_resources(
    db: AsyncSession, nodes: list[WorkspaceNodeModel]
) -> list[WorkspaceNodeModel]:
    """剔除底层资源已软删的 resource 节点；folder 与无回收站的类型（research_topic）原样保留。"""
    from src.services.workspace.resource_service import soft_deleted_resource_ids

    by_type: dict[str, list[int]] = {}
    for nd in nodes:
        if nd.node_type == "resource" and nd.resource_type and nd.resource_id is not None:
            by_type.setdefault(nd.resource_type, []).append(nd.resource_id)
    hidden: set[tuple[str, int]] = set()
    for rtype, rids in by_type.items():
        for rid in await soft_deleted_resource_ids(db, rtype, rids):
            hidden.add((rtype, rid))
    if not hidden:
        return nodes
    return [
        nd
        for nd in nodes
        if nd.node_type != "resource" or (nd.resource_type, nd.resource_id) not in hidden
    ]


async def get_folder_path(
    db: AsyncSession, user_id: int, node_id: int
) -> list[WorkspaceNodeModel]:
    """从根到当前节点的路径（面包屑）。"""
    path: list[WorkspaceNodeModel] = []
    current_id: int | None = node_id
    while current_id is not None:
        node = await get_owned_node(db, current_id, user_id)
        path.append(node)
        current_id = node.parent_id
    path.reverse()
    return path
