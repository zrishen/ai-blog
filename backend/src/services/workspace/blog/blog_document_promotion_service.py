"""Explicit, resumable preparation for promoting verified blog documents.

This module deliberately exposes no API, CLI, or startup task.  An operator
must supply a session factory and invoke its preflight/batch functions.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.database.models import BlogPost, RagSource
from src.services.workspace.blog.blog_document_backfill_service import backfill_blog_post_document

logger = logging.getLogger(__name__)

_SHA256_RE = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class BlogDocumentPromotionPreflight:
    """Blog document storage states needed before a promotion batch."""

    total_active_posts: int
    legacy_posts: int
    verified_posts: int
    error_posts: int

    @property
    def is_complete(self) -> bool:
        return self.total_active_posts == self.verified_posts and self.legacy_posts == 0 and self.error_posts == 0


@dataclass(frozen=True)
class BlogDocumentPromotionBatchResult:
    """The outcome of one explicit, keyset-paginated promotion batch."""

    preflight: BlogDocumentPromotionPreflight
    cursor: int | None
    next_id: int | None
    scanned: int
    processed: int
    exported: int
    reverified: int
    skipped_error: int
    failed: int
    failed_post_ids: tuple[int, ...]
    stale_marked: int


async def preflight_blog_document_promotion(db: AsyncSession) -> BlogDocumentPromotionPreflight:
    """Read active post storage states without modifying data."""

    rows = (
        await db.execute(
            select(BlogPost.content_storage_state, func.count(BlogPost.id))
            .where(BlogPost.deleted_at.is_(None))
            .group_by(BlogPost.content_storage_state)
        )
    ).all()
    state_counts: dict[str, int] = {str(state): int(count) for state, count in rows}
    legacy_posts = int(state_counts.get("legacy", 0))
    verified_posts = int(state_counts.get("verified", 0))
    error_posts = int(state_counts.get("error", 0))
    return BlogDocumentPromotionPreflight(
        total_active_posts=legacy_posts + verified_posts + error_posts,
        legacy_posts=legacy_posts,
        verified_posts=verified_posts,
        error_posts=error_posts,
    )


async def _mark_active_rag_source_stale_if_document_changed(
    db: AsyncSession,
    *,
    post_id: int,
    user_id: int,
) -> bool:
    """Mark only a SHA-backed active blog source stale; never schedule work."""

    post = await db.get(BlogPost, post_id)
    if post is None or post.user_id != user_id or post.content_storage_state != "verified":
        return False
    content_sha256 = post.content_sha256
    if not isinstance(content_sha256, str) or _SHA256_RE.fullmatch(content_sha256) is None:
        return False

    source = (
        await db.execute(
            select(RagSource).where(
                RagSource.user_id == user_id,
                RagSource.resource_type == "blog_post",
                RagSource.resource_id == post_id,
            )
        )
    ).scalar_one_or_none()
    if (
        source is None
        or source.index_status != "active"
        or not isinstance(source.indexed_version, str)
        or _SHA256_RE.fullmatch(source.indexed_version) is None
        or source.indexed_version == content_sha256
    ):
        return False

    source.index_status = "stale"
    await db.commit()
    return True


async def run_blog_document_promotion_batch(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    cursor: int | None = None,
    limit: int = 100,
) -> BlogDocumentPromotionBatchResult:
    """Backfill one keyset page, using a fresh session for every non-error post."""

    if limit <= 0:
        raise ValueError("Promotion batch limit must be positive")
    if cursor is not None and cursor < 0:
        raise ValueError("Promotion batch cursor must be non-negative")

    async with session_factory() as preflight_db:
        preflight = await preflight_blog_document_promotion(preflight_db)
        candidate_stmt = (
            select(BlogPost.id, BlogPost.user_id, BlogPost.content_storage_state)
            .where(BlogPost.deleted_at.is_(None))
            .order_by(BlogPost.id)
            .limit(limit + 1)
        )
        if cursor is not None:
            candidate_stmt = candidate_stmt.where(BlogPost.id > cursor)
        candidates = list((await preflight_db.execute(candidate_stmt)).all())

    records = candidates[:limit]
    next_id = records[-1].id if len(candidates) > limit and records else None
    processed = exported = reverified = skipped_error = failed = stale_marked = 0
    failed_post_ids: list[int] = []

    for post_id, user_id, storage_state in records:
        if storage_state == "error":
            skipped_error += 1
            continue
        try:
            async with session_factory() as post_db:
                result = await backfill_blog_post_document(post_db, post_id=post_id, user_id=user_id)
                stale_marked += int(
                    await _mark_active_rag_source_stale_if_document_changed(
                        post_db,
                        post_id=post_id,
                        user_id=user_id,
                    )
                )
        except Exception:
            logger.warning("Blog document promotion failed: post_id=%s", post_id, exc_info=True)
            failed += 1
            failed_post_ids.append(post_id)
            continue

        processed += 1
        if result.wrote_document:
            exported += 1
        else:
            reverified += 1

    return BlogDocumentPromotionBatchResult(
        preflight=preflight,
        cursor=cursor,
        next_id=next_id,
        scanned=len(records),
        processed=processed,
        exported=exported,
        reverified=reverified,
        skipped_error=skipped_error,
        failed=failed,
        failed_post_ids=tuple(failed_post_ids),
        stale_marked=stale_marked,
    )
