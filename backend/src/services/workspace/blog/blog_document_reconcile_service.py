"""Synchronize an edited managed Markdown document back to its DB indexes."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ValidationFailedError
from src.database.models import BlogCategory, BlogPost
from src.services.workspace.blog.blog_document_store import read_blog_document

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BlogDocumentReconcileResult:
    managed: bool
    content_changed: bool = False
    metadata_changed: bool = False


async def reconcile_blog_document(
    db: AsyncSession,
    *,
    user_id: int,
    relative_path: str,
) -> BlogDocumentReconcileResult:
    """Mirror one managed Markdown document into its BlogPost index.

    Unknown workspace files are intentionally ignored: creating a Markdown file
    must not implicitly create a public-facing blog record.
    """

    post = (
        await db.execute(
            select(BlogPost).where(
                BlogPost.user_id == user_id,
                BlogPost.deleted_at.is_(None),
                BlogPost.file_path == relative_path,
            )
        )
    ).scalar_one_or_none()
    if post is None:
        return BlogDocumentReconcileResult(managed=False)

    document = await asyncio.to_thread(
        read_blog_document,
        user_id,
        relative_path,
        expected_slug=post.slug,
    )
    if document.status != post.status:
        raise ValidationFailedError("Managed blog status must be changed through the blog workflow")

    category_id: int | None = None
    if document.category is not None:
        category_id = await db.scalar(
            select(BlogCategory.id).where(
                BlogCategory.user_id == user_id,
                BlogCategory.slug == document.category,
            )
        )
        if category_id is None:
            raise ValidationFailedError("Managed blog category does not exist")

    content_changed = post.content != document.body
    metadata_changed = any(
        (
            post.title != document.title,
            post.excerpt != document.excerpt,
            post.cover_image != document.cover,
            post.tags != document.tags,
            post.author != document.author,
            post.category_id != category_id,
        )
    )
    if not content_changed and not metadata_changed:
        return BlogDocumentReconcileResult(managed=True)

    post.title = document.title
    post.content = document.body
    post.excerpt = document.excerpt
    post.cover_image = document.cover
    post.tags = document.tags
    post.author = document.author
    post.category_id = category_id
    post.content_storage_state = "verified"
    post.content_sha256 = hashlib.sha256(document.body.encode("utf-8")).hexdigest()
    post.last_storage_error = None
    try:
        from src.services.workspace.markdown.markdown_ast_service import parse_to_blocks

        post.blocks_json = parse_to_blocks(document.body)
    except Exception:
        logger.warning("Unable to parse blog blocks after document reconcile: post_id=%s", post.id, exc_info=True)
        post.blocks_json = None
    await db.commit()
    await db.refresh(post)

    if content_changed:
        from src.services.workspace import rag_service

        await rag_service.mark_stale(db, user_id, "blog_post", post.id)
    return BlogDocumentReconcileResult(
        managed=True,
        content_changed=content_changed,
        metadata_changed=metadata_changed,
    )
