"""Tests for the file-authoritative blog working-body seam."""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from src.config import settings
from src.database.models import BlogPost
from src.services.workspace.blog.blog_body_service import get_post_body
from src.services.workspace.blog.blog_document_store import (
    BlogDocument,
    BlogDocumentCorruptError,
    BlogDocumentNotFoundError,
    blog_document_path,
    write_blog_document,
)


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    return root


def _post(*, content: str = "database mirror") -> BlogPost:
    return BlogPost(
        id=7,
        user_id=1,
        title="Post",
        slug="post",
        content=content,
        created_at=datetime(2025, 2, 3, 4, 5, 6, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_get_post_body_reads_canonical_markdown_not_database_mirror(workspace: Path) -> None:
    post = _post(content="Database mirror")
    write_blog_document(
        post.user_id,
        BlogDocument(slug=post.slug, title=post.title, body="Markdown authority", created_at=post.created_at),
    )

    assert await get_post_body(post) == "Markdown authority"


@pytest.mark.asyncio
async def test_get_post_body_rejects_missing_or_corrupt_canonical_document(workspace: Path) -> None:
    post = _post()

    with pytest.raises(BlogDocumentNotFoundError):
        await get_post_body(post)

    path = blog_document_path(post.user_id, post.slug)
    path.parent.mkdir(parents=True)
    path.write_text("not canonical markdown", encoding="utf-8")
    with pytest.raises(BlogDocumentCorruptError):
        await get_post_body(post)
