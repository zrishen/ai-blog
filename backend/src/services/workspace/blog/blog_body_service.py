"""Verified working-copy body seam for blog consumers."""

from __future__ import annotations

import asyncio
from src.database.models import BlogPost
from src.services.workspace.blog.blog_document_store import read_blog_document


async def get_post_body(post: BlogPost) -> str:
    """Read the working-copy body from its canonical Markdown document."""

    document = await asyncio.to_thread(read_blog_document, post.user_id, post.slug)
    return document.body
