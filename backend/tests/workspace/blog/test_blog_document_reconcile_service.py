from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core.exceptions import ValidationFailedError
from src.database.models import BlogCategory, RagSource, User
from src.services.workspace.blog.blog_document_reconcile_service import reconcile_blog_document
from src.services.workspace.blog.blog_document_store import BlogDocument, write_blog_document
from src.services.workspace.blog.blog_service import create_post


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    return root


@pytest.mark.asyncio
async def test_reconcile_managed_document_updates_indexes_and_marks_rag_stale(
    db_session: AsyncSession,
    workspace: Path,
):
    user = User(id=51, username="owner-51", password_hash="hash")
    category = BlogCategory(user_id=user.id, name="Engineering", slug="engineering")
    db_session.add_all([user, category])
    await db_session.commit()
    post = await create_post(
        db_session,
        {"title": "Initial", "slug": "initial", "content": "Old body", "author": "Ada"},
        user.id,
    )
    db_session.add(
        RagSource(
            user_id=user.id,
            resource_type="blog_post",
            resource_id=post.id,
            index_status="active",
            collection_name="user_51_blog_test",
        )
    )
    await db_session.commit()

    write_blog_document(
        user.id,
        post.file_path,
        BlogDocument(
            slug=post.slug,
            title="Updated title",
            body="New canonical body",
            created_at=datetime(2025, 1, 2, 3, 4, 5),
            status="draft",
            category="engineering",
            excerpt="New excerpt",
            tags="python",
            author="Grace",
            cover="/cover.png",
        ),
    )

    result = await reconcile_blog_document(db_session, user_id=user.id, relative_path=post.file_path)
    await db_session.refresh(post)
    source = await db_session.get(RagSource, 1)

    assert result.managed and result.content_changed and result.metadata_changed
    assert post.content == "New canonical body"
    assert post.title == "Updated title"
    assert post.category_id == category.id
    assert post.blocks_json
    assert source is not None and source.index_status == "stale"
    assert workspace.joinpath("users", "51", post.file_path).is_file()


@pytest.mark.asyncio
async def test_reconcile_skips_unmanaged_workspace_file(db_session: AsyncSession):
    result = await reconcile_blog_document(db_session, user_id=1, relative_path="notes/freeform.md")

    assert not result.managed


@pytest.mark.asyncio
async def test_reconcile_rejects_direct_publish_transition(
    db_session: AsyncSession,
    workspace: Path,
):
    post = await create_post(
        db_session,
        {"title": "Draft", "slug": "draft", "content": "Body"},
        1,
    )
    write_blog_document(
        1,
        post.file_path,
        BlogDocument(
            slug=post.slug,
            title=post.title,
            body="Body",
            created_at=post.created_at,
            status="published",
            author=post.author or "ai-blog",
        ),
    )

    with pytest.raises(ValidationFailedError, match="blog workflow"):
        await reconcile_blog_document(db_session, user_id=1, relative_path=post.file_path)
