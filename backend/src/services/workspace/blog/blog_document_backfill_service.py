"""Explicit, one-post export from the legacy BlogPost working copy to markdown.

This service intentionally has no scheduler or public API entry point. It is
the verified single-post export primitive used by the opt-in canary and later
storage-cutover tooling.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogCategory, BlogPost
from src.services.workspace.blog.blog_document_store import (
    BlogDocument,
    blog_document_path,
    default_blog_document_path,
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
    return datetime.now(UTC).replace(tzinfo=None)


def _relative_path(post: BlogPost) -> str:
    return post.file_path or default_blog_document_path(post.slug)


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


async def _get_owned_post_for_update(
    db: AsyncSession,
    *,
    post_id: int,
    user_id: int,
) -> BlogPost | None:
    """Re-read the mutable working copy while holding its row lock."""

    return (
        await db.execute(
            select(BlogPost)
            .where(
                BlogPost.id == post_id,
                BlogPost.user_id == user_id,
                BlogPost.deleted_at.is_(None),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _read_and_hash(
    user_id: int,
    relative_path: str,
    expected_slug: str,
) -> tuple[BlogDocument, str]:
    document = await asyncio.to_thread(
        read_blog_document,
        user_id,
        relative_path,
        expected_slug=expected_slug,
    )
    return document, hashlib.sha256(document.body.encode("utf-8")).hexdigest()


async def _mark_error(db: AsyncSession, post: BlogPost, error: Exception) -> None:
    """Persist an error only from a live transaction and never replace one."""

    if post.content_storage_state == "error":
        await db.rollback()
        return
    post.content_storage_state = "error"
    post.last_storage_error = str(error)[:_MAX_STORAGE_ERROR_LENGTH] or error.__class__.__name__
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise


async def _verify_existing(
    post: BlogPost,
    expected: BlogDocument,
) -> tuple[str, str]:
    relative_path = _relative_path(post)
    document, digest = await _read_and_hash(post.user_id, relative_path, post.slug)
    if document != expected:
        raise BlogDocumentBackfillError("Verified blog document no longer matches the legacy working copy")
    if post.file_path != relative_path:
        raise BlogDocumentBackfillError("Verified blog document path is inconsistent")
    if post.content_sha256 != digest:
        raise BlogDocumentBackfillError("Verified blog document SHA-256 does not match the database")
    return relative_path, digest


async def _recover_marker_commit_failure(
    db: AsyncSession,
    *,
    post_id: int,
    user_id: int,
    marker_error: Exception,
) -> BlogDocumentBackfillResult:
    """Resolve an ambiguous marker commit without trusting its failed session.

    A database error can be reported after the server has committed the marker.
    Roll back first, then lock and re-read the row.  Only a fully matching
    verified row is considered successful; every other still-owned row is
    explicitly marked as an error from the fresh transaction.
    """

    await db.rollback()
    post = await _get_owned_post_for_update(db, post_id=post_id, user_id=user_id)
    if post is None:
        raise BlogDocumentBackfillError("Post disappeared while recording document verification") from marker_error

    if post.content_storage_state == "verified":
        try:
            expected = await _document_from_post(db, post)
            relative_path, digest = await _verify_existing(post, expected)
        except Exception:
            pass
        else:
            result = BlogDocumentBackfillResult(
                post_id=post.id,
                file_path=relative_path,
                content_sha256=digest,
                wrote_document=True,
            )
            await db.rollback()
            return result

    try:
        await _mark_error(db, post, marker_error)
    except Exception as error_recording_error:
        raise BlogDocumentBackfillError(
            "Document verification marker failed and its error state could not be recorded"
        ) from error_recording_error
    raise BlogDocumentBackfillError("Document verification marker commit failed") from marker_error


async def _recover_verified_check_commit_failure(
    db: AsyncSession,
    *,
    post_id: int,
    user_id: int,
    check_error: Exception,
) -> BlogDocumentBackfillResult:
    """Re-check a verified no-op after its lock-release commit was ambiguous."""

    await db.rollback()
    post = await _get_owned_post_for_update(db, post_id=post_id, user_id=user_id)
    if post is None:
        raise BlogDocumentBackfillError("Post disappeared while checking verified document") from check_error

    if post.content_storage_state != "verified":
        await db.rollback()
        raise BlogDocumentBackfillError("Blog document state changed while checking verification") from check_error

    try:
        expected = await _document_from_post(db, post)
        relative_path, digest = await _verify_existing(post, expected)
    except Exception as consistency_error:
        try:
            await _mark_error(db, post, consistency_error)
        except Exception as error_recording_error:
            raise BlogDocumentBackfillError(
                "Verified document check failed and its error state could not be recorded"
            ) from error_recording_error
        raise BlogDocumentBackfillError(
            "Verified blog document is inconsistent after commit failure"
        ) from consistency_error

    result = BlogDocumentBackfillResult(
        post_id=post.id,
        file_path=relative_path,
        content_sha256=digest,
        wrote_document=False,
    )
    await db.rollback()
    return result


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

    post = await _get_owned_post_for_update(db, post_id=post_id, user_id=user_id)
    if post is None:
        raise ValueError("Post not found")

    if post.content_storage_state == "error":
        await db.rollback()
        raise BlogDocumentBackfillError("Blog document backfill is in an error state and requires explicit repair")

    if post.content_storage_state == "verified":
        try:
            expected = await _document_from_post(db, post)
            relative_path, digest = await _verify_existing(post, expected)
            result = BlogDocumentBackfillResult(
                post_id=post.id,
                file_path=relative_path,
                content_sha256=digest,
                wrote_document=False,
            )
        except Exception as exc:
            await _mark_error(db, post, exc)
            if isinstance(exc, BlogDocumentBackfillError):
                raise
            raise BlogDocumentBackfillError("Blog document backfill failed") from exc

        try:
            await db.commit()
        except Exception as exc:
            return await _recover_verified_check_commit_failure(
                db,
                post_id=post_id,
                user_id=user_id,
                check_error=exc,
            )
        return result

    try:
        expected = await _document_from_post(db, post)
        relative_path = _relative_path(post)
        path = await asyncio.to_thread(write_blog_document, post.user_id, relative_path, expected)
        read_back, digest = await _read_and_hash(post.user_id, relative_path, post.slug)
        if read_back != expected:
            raise BlogDocumentBackfillError("Blog document read-back does not match the legacy working copy")
        if path != blog_document_path(post.user_id, relative_path):
            raise BlogDocumentBackfillError("Blog document was written outside its managed path")

        post.file_path = relative_path
        post.content_storage_state = "verified"
        post.content_sha256 = digest
        post.file_migrated_at = _utcnow()
        post.last_storage_error = None
        result = BlogDocumentBackfillResult(
            post_id=post.id,
            file_path=relative_path,
            content_sha256=digest,
            wrote_document=True,
        )
    except Exception as exc:
        await _mark_error(db, post, exc)
        if isinstance(exc, BlogDocumentBackfillError):
            raise
        raise BlogDocumentBackfillError("Blog document backfill failed") from exc

    try:
        await db.commit()
    except Exception as exc:
        return await _recover_marker_commit_failure(
            db,
            post_id=post_id,
            user_id=user_id,
            marker_error=exc,
        )
    return result
