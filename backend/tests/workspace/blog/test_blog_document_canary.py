"""Canary export stays opt-in while DB remains the working-copy source."""

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core import path_guard
from src.database.models import BlogPost, User
from src.services.workspace.blog.blog_document_store import read_blog_document
from src.services.workspace.blog.blog_service import create_post, update_post


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    monkeypatch.setattr(path_guard, "resolve_username", lambda user_id: f"owner-{user_id}")
    return root


async def _create_owner(db: AsyncSession, user_id: int = 61) -> User:
    owner = User(id=user_id, username=f"canary-owner-{user_id}", password_hash="hash")
    db.add(owner)
    await db.commit()
    return owner


@pytest.mark.asyncio
async def test_document_canary_is_default_off(
    db_session: AsyncSession,
    workspace: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "blog_document_canary_user_ids", "")
    owner = await _create_owner(db_session)

    post = await create_post(db_session, {"title": "Default off", "content": "DB body"}, owner.id)

    assert post.content == "DB body"
    assert post.content_storage_state == "legacy"
    assert post.file_path is None
    assert not (workspace / f"owner-{owner.id}" / "posts" / f"{post.slug}.md").exists()


@pytest.mark.asyncio
async def test_canary_export_verifies_final_copy_and_later_write_invalidates_it(
    db_session: AsyncSession,
    workspace: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    owner = await _create_owner(db_session)
    monkeypatch.setattr(settings, "blog_document_canary_user_ids", str(owner.id))

    post = await create_post(
        db_session,
        {"title": "Canary post", "content": "First body", "status": "published"},
        owner.id,
    )

    assert post.content_storage_state == "verified"
    assert post.file_path == f"posts/{post.slug}.md"
    assert read_blog_document(owner.id, post.slug).body == "First body"
    assert (workspace / f"owner-{owner.id}" / "posts" / f"{post.slug}.md").exists()

    monkeypatch.setattr(settings, "blog_document_canary_user_ids", "")
    updated = await update_post(db_session, post.id, {"content": "Second body"}, owner.id)
    assert updated is not None
    assert updated.content == "Second body"
    assert updated.content_storage_state == "legacy"
    assert updated.file_path is None
    assert updated.content_sha256 is None
    assert updated.file_migrated_at is None
    assert updated.last_storage_error is None
    assert read_blog_document(owner.id, post.slug).body == "First body"

    reread = await db_session.get(BlogPost, post.id)
    assert reread is not None
    assert reread.content == "Second body"
