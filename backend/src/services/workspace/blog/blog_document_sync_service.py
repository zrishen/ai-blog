"""Canonical Markdown synchronization for blog working copies."""

from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost
from src.services.workspace.blog.blog_document_backfill_service import (
    backfill_blog_post_document,
)

def invalidate_verified_document(post: BlogPost) -> None:
    """Clear the derived document marker before the next canonical write."""

    post.content_storage_state = "legacy"
    post.content_sha256 = None
    post.file_migrated_at = None
    post.last_storage_error = None


async def sync_blog_document(db: AsyncSession, post: BlogPost) -> None:
    """Write and verify the canonical Markdown body for every working-copy change."""

    await backfill_blog_post_document(db, post_id=post.id, user_id=post.user_id)
