"""Blog working-copy, publishing, and revision services."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from src.database.models import BlogPost as BlogPostModel
from src.database.models import BlogPostRevision, User
from src.services.workspace.blog.blog_body_service import get_post_body
from src.services.workspace.blog.blog_storage_service import (
    ensure_unique_slug,
    slug_from_title,
    upsert_post_from_meta,
)

logger = logging.getLogger(__name__)

SYSTEM_USER_ID = 1
REVISION_LIMIT = 10


@dataclass
class PublicPostView:
    """Public projection: metadata and body from a pinned published revision."""

    id: int
    title: str
    slug: str
    content: str
    excerpt: Optional[str]
    cover_image: Optional[str]
    status: str
    tags: Optional[str]
    author: Optional[str]
    view_count: int
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime]

    @classmethod
    def from_post_revision(
        cls,
        post: BlogPostModel,
        revision: BlogPostRevision,
        include_content: bool = True,
    ) -> "PublicPostView":
        return cls(
            id=post.id,
            title=revision.title,
            slug=revision.slug,
            content=revision.content if include_content else "",
            excerpt=revision.excerpt,
            cover_image=revision.cover_image,
            status="published",
            tags=revision.tags,
            author=revision.author,
            view_count=post.view_count or 0,
            created_at=post.created_at,
            updated_at=revision.created_at,
            published_at=post.published_at,
        )


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _check_ownership(post: Optional[BlogPostModel], user_id: int) -> BlogPostModel:
    if post is None or post.deleted_at is not None or post.user_id != user_id:
        raise ValueError("Post not found")
    return post


def _meta_from_post(post: BlogPostModel) -> dict:
    return {
        "title": post.title,
        "tags": post.tags,
        "status": post.status or "draft",
        "author": post.author or "ai-blog",
        "excerpt": post.excerpt,
        "cover_image": post.cover_image,
    }


async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    return (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()


async def get_post(db: AsyncSession, post_id: int) -> Optional[BlogPostModel]:
    post = await db.get(BlogPostModel, post_id)
    return post if post is not None and post.deleted_at is None else None


async def get_owned_post(db: AsyncSession, post_id: int, user_id: int) -> Optional[BlogPostModel]:
    post = await get_post(db, post_id)
    return post if post is not None and post.user_id == user_id else None


async def _get_published_pair_by_id(
    db: AsyncSession, post_id: int
) -> tuple[BlogPostModel, BlogPostRevision] | None:
    result = await db.execute(
        select(BlogPostModel, BlogPostRevision)
        .join(BlogPostRevision, BlogPostModel.published_revision_id == BlogPostRevision.id)
        .where(
            BlogPostModel.id == post_id,
            BlogPostModel.deleted_at.is_(None),
            BlogPostModel.status == "published",
        )
    )
    return result.one_or_none()


async def get_published_post_by_id(db: AsyncSession, post_id: int) -> Optional[PublicPostView]:
    pair = await _get_published_pair_by_id(db, post_id)
    return PublicPostView.from_post_revision(*pair) if pair else None


async def get_post_for_site_viewer(
    db: AsyncSession,
    owner_username: str,
    slug: str,
    viewer_user_id: Optional[int],
) -> Optional[BlogPostModel | PublicPostView]:
    owner = await get_user_by_username(db, owner_username)
    if not owner:
        return None

    if viewer_user_id == owner.id:
        result = await db.execute(
            select(BlogPostModel).where(
                BlogPostModel.user_id == owner.id,
                BlogPostModel.slug == slug,
                BlogPostModel.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    result = await db.execute(
        select(BlogPostModel, BlogPostRevision)
        .join(BlogPostRevision, BlogPostModel.published_revision_id == BlogPostRevision.id)
        .where(
            BlogPostModel.user_id == owner.id,
            BlogPostModel.deleted_at.is_(None),
            BlogPostModel.status == "published",
            BlogPostRevision.slug == slug,
        )
    )
    pair = result.one_or_none()
    return PublicPostView.from_post_revision(*pair) if pair else None


async def list_posts(
    db: AsyncSession,
    *,
    viewer_user_id: Optional[int] = None,
    owner_username: Optional[str] = None,
    include_drafts_for_owner: bool = False,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: Optional[int] = None,  # None 或 <=0 表示返回全部
) -> dict:
    if owner_username:
        owner = await get_user_by_username(db, owner_username)
        if not owner:
            return {"posts": [], "total": 0, "page": page, "per_page": 0}
        owner_id = owner.id
    else:
        owner_id = viewer_user_id if viewer_user_id is not None else SYSTEM_USER_ID

    page = max(1, page)
    paginated = per_page is not None and per_page > 0

    is_owner = viewer_user_id is not None and viewer_user_id == owner_id
    if is_owner and include_drafts_for_owner:
        filters = [
            BlogPostModel.user_id == owner_id,
            BlogPostModel.deleted_at.is_(None),
        ]
        if status:
            filters.append(BlogPostModel.status == status)
        if search:
            pattern = f"%{search}%"
            filters.append(or_(BlogPostModel.title.ilike(pattern), BlogPostModel.content.ilike(pattern)))
        total = None
        if paginated:
            total = await db.scalar(select(func.count(BlogPostModel.id)).where(*filters)) or 0
        stmt = (
            select(BlogPostModel)
            .options(defer(BlogPostModel.content), defer(BlogPostModel.blocks_json))
            .where(*filters)
            .order_by(desc(BlogPostModel.updated_at), desc(BlogPostModel.id))
        )
        if paginated:
            stmt = stmt.offset((page - 1) * per_page).limit(per_page)
        posts = (await db.execute(stmt)).scalars().all()
    else:
        if status and status != "published":
            return {"posts": [], "total": 0, "page": page, "per_page": 0}
        filters = [
            BlogPostModel.user_id == owner_id,
            BlogPostModel.deleted_at.is_(None),
            BlogPostModel.status == "published",
        ]
        if search:
            pattern = f"%{search}%"
            filters.append(or_(BlogPostRevision.title.ilike(pattern), BlogPostRevision.content.ilike(pattern)))
        total = None
        if paginated:
            total = (
                await db.scalar(
                    select(func.count(BlogPostModel.id))
                    .join(BlogPostRevision, BlogPostModel.published_revision_id == BlogPostRevision.id)
                    .where(*filters)
                )
                or 0
            )
        stmt = (
            select(BlogPostModel, BlogPostRevision)
            .options(
                defer(BlogPostModel.content),
                defer(BlogPostModel.blocks_json),
                defer(BlogPostRevision.content),
            )
            .join(BlogPostRevision, BlogPostModel.published_revision_id == BlogPostRevision.id)
            .where(*filters)
            .order_by(desc(BlogPostModel.published_at), desc(BlogPostModel.id))
        )
        if paginated:
            stmt = stmt.offset((page - 1) * per_page).limit(per_page)
        pairs = (await db.execute(stmt)).all()
        posts = [
            PublicPostView.from_post_revision(post, revision, include_content=False)
            for post, revision in pairs
        ]

    if total is None:
        total = len(posts)
    return {"posts": posts, "total": total, "page": page, "per_page": per_page if paginated else 0}


async def _create_revision(
    db: AsyncSession,
    post: BlogPostModel,
    *,
    kind: str,
) -> BlogPostRevision:
    latest_number = await db.scalar(
        select(func.max(BlogPostRevision.revision_number)).where(BlogPostRevision.post_id == post.id)
    )
    revision = BlogPostRevision(
        post_id=post.id,
        user_id=post.user_id,
        revision_number=(latest_number or 0) + 1,
        kind=kind,
        title=post.title,
        slug=post.slug,
        content=get_post_body(post),
        excerpt=post.excerpt,
        cover_image=post.cover_image,
        category_id=post.category_id,
        tags=post.tags,
        author=post.author,
    )
    db.add(revision)
    await db.flush()
    return revision


async def _prune_revisions(db: AsyncSession, post: BlogPostModel) -> None:
    revisions = (
        await db.execute(
            select(BlogPostRevision)
            .where(BlogPostRevision.post_id == post.id)
            .order_by(BlogPostRevision.revision_number.desc())
        )
    ).scalars().all()
    retained_count = len(revisions)
    for revision in reversed(revisions):
        if retained_count <= REVISION_LIMIT:
            break
        if revision.id == post.published_revision_id:
            continue
        await db.delete(revision)
        retained_count -= 1


async def create_post(db: AsyncSession, data: dict, user_id: int) -> BlogPostModel:
    requested_status = data.get("status") or "draft"
    base_slug = data.get("slug") or slug_from_title(data.get("title", ""))
    slug = await ensure_unique_slug(base_slug, db, user_id=user_id)
    author = data.get("author")
    if not author:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        author = user.username if user else "ai-blog"
    post = await upsert_post_from_meta(
        db,
        user_id=user_id,
        slug=slug,
        meta={
            "title": data["title"],
            "tags": data.get("tags"),
            "status": "draft",
            "author": author,
            "excerpt": data.get("excerpt"),
            "cover_image": data.get("cover_image"),
        },
        body=data.get("content") or "",
    )
    if post is None:
        raise RuntimeError("Unable to create blog post")
    if requested_status == "published":
        published = await publish_post(db, post.id, True, user_id)
        if published is None:
            raise RuntimeError("Unable to publish blog post")
        return published
    return post


async def update_post(db: AsyncSession, post_id: int, data: dict, user_id: int) -> Optional[BlogPostModel]:
    post = _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    requested_status = data.get("status") if "status" in data else None
    current_body = get_post_body(post)
    content_changed = "content" in data and (data["content"] or "") != (current_body or "")
    meta = _meta_from_post(post)
    slug = post.slug
    if data.get("title") and data["title"] != post.title:
        meta["title"] = data["title"]
        slug = await ensure_unique_slug(slug_from_title(data["title"]), db, user_id=user_id, exclude_id=post.id)
    for key in ("excerpt", "cover_image", "tags"):
        if key in data:
            meta[key] = data[key]
    body = data["content"] if "content" in data else current_body
    if requested_status == "draft":
        meta["status"] = "draft"

    updated = await upsert_post_from_meta(
        db,
        user_id=user_id,
        slug=slug,
        meta=meta,
        body=body or "",
        existing_post_id=post.id,
    )
    if updated is None:
        return None
    if content_changed:
        # 正文实质变更：标记 AI 知识索引过期（旧向量仍可检索，用户手动刷新后重建）
        from src.services.workspace import rag_service

        await rag_service.mark_stale(db, user_id, "blog_post", post_id)
    if requested_status == "draft":
        updated.published_revision_id = None
        updated.published_at = None
        await db.commit()
        await db.refresh(updated)
    elif requested_status == "published":
        return await publish_post(db, updated.id, True, user_id)
    return updated


async def commit_revision(db: AsyncSession, post_id: int, user_id: int) -> BlogPostRevision:
    post = _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    revision = await _create_revision(db, post, kind="commit")
    await _prune_revisions(db, post)
    await db.commit()
    await db.refresh(revision)
    return revision


async def publish_post(db: AsyncSession, post_id: int, publish: bool, user_id: int) -> Optional[BlogPostModel]:
    post = _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    if not publish:
        post.status = "draft"
        post.published_revision_id = None
        post.published_at = None
        post.updated_at = _now()
        await db.commit()
        await db.refresh(post)
        logger.info("blog unpublish user_id=%s post_id=%s", user_id, post.id)
        return post

    revision = await _create_revision(db, post, kind="publish")
    post.published_revision_id = revision.id
    post.status = "published"
    post.published_at = _now()
    post.updated_at = _now()
    await _prune_revisions(db, post)
    await db.commit()
    await db.refresh(post)
    logger.info(
        "blog publish user_id=%s post_id=%s revision_id=%s",
        user_id, post.id, post.published_revision_id,
    )
    return post


async def list_revisions(db: AsyncSession, post_id: int, user_id: int) -> list[BlogPostRevision]:
    _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    return (
        await db.execute(
            select(BlogPostRevision)
            .where(BlogPostRevision.post_id == post_id, BlogPostRevision.user_id == user_id)
            .order_by(BlogPostRevision.revision_number.desc())
        )
    ).scalars().all()


async def get_revision(
    db: AsyncSession, post_id: int, revision_id: int, user_id: int
) -> BlogPostRevision:
    _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    revision = await db.get(BlogPostRevision, revision_id)
    if revision is None or revision.post_id != post_id or revision.user_id != user_id:
        raise ValueError("Revision not found")
    return revision


async def restore_revision(
    db: AsyncSession, post_id: int, revision_id: int, user_id: int
) -> BlogPostModel:
    post = _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    revision = await get_revision(db, post_id, revision_id, user_id)
    slug = revision.slug
    if slug != post.slug:
        slug = await ensure_unique_slug(slug, db, user_id=user_id, exclude_id=post.id)
    restored = await upsert_post_from_meta(
        db,
        user_id=user_id,
        slug=slug,
        meta={
            "title": revision.title,
            "tags": revision.tags,
            "status": post.status,
            "author": revision.author,
            "excerpt": revision.excerpt,
            "cover_image": revision.cover_image,
        },
        body=revision.content,
        existing_post_id=post.id,
    )
    if restored is None:
        raise ValueError("Post not found")
    restored.category_id = revision.category_id
    await db.commit()
    await db.refresh(restored)
    logger.info(
        "blog revision restored user_id=%s post_id=%s revision_id=%s revision_no=%s",
        user_id, post_id, revision_id, revision.revision_number,
    )
    return restored


async def delete_revision(db: AsyncSession, post_id: int, revision_id: int, user_id: int) -> None:
    post = _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    revision = await get_revision(db, post_id, revision_id, user_id)
    if revision.id == post.published_revision_id:
        raise ValueError("Published revision cannot be deleted")
    await db.delete(revision)
    await db.commit()
    logger.info(
        "blog revision deleted user_id=%s post_id=%s revision_id=%s",
        user_id, post_id, revision_id,
    )


async def delete_post(db: AsyncSession, post_id: int, user_id: int) -> bool:
    post = _check_ownership(await db.get(BlogPostModel, post_id), user_id)
    post.deleted_at = _now()
    await db.commit()
    logger.info("blog post soft-deleted user_id=%s post_id=%s", user_id, post_id)
    # 进回收站即取消进行中的索引任务，并 best-effort 清理 AI 大脑记忆（不等维护周期）
    from src.services.workspace.file.file_processing_service import cancel_jobs_for_resource
    from src.services.memory.graph_store import delete_resource_memory

    await cancel_jobs_for_resource(
        db, user_id=user_id, resource_type="blog_post", resource_id=post_id
    )
    try:
        await delete_resource_memory(user_id=user_id, resource_type="blog_post", resource_id=post_id)
    except Exception:
        logger.warning("博客软删清理 AI 大脑记忆失败（留待维护周期）: post_id=%s", post_id, exc_info=True)
    return True


async def increment_view_count(db: AsyncSession, post_id: int) -> None:
    post = await db.get(BlogPostModel, post_id)
    if post and post.deleted_at is None:
        post.view_count = (post.view_count or 0) + 1
        await db.commit()


async def ensure_intro_post(db: AsyncSession, data: dict, user_id: int) -> BlogPostModel:
    result = await db.execute(
        select(BlogPostModel).where(
            BlogPostModel.user_id == user_id,
            BlogPostModel.slug == "ai-blog-intro",
        )
    )
    post = result.scalar_one_or_none()
    if post is None:
        return await create_post(db, data, user_id)
    return post
