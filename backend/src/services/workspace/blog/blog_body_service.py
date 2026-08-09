"""Verified working-copy body seam for blog consumers."""

from __future__ import annotations

import asyncio
import hashlib
import logging

from src.config import settings
from src.database.models import BlogPost
from src.services.workspace.blog.blog_document_store import read_blog_document

logger = logging.getLogger(__name__)


def _canonical_file_path(post: BlogPost) -> str:
    return f"posts/{post.slug}.md"


async def get_post_body(post: BlogPost) -> str:
    """Return verified Markdown content, falling back safely to the DB copy."""

    if settings.blog_document_reader_policy == "db":
        return post.content
    if getattr(post, "content_storage_state", "legacy") != "verified":
        return post.content
    if post.file_path != _canonical_file_path(post):
        logger.warning("Verified blog document has a non-canonical path: post_id=%s", post.id)
        return post.content

    try:
        document = await asyncio.to_thread(read_blog_document, post.user_id, post.slug)
    except Exception:
        logger.warning("Verified blog document could not be read: post_id=%s", post.id, exc_info=True)
        return post.content

    digest = hashlib.sha256(document.body.encode("utf-8")).hexdigest()
    if post.content_sha256 != digest:
        logger.warning("Verified blog document SHA-256 mismatch: post_id=%s", post.id)
        return post.content
    return document.body
