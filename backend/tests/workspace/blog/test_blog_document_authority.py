"""Working-copy writes always produce canonical Markdown documents."""

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import User
from src.services.workspace.blog.blog_document_store import read_blog_document
from src.services.workspace.blog.blog_service import create_post, publish_post, update_post


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    return root


async def _create_owner(db: AsyncSession, user_id: int = 61) -> User:
    owner = User(id=user_id, username=f"owner-{user_id}", password_hash="hash")
    db.add(owner)
    await db.commit()
    return owner


@pytest.mark.asyncio
async def test_create_and_edit_keep_markdown_as_the_working_copy(
    db_session: AsyncSession,
    workspace: Path,
):
    owner = await _create_owner(db_session)
    post = await create_post(db_session, {"title": "File first", "content": "First body"}, owner.id)

    assert post.content_storage_state == "verified"
    assert post.file_path == f"posts/{post.slug}.md"
    assert read_blog_document(owner.id, post.slug).body == "First body"

    updated = await update_post(db_session, post.id, {"content": "Second body", "tags": "files"}, owner.id)

    assert updated is not None
    document = read_blog_document(owner.id, post.slug)
    assert document.body == "Second body"
    assert document.tags == "files"
    assert (workspace / "users" / str(owner.id) / "posts" / f"{post.slug}.md").exists()


@pytest.mark.asyncio
async def test_publish_and_unpublish_refresh_document_frontmatter(
    db_session: AsyncSession,
):
    owner = await _create_owner(db_session)
    post = await create_post(db_session, {"title": "Status", "content": "Body"}, owner.id)

    published = await publish_post(db_session, post.id, True, owner.id)
    assert published is not None
    assert read_blog_document(owner.id, post.slug).status == "published"

    draft = await publish_post(db_session, post.id, False, owner.id)
    assert draft is not None
    assert read_blog_document(owner.id, post.slug).status == "draft"
