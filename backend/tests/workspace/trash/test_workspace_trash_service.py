"""Physical workspace trash lifecycle tests."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.path_guard import workspace_dir
from src.services.workspace.blog.blog_body_service import get_post_body
from src.services.workspace.blog.blog_service import create_post, delete_post
from src.services.workspace.trash.trash_service import list_trash, purge_item, restore_item
from src.services.workspace.trash.workspace_trash_service import (
    get_blog_trash_entry,
    move_workspace_entry_to_trash,
)


@pytest.mark.asyncio
async def test_workspace_file_moves_to_trash_then_restores_and_purges(db_session: AsyncSession):
    root = workspace_dir(1, create=True)
    original = root / "notes" / "draft.txt"
    original.parent.mkdir(parents=True)
    original.write_text("recover me", encoding="utf-8")

    entry = await move_workspace_entry_to_trash(
        db_session,
        user_id=1,
        relative_path="notes/draft.txt",
    )
    await db_session.commit()

    assert not original.exists()
    assert (root / entry.trashed_path).read_text(encoding="utf-8") == "recover me"
    assert any(item.type == "workspace_file" and item.id == entry.id for item in await list_trash(db_session, user_id=1))

    await restore_item(db_session, item_type="workspace_file", item_id=entry.id, user_id=1)
    assert original.read_text(encoding="utf-8") == "recover me"

    entry = await move_workspace_entry_to_trash(
        db_session,
        user_id=1,
        relative_path="notes/draft.txt",
    )
    await db_session.commit()
    await purge_item(db_session, item_type="workspace_file", item_id=entry.id, user_id=1)

    assert not (root / entry.trashed_path).exists()


@pytest.mark.asyncio
async def test_blog_delete_moves_markdown_and_restore_returns_it(db_session: AsyncSession):
    post = await create_post(
        db_session,
        {"title": "Recoverable blog", "slug": "recoverable-blog", "content": "Canonical body"},
        1,
    )
    root = workspace_dir(1)
    original = root / post.file_path

    assert original.is_file()
    await delete_post(db_session, post.id, 1)
    entry = await get_blog_trash_entry(db_session, user_id=1, blog_post_id=post.id)

    assert entry is not None
    assert not original.exists()
    assert (root / entry.trashed_path).is_file()

    await restore_item(db_session, item_type="blog_post", item_id=post.id, user_id=1)
    await db_session.refresh(post)

    assert post.deleted_at is None
    assert original.is_file()
    assert await get_post_body(post) == "Canonical body"
