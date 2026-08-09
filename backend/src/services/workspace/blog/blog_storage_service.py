"""Database persistence helpers for editable blog working copies."""

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogCategory as BlogCategoryModel
from src.database.models import BlogPost as BlogPostModel
from src.services.workspace.blog.blog_body_service import get_post_body
from src.utils.slug import slugify

logger = logging.getLogger(__name__)

_LEADING_H1_RE = re.compile(r"^\s*#(?!#)\s+(.+?)\s*#?\s*(?:\r?\n|$)")


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_post_body(title: str, body: str) -> str:
    """Strip a duplicate leading H1 matching the standalone article title."""
    if not title or not body:
        return body
    normalized_title = _normalize_text(title)
    if not normalized_title:
        return body

    def _replacer(match: re.Match[str]) -> str:
        return "" if _normalize_text(match.group(1)) == normalized_title else match.group(0)

    cleaned = _LEADING_H1_RE.sub(_replacer, body, count=1)
    return cleaned.lstrip("\r\n") if cleaned != body else body


def slug_from_title(title: str) -> str:
    return slugify(title)


async def ensure_unique_slug(
    base_slug: str,
    db: AsyncSession,
    *,
    user_id: int,
    exclude_id: Optional[int] = None,
) -> str:
    slug = base_slug
    counter = 1
    while True:
        stmt = select(BlogPostModel).where(
            BlogPostModel.slug == slug,
            BlogPostModel.user_id == user_id,
        )
        if exclude_id is not None:
            stmt = stmt.where(BlogPostModel.id != exclude_id)
        if (await db.execute(stmt)).scalar_one_or_none() is None:
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


async def resolve_category(db: AsyncSession, name: Optional[str], *, user_id: int) -> Optional[int]:
    if not name:
        return None
    result = await db.execute(
        select(BlogCategoryModel).where(
            BlogCategoryModel.name == name,
            BlogCategoryModel.user_id == user_id,
        )
    )
    category = result.scalar_one_or_none()
    if category:
        return category.id
    category = BlogCategoryModel(name=name, slug=slugify(name), user_id=user_id)
    db.add(category)
    await db.flush()
    return category.id


def _parse_datetime(value: object) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if value:
        try:
            return datetime.fromisoformat(str(value))
        except (TypeError, ValueError):
            return None
    return None


async def upsert_post_from_meta(
    db: AsyncSession,
    *,
    user_id: int,
    slug: str,
    meta: dict,
    body: str,
    existing_post_id: Optional[int] = None,
) -> Optional[BlogPostModel]:
    """Persist a complete working copy and refresh its derived AST cache."""
    post: BlogPostModel | None = None
    if existing_post_id is not None:
        post = await db.get(BlogPostModel, existing_post_id)
        if post is not None and post.deleted_at is not None:
            return None

    if post is None:
        result = await db.execute(
            select(BlogPostModel).where(
                BlogPostModel.slug == slug,
                BlogPostModel.user_id == user_id,
            )
        )
        post = result.scalar_one_or_none()
        if post is not None and post.deleted_at is not None:
            return None

    is_new = post is None
    if post is None:
        post = BlogPostModel(title=meta.get("title") or slug, slug=slug, content="", user_id=user_id)
        db.add(post)

    post.title = meta.get("title") or slug
    post.slug = slug
    post.content = normalize_post_body(post.title, body)
    post.excerpt = meta.get("excerpt")
    post.cover_image = meta.get("cover_image")
    post.status = meta.get("status") or post.status or "draft"
    post.tags = meta.get("tags")
    post.author = meta.get("author") or post.author or "ai-blog"
    post.file_path = None
    post.user_id = user_id
    if "category" in meta:
        post.category_id = await resolve_category(db, meta.get("category"), user_id=user_id)

    try:
        from src.services.workspace.markdown.markdown_ast_service import parse_to_blocks

        post.blocks_json = parse_to_blocks(get_post_body(post))
    except Exception:
        logger.warning("Unable to parse blog blocks for slug=%s", slug, exc_info=True)
        post.blocks_json = None

    created_at = _parse_datetime(meta.get("created_at"))
    if is_new and created_at:
        post.created_at = created_at
    published_at = _parse_datetime(meta.get("published_at"))
    if published_at is not None:
        post.published_at = published_at
    post.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(post)
    return post
