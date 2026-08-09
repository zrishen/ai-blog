"""Filesystem-native workspace tree behavior."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, ValidationFailedError
from src.services.workspace import workspace_file_service
from src.services.workspace.blog.blog_body_service import get_post_body
from src.services.workspace.blog.blog_document_store import BlogDocument, write_blog_document
from src.services.workspace.blog.blog_service import create_post

TEST_USER_ID = 1


@pytest.mark.asyncio
async def test_folders_are_real_nested_workspace_directories(db_session: AsyncSession):
    drafts = await workspace_file_service.create_folder(
        db_session, TEST_USER_ID, name="Drafts", parent_path=None
    )
    research = await workspace_file_service.create_folder(
        db_session, TEST_USER_ID, name="Research", parent_path=drafts.path
    )

    entries = await workspace_file_service.list_entries(db_session, TEST_USER_ID)
    assert {(entry.path, entry.kind) for entry in entries} == {
        ("Drafts", "folder"),
        ("Drafts/Research", "folder"),
    }
    assert research.path == "Drafts/Research"


@pytest.mark.asyncio
async def test_moving_blog_document_updates_its_real_path(db_session: AsyncSession):
    post = await create_post(
        db_session,
        {"title": "A post", "slug": "a-post", "content": "File body"},
        TEST_USER_ID,
    )
    await workspace_file_service.create_folder(
        db_session, TEST_USER_ID, name="Writing", parent_path=None
    )

    moved = await workspace_file_service.move_entry(
        db_session,
        TEST_USER_ID,
        path="posts/a-post.md",
        target_path="Writing",
    )
    await db_session.refresh(post)

    assert moved.path == "Writing/a-post.md"
    assert moved.kind == "blog"
    assert post.file_path == "Writing/a-post.md"
    assert await get_post_body(post) == "File body"


@pytest.mark.asyncio
async def test_listing_workspace_lazily_reconciles_managed_blog_documents(db_session: AsyncSession):
    post = await create_post(
        db_session,
        {"title": "A post", "slug": "a-post", "content": "Initial body"},
        TEST_USER_ID,
    )
    write_blog_document(
        TEST_USER_ID,
        post.file_path,
        BlogDocument(
            slug=post.slug,
            title="Edited through the workspace",
            body="Filesystem body",
            created_at=post.created_at,
            status="draft",
            author=post.author or "ai-blog",
        ),
    )

    entries = await workspace_file_service.list_entries(db_session, TEST_USER_ID)
    await db_session.refresh(post)

    assert any(entry.path == post.file_path and entry.kind == "blog" for entry in entries)
    assert post.title == "Edited through the workspace"
    assert post.content == "Filesystem body"


@pytest.mark.asyncio
async def test_folder_delete_requires_empty_directory(db_session: AsyncSession):
    folder = await workspace_file_service.create_folder(
        db_session, TEST_USER_ID, name="Empty", parent_path=None
    )
    await workspace_file_service.create_folder(
        db_session, TEST_USER_ID, name="Nested", parent_path=folder.path
    )

    with pytest.raises(ConflictError):
        await workspace_file_service.delete_folder(db_session, TEST_USER_ID, path=folder.path)

    await workspace_file_service.delete_folder(db_session, TEST_USER_ID, path="Empty/Nested")
    await workspace_file_service.delete_folder(db_session, TEST_USER_ID, path=folder.path)
    assert await workspace_file_service.list_entries(db_session, TEST_USER_ID) == []


@pytest.mark.asyncio
async def test_workspace_paths_cannot_traverse_or_use_hidden_entries(db_session: AsyncSession):
    with pytest.raises(ValidationFailedError):
        await workspace_file_service.create_folder(
            db_session, TEST_USER_ID, name="../escape", parent_path=None
        )
    with pytest.raises(ValidationFailedError):
        await workspace_file_service.create_folder(
            db_session, TEST_USER_ID, name=".hidden", parent_path=None
        )
