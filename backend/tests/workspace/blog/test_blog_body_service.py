"""Tests for the verified working-copy body seam."""

from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

import pytest

from src.config import settings
from src.core import path_guard
from src.core.path_guard import workspace_dir
from src.database.models import BlogPost
from src.services.workspace.blog.blog_body_service import get_post_body
from src.services.workspace.blog.blog_document_store import BlogDocument, write_blog_document


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    monkeypatch.setattr(path_guard, "resolve_username", lambda user_id: f"user-{user_id}")
    return root


def _post(*, content: str = "legacy body") -> BlogPost:
    return BlogPost(
        id=7,
        user_id=1,
        title="Post",
        slug="post",
        content=content,
        created_at=datetime(2025, 2, 3, 4, 5, 6, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_get_post_body_returns_legacy_working_copy_until_verified() -> None:
    body = "First line\r\nSecond line\n"
    post = _post(content=body)

    assert await get_post_body(post) is body


@pytest.mark.asyncio
async def test_get_post_body_reads_strict_verified_markdown(workspace: Path) -> None:
    post = _post()
    document = BlogDocument(slug=post.slug, title=post.title, body="Markdown body", created_at=post.created_at)
    write_blog_document(post.user_id, document)
    post.content_storage_state = "verified"
    post.file_path = "posts/post.md"
    post.content_sha256 = sha256(document.body.encode("utf-8")).hexdigest()

    assert await get_post_body(post) == "Markdown body"


@pytest.mark.asyncio
async def test_get_post_body_reader_db_policy_forces_database_mirror(
    workspace: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    post = _post(content="Database mirror")
    document = BlogDocument(slug=post.slug, title=post.title, body="Markdown body", created_at=post.created_at)
    write_blog_document(post.user_id, document)
    post.content_storage_state = "verified"
    post.file_path = "posts/post.md"
    post.content_sha256 = sha256(document.body.encode("utf-8")).hexdigest()
    monkeypatch.setattr(settings, "blog_document_reader_policy", "db")

    assert await get_post_body(post) == "Database mirror"


@pytest.mark.asyncio
async def test_get_post_body_falls_back_for_bad_verified_marker(caplog: pytest.LogCaptureFixture) -> None:
    post = _post()
    post.content_storage_state = "verified"
    post.file_path = "posts/other.md"
    post.content_sha256 = "0" * 64

    assert await get_post_body(post) == "legacy body"
    assert "non-canonical path" in caplog.text


@pytest.mark.asyncio
async def test_get_post_body_falls_back_for_missing_corrupt_or_hash_mismatched_document(
    workspace: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    post = _post()
    post.content_storage_state = "verified"
    post.file_path = "posts/post.md"
    post.content_sha256 = "0" * 64

    assert await get_post_body(post) == "legacy body"
    assert "could not be read" in caplog.text

    posts_dir = workspace_dir(post.user_id, create=True) / "posts"
    posts_dir.mkdir()
    (posts_dir / "post.md").write_text("not canonical markdown", encoding="utf-8")
    caplog.clear()
    assert await get_post_body(post) == "legacy body"
    assert "could not be read" in caplog.text

    document = BlogDocument(slug=post.slug, title=post.title, body="Markdown body", created_at=post.created_at)
    write_blog_document(post.user_id, document)
    caplog.clear()
    assert await get_post_body(post) == "legacy body"
    assert "SHA-256 mismatch" in caplog.text
