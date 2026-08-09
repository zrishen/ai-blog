"""Tests for the explicit BlogPost-to-workspace backfill preparation step."""

from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core import path_guard
from src.database.models import BlogCategory, BlogPost, User
from src.services.workspace.blog import blog_document_backfill_service
from src.services.workspace.blog.blog_document_backfill_service import (
    BlogDocumentBackfillError,
    backfill_blog_post_document,
)
from src.services.workspace.blog.blog_document_store import blog_document_path, read_blog_document


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    monkeypatch.setattr(path_guard, "resolve_username", lambda user_id: f"owner-{user_id}")
    return root


async def _post_with_category(
    db: AsyncSession,
    *,
    slug: str,
    category_slug: str = "engineering",
    user_id: int = 41,
) -> BlogPost:
    user = User(id=user_id, username=f"backfill-owner-{user_id}", password_hash="hash")
    category = BlogCategory(user_id=user.id, name="Engineering", slug=category_slug)
    post = BlogPost(
        user_id=user.id,
        title="Backfill title",
        slug=slug,
        content="Legacy working body",
        excerpt="A summary",
        cover_image="/api/v1/blog/cover/cover.webp",
        status="published",
        tags="python, migration",
        author="Ada",
        category_id=None,
        created_at=datetime(2025, 2, 3, 4, 5, 6, 123456),
    )
    db.add_all([user, category, post])
    await db.flush()
    post.category_id = category.id
    await db.commit()
    await db.refresh(post)
    return post


@pytest.mark.asyncio
async def test_backfill_exports_all_document_metadata_and_verifies_hash(
    db_session: AsyncSession,
    workspace: Path,
):
    post = await _post_with_category(db_session, slug="mapped-post")

    result = await backfill_blog_post_document(db_session, post_id=post.id, user_id=post.user_id)

    path = workspace / "owner-41" / "posts" / "mapped-post.md"
    document = read_blog_document(post.user_id, post.slug)
    assert result.wrote_document
    assert path.exists()
    assert result.file_path == "posts/mapped-post.md"
    assert result.content_sha256 == sha256(post.content.encode("utf-8")).hexdigest()
    assert document.document_type == "blog"
    assert document.status == "published"
    assert document.category == "engineering"
    assert document.cover == "/api/v1/blog/cover/cover.webp"
    assert document.created_at.isoformat() == "2025-02-03T04:05:06.123456+00:00"
    assert document.body == "Legacy working body"
    assert post.content == "Legacy working body"
    assert post.file_path == "posts/mapped-post.md"
    assert post.content_storage_state == "verified"
    assert post.content_sha256 == result.content_sha256
    assert post.file_migrated_at is not None
    assert post.last_storage_error is None


@pytest.mark.asyncio
async def test_verified_consistent_post_is_not_rewritten(
    db_session: AsyncSession,
    workspace: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    post = await _post_with_category(db_session, slug="idempotent-post")
    first = await backfill_blog_post_document(db_session, post_id=post.id, user_id=post.user_id)
    migrated_at = post.file_migrated_at

    def must_not_write(*_args, **_kwargs):
        raise AssertionError("consistent verified post must not be rewritten")

    monkeypatch.setattr(blog_document_backfill_service, "write_blog_document", must_not_write)
    second = await backfill_blog_post_document(db_session, post_id=post.id, user_id=post.user_id)

    assert workspace.joinpath("owner-41", "posts", "idempotent-post.md").exists()
    assert first.content_sha256 == second.content_sha256
    assert not second.wrote_document
    assert post.file_migrated_at == migrated_at


@pytest.mark.asyncio
@pytest.mark.parametrize("damage", ["missing", "corrupt", "hash-mismatch"])
async def test_verified_file_damage_is_marked_error_without_changing_content(
    db_session: AsyncSession,
    workspace: Path,
    damage: str,
):
    post = await _post_with_category(db_session, slug=f"{damage}-post")
    await backfill_blog_post_document(db_session, post_id=post.id, user_id=post.user_id)
    path = blog_document_path(post.user_id, post.slug)
    original_content = post.content
    if damage == "missing":
        path.unlink()
    elif damage == "corrupt":
        path.write_text("not canonical markdown", encoding="utf-8")
    else:
        post.content_sha256 = "0" * 64
        await db_session.commit()

    with pytest.raises(BlogDocumentBackfillError):
        await backfill_blog_post_document(db_session, post_id=post.id, user_id=post.user_id)

    assert workspace.joinpath("owner-41", "posts", f"{damage}-post.md") == path
    assert post.content == original_content
    assert post.content_storage_state == "error"
    assert post.last_storage_error


@pytest.mark.asyncio
async def test_backfill_failure_is_recorded_and_does_not_block_another_post(
    db_session: AsyncSession,
    workspace: Path,
):
    broken = await _post_with_category(db_session, slug="broken-category", category_slug="Not-a-slug")

    with pytest.raises(BlogDocumentBackfillError):
        await backfill_blog_post_document(db_session, post_id=broken.id, user_id=broken.user_id)

    assert broken.content == "Legacy working body"
    assert broken.content_storage_state == "error"
    assert broken.last_storage_error

    healthy = await _post_with_category(db_session, slug="healthy-post", user_id=42)
    result = await backfill_blog_post_document(db_session, post_id=healthy.id, user_id=healthy.user_id)

    assert result.wrote_document
    assert healthy.content_storage_state == "verified"
    assert workspace.joinpath("owner-42", "posts", "healthy-post.md").exists()
