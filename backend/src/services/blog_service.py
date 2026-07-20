"""博客文章 CRUD 服务。"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost as BlogPostModel
from src.database.models import User
from src.services.markdown_blog_service import (
    delete_post_file,
    ensure_unique_slug,
    read_post_by_slug,
    slug_from_title,
    sync_file_to_db,
    write_post,
)

logger = logging.getLogger(__name__)

SYSTEM_USER_ID = 1


def _datetime_to_meta(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


async def _meta_from_post(db: AsyncSession, post: BlogPostModel) -> dict:
    return {
        "title": post.title,
        "slug": post.slug,
        "tags": post.tags,
        "status": post.status or "draft",
        "author": post.author or "ai-blog",
        "excerpt": post.excerpt,
        "cover_image": post.cover_image,
        "created_at": _datetime_to_meta(post.created_at),
        "updated_at": _datetime_to_meta(post.updated_at),
        "published_at": _datetime_to_meta(post.published_at),
    }


async def _load_post_document(db: AsyncSession, post: BlogPostModel) -> tuple[dict, str]:
    data = read_post_by_slug(post.slug, post.user_id)
    if data:
        return data["meta"], data["body"]
    return await _meta_from_post(db, post), post.content or ""


async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def list_posts(
    db: AsyncSession,
    *,
    viewer_user_id: Optional[int] = None,
    owner_username: Optional[str] = None,
    include_drafts_for_owner: bool = False,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 10,
) -> dict:
    """分页列出目标用户文章；非本人只能看到 published。"""
    if owner_username:
        owner = await get_user_by_username(db, owner_username)
        if not owner:
            return {"posts": [], "total": 0, "page": page, "per_page": per_page}
        owner_id = owner.id
    else:
        owner_id = viewer_user_id if viewer_user_id is not None else SYSTEM_USER_ID

    is_owner = viewer_user_id is not None and viewer_user_id == owner_id
    can_include_drafts = is_owner and include_drafts_for_owner

    stmt = select(BlogPostModel).where(
        BlogPostModel.user_id == owner_id,
        BlogPostModel.deleted_at.is_(None),
    )
    count_stmt = select(func.count(BlogPostModel.id)).where(
        BlogPostModel.user_id == owner_id,
        BlogPostModel.deleted_at.is_(None),
    )

    if can_include_drafts:
        if status:
            stmt = stmt.where(BlogPostModel.status == status)
            count_stmt = count_stmt.where(BlogPostModel.status == status)
    else:
        stmt = stmt.where(BlogPostModel.status == "published")
        count_stmt = count_stmt.where(BlogPostModel.status == "published")
        if status and status != "published":
            return {"posts": [], "total": 0, "page": page, "per_page": per_page}

    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            or_(BlogPostModel.title.ilike(pattern), BlogPostModel.content.ilike(pattern))
        )
        count_stmt = count_stmt.where(
            or_(BlogPostModel.title.ilike(pattern), BlogPostModel.content.ilike(pattern))
        )

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    stmt = stmt.order_by(desc(BlogPostModel.created_at)).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(stmt)
    posts = result.scalars().all()

    return {"posts": posts, "total": total, "page": page, "per_page": per_page}


async def get_post(db: AsyncSession, post_id: int) -> Optional[BlogPostModel]:
    """获取单篇文章（不含回收站内）。"""
    post = await db.get(BlogPostModel, post_id)
    if post is None or post.deleted_at is not None:
        return None
    return post


async def get_owned_post(db: AsyncSession, post_id: int, user_id: int) -> Optional[BlogPostModel]:
    post = await db.get(BlogPostModel, post_id)
    if not post or post.deleted_at is not None or post.user_id != user_id:
        return None
    return post


async def get_post_for_site_viewer(
    db: AsyncSession,
    owner_username: str,
    slug: str,
    viewer_user_id: Optional[int],
) -> Optional[BlogPostModel]:
    owner = await get_user_by_username(db, owner_username)
    if not owner:
        return None
    result = await db.execute(
        select(BlogPostModel).where(
            BlogPostModel.user_id == owner.id,
            BlogPostModel.slug == slug,
            BlogPostModel.deleted_at.is_(None),
        )
    )
    post = result.scalar_one_or_none()
    if not post:
        return None
    if viewer_user_id == owner.id:
        return post
    if post.status == "published":
        return post
    return None


async def create_post(db: AsyncSession, data: dict, user_id: int) -> BlogPostModel:
    """创建文章。"""
    status = data.get("status") or "draft"
    base_slug = data.get("slug") or slug_from_title(data.get("title", ""))
    slug = await ensure_unique_slug(base_slug, db, user_id=user_id)
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    if not data.get("author"):
        user_result = await db.execute(select(User).where(User.id == user_id))
        user_row = user_result.scalar_one_or_none()
        data["author"] = user_row.username if user_row else "ai-blog"

    meta = {
        "title": data["title"],
        "slug": slug,
        "tags": data.get("tags"),
        "status": status,
        "author": data.get("author") or "ai-blog",
        "excerpt": data.get("excerpt"),
        "cover_image": data.get("cover_image"),
        "created_at": now,
        "updated_at": now,
        "published_at": now if status == "published" else None,
    }

    write_post(slug, meta, data.get("content") or "", user_id)
    post = await sync_file_to_db(slug, db, user_id=user_id)
    if post is None:
        raise RuntimeError("Blog post sync failed")
    logger.info("博客文章 [创建] id=%d title=%s user_id=%s", post.id, post.title, user_id)
    return post


def _check_ownership(post: Optional[BlogPostModel], user_id: int):
    if post is None:
        raise ValueError("Post not found")
    if post.deleted_at is not None:
        raise ValueError("Post not found")
    if post.user_id != user_id:
        raise ValueError("Post not found")


async def update_post(db: AsyncSession, post_id: int, data: dict, user_id: int) -> Optional[BlogPostModel]:
    """更新文章（部分字段）。"""
    post = await db.get(BlogPostModel, post_id)
    _check_ownership(post, user_id)

    meta, body = await _load_post_document(db, post)
    old_slug = post.slug
    slug = meta.get("slug") or old_slug

    if "title" in data and data["title"]:
        meta["title"] = data["title"]
        if data["title"] != post.title:
            slug = await ensure_unique_slug(slug_from_title(data["title"]), db, user_id=user_id, exclude_id=post_id)
    if "content" in data:
        body = data["content"] or ""
    if "excerpt" in data:
        meta["excerpt"] = data["excerpt"]
    if "cover_image" in data:
        meta["cover_image"] = data["cover_image"]
    if "status" in data and data["status"]:
        meta["status"] = data["status"]
    if "tags" in data:
        meta["tags"] = data["tags"]

    status = meta.get("status") or "draft"
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    meta["slug"] = slug
    meta["updated_at"] = now
    if status == "published" and not meta.get("published_at"):
        meta["published_at"] = now
    elif status != "published":
        meta["published_at"] = None

    # 先写入新内容并同步数据库；只有新状态确认成功后，才删除旧 slug 文件。
    # 避免「先删旧、再写新」在写新或同步失败时丢失旧正文、或造成 slug 不一致。
    write_post(slug, meta, body, user_id)
    updated = await sync_file_to_db(slug, db, user_id=user_id, existing_post_id=post_id)
    if updated is None:
        # 同步失败：新文件已成孤儿（由清理脚本回收），旧 slug 文件保留以保证可恢复
        return None
    if slug != old_slug:
        delete_post_file(old_slug, user_id)
    logger.info("博客文章 [更新] id=%d title=%s", post_id, updated.title)
    return updated


async def delete_post(db: AsyncSession, post_id: int, user_id: int) -> bool:
    """软删除文章（移入回收站，保留 Markdown 文件以便恢复）。"""
    post = await db.get(BlogPostModel, post_id)
    _check_ownership(post, user_id)

    post.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    logger.info("博客文章 [软删] id=%d title=%s user_id=%s", post_id, post.title, user_id)
    return True


async def publish_post(db: AsyncSession, post_id: int, publish: bool, user_id: int) -> Optional[BlogPostModel]:
    """发布或取消发布。"""
    post = await db.get(BlogPostModel, post_id)
    _check_ownership(post, user_id)

    meta, body = await _load_post_document(db, post)
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    meta["slug"] = meta.get("slug") or post.slug
    meta["title"] = meta.get("title") or post.title
    meta["status"] = "published" if publish else "draft"
    meta["published_at"] = now if publish else None
    meta["updated_at"] = now

    write_post(post.slug, meta, body, user_id)
    updated = await sync_file_to_db(post.slug, db, user_id=user_id, existing_post_id=post_id)
    logger.info("博客文章 [%s] id=%d", "发布" if publish else "取消发布", post_id)
    return updated


async def increment_view_count(db: AsyncSession, post_id: int):
    """增加浏览次数。"""
    post = await db.get(BlogPostModel, post_id)
    if post and post.deleted_at is None:
        post.view_count = (post.view_count or 0) + 1
        await db.commit()


async def ensure_intro_post(db: AsyncSession, data: dict, user_id: int):
    """确保官方介绍文章存在；用户删除后仅能从回收站恢复。"""
    stmt = select(BlogPostModel).where(
        BlogPostModel.user_id == user_id,
        BlogPostModel.slug == "ai-blog-intro",
    )
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()
    if post is None:
        return await create_post(db, data, user_id)
    if post.deleted_at is not None:
        return post

    post.title = data["title"]
    post.tags = data["tags"]
    post.excerpt = data["excerpt"]
    post.content = data["content"]
    await db.commit()
    return post
