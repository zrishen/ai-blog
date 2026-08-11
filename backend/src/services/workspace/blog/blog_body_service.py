"""Verified working-copy body seam for blog consumers."""

from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import NotFoundError, ValidationFailedError
from src.database.models import BlogPost
from src.services.workspace.blog.blog_document_store import (
    default_blog_document_path,
    read_blog_document,
)


async def get_post_body(post: BlogPost) -> str:
    """Read the working-copy body from its canonical Markdown document."""

    document = await asyncio.to_thread(
        read_blog_document,
        post.user_id,
        post.file_path or default_blog_document_path(post.slug),
        expected_slug=post.slug,
    )
    return document.body


async def collect_blog_body_image_refs(
    db: AsyncSession,
    user_id: int,
    *,
    exclude_post_id: int | None = None,
) -> set[str]:
    """Collect stored filenames referenced inline in the user's blog bodies.

    Reads the Markdown working copy (truth) per post, falling back to the DB
    content mirror when the md is unavailable.
    """
    from src.services.workspace.markdown.markdown_ast_service import extract_inline_image_urls
    from src.services.workspace.trash.trash_service import _extract_local_filename

    stmt = select(BlogPost).where(
        BlogPost.user_id == user_id,
        BlogPost.deleted_at.is_(None),
    )
    if exclude_post_id is not None:
        stmt = stmt.where(BlogPost.id != exclude_post_id)
    result = await db.execute(stmt)
    posts = result.scalars().all()

    refs: set[str] = set()
    for post in posts:
        try:
            body = await get_post_body(post)
        except (NotFoundError, ValidationFailedError, OSError):
            body = post.content or ""
        for url in extract_inline_image_urls(body):
            stored = _extract_local_filename(url)
            if stored:
                refs.add(stored)
    return refs
