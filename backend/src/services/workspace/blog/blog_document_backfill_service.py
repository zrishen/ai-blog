"""Explicit, one-post export from the legacy BlogPost working copy to markdown.

This service intentionally has no scheduler or application entry point.  It is
only the verified data-preparation step for the later storage cutover.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogCategory, BlogPost
from src.services.workspace.blog.blog_document_store import (
    BlogDocument,
    blog_document_path,
    read_blog_document,
    write_blog_document,
)

_MAX_STORAGE_ERROR_LENGTH = 2000


class BlogDocumentBackfillError(RuntimeError):
    """A post could not be verified as a canonical workspace document."""


@dataclass(frozen=True)
class BlogDocumentBackfillResult:
    """The verified outcome of one explicit backfill call."""

    post_id: int
    file_path: str
    content_sha256: str
    wrote_document: bool


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _relative_path(slug: str) -> str:
    return f"posts/{slug}.md"


async def _category_slug(db: AsyncSession, post: BlogPost) -> str | None:
    if post.category_id is None:
        return None
    category = (
        await db.execute(
            select(BlogCategory.slug).where(
                BlogCategory.id == post.category_id,
                BlogCategory.user_id == post.user_id,
            )
        )
    ).scalar_one_or_none()
    if category is None:
        raise BlogDocumentBackfillError("Blog post category is missing or belongs to another user")
    return category


async def _document_from_post(db: AsyncSession, post: BlogPost) -> BlogDocument:
    return BlogDocument(
        slug=post.slug,
        title=post.title,
        body=post.content,
        created_at=post.created_at,
        status=post.status,
        category=await _category_slug(db, post),
        excerpt=post.excerpt,
        tags=post.tags,
        author=post.author,
        cover=post.cover_image,
    )


async def _read_and_hash(user_id: int, slug: str) -> tuple[BlogDocument, str]:
    document = await asyncio.to_thread(read_blog_document, user_id, slug)
    return document, hashlib.sha256(document.body.encode("utf-8")).hexdigest()


async def _mark_error(db: AsyncSession, post: BlogPost, error: Exception) -> None:
    post.content_storage_state = "error"
    post.last_storage_error = str(error)[:_MAX_STORAGE_ERROR_LENGTH] or error.__class__.__name__
    await db.commit()
    await db.refresh(post)


async def _verify_existing(
    post: BlogPost,
    expected: BlogDocument,
) -> tuple[str, str]:
    document, digest = await _read_and_hash(post.user_id, post.slug)
    relative_path = _relative_path(post.slug)
    if document != expected:
        raise BlogDocumentBackfillError("Verified blog document no longer matches the legacy working copy")
    if post.file_path != relative_path:
        raise BlogDocumentBackfillError("Verified blog document has a non-canonical file path")
    if post.content_sha256 != digest:
        raise BlogDocumentBackfillError("Verified blog document SHA-256 does not match the database")
    return relative_path, digest


async def backfill_blog_post_document(
    db: AsyncSession,
    *,
    post_id: int,
    user_id: int,
) -> BlogDocumentBackfillResult:
    """Export, read back, and verify one owned BlogPost before marking it verified.

    A consistently verified row is only read and checked, never rewritten.  A
    missing, malformed, or mismatched verified file is marked ``error`` and
    raised explicitly instead of being silently trusted or overwritten.
    """

    post = await db.get(BlogPost, post_id)
    if post is None or post.deleted_at is not None or post.user_id != user_id:
        raise ValueError("Post not found")

    try:
        expected = await _document_from_post(db, post)
        if post.content_storage_state == "verified":
            relative_path, digest = await _verify_existing(post, expected)
            return BlogDocumentBackfillResult(
                post_id=post.id,
                file_path=relative_path,
                content_sha256=digest,
                wrote_document=False,
            )

        path = await asyncio.to_thread(write_blog_document, post.user_id, expected)
        read_back, digest = await _read_and_hash(post.user_id, post.slug)
        if read_back != expected:
            raise BlogDocumentBackfillError("Blog document read-back does not match the legacy working copy")
        if path != blog_document_path(post.user_id, post.slug):
            raise BlogDocumentBackfillError("Blog document was written outside its canonical path")

        post.file_path = _relative_path(post.slug)
        post.content_storage_state = "verified"
        post.content_sha256 = digest
        post.file_migrated_at = _utcnow()
        post.last_storage_error = None
        await db.commit()
        await db.refresh(post)
        return BlogDocumentBackfillResult(
            post_id=post.id,
            file_path=post.file_path,
            content_sha256=digest,
            wrote_document=True,
        )
    except Exception as exc:
        await _mark_error(db, post, exc)
        if isinstance(exc, BlogDocumentBackfillError):
            raise
        raise BlogDocumentBackfillError("Blog document backfill failed") from exc
