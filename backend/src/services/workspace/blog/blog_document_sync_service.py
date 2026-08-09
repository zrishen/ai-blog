"""Default-off verified-document canary for blog working copies."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost
from src.services.workspace.blog.blog_document_backfill_service import (
    backfill_blog_post_document,
)

logger = logging.getLogger(__name__)


def canary_enabled_for_user(user_id: int) -> bool:
    """Return whether this user is explicitly enrolled in document export."""

    configured = settings.blog_document_canary_user_ids.strip()
    if not configured:
        return False
    try:
        return user_id in {int(value.strip()) for value in configured.split(",") if value.strip()}
    except ValueError:
        logger.error("Ignoring invalid BLOG_DOCUMENT_CANARY_USER_IDS configuration")
        return False


def invalidate_verified_document(post: BlogPost) -> None:
    """Make DB content the sole readable copy until a new export verifies it."""

    post.content_storage_state = "legacy"
    post.file_path = None
    post.content_sha256 = None
    post.file_migrated_at = None
    post.last_storage_error = None


async def sync_document_if_canary(db: AsyncSession, post: BlogPost) -> None:
    """Best-effort post-commit export; author writes remain successful on FS errors."""

    if not canary_enabled_for_user(post.user_id):
        return
    try:
        await backfill_blog_post_document(db, post_id=post.id, user_id=post.user_id)
    except Exception:
        logger.warning(
            "Verified blog-document sync failed after DB working-copy commit: post_id=%s",
            post.id,
            exc_info=True,
        )
