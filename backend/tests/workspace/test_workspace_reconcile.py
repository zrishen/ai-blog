"""崩溃一致性兜底 reconcile：trash 孤儿重建 + DB 指向缺失文件标记。"""

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core.path_guard import workspace_path
from src.database.models import User
from src.services.workspace.blog.blog_service import create_post
from src.services.workspace.trash.workspace_trash_service import (
    list_workspace_trash_entries,
    move_workspace_entry_to_trash,
)
from src.services.workspace.workspace_file_service import create_folder
from src.services.workspace.workspace_reconcile_service import (
    BLOG_MISSING_STATE,
    reconcile_all_workspaces,
    reconcile_user_workspace,
)

TEST_USER_ID = 1


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    return root


async def _make_user(db_session: AsyncSession, user_id: int, username: str) -> User:
    user = User(id=user_id, username=username, password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.mark.asyncio
async def test_trash_orphan_gets_reconstructed_into_visible_entry(
    db_session: AsyncSession, workspace: Path
):
    user = await _make_user(db_session, TEST_USER_ID, "owner")
    uid = user.id
    await create_folder(db_session, uid, name="notes", parent_path=None)
    target = workspace_path(uid, "notes/freeform.md", mode="write")
    target.write_text("body", encoding="utf-8")
    await db_session.commit()

    # 回收文件但回滚 DB → 模拟 commit 前崩溃，留下无 entry 的 .trash 孤儿。
    await move_workspace_entry_to_trash(
        db_session, user_id=uid, relative_path="notes/freeform.md"
    )
    await db_session.flush()
    await db_session.rollback()

    trash_files = list((workspace / "users" / str(uid) / ".trash").rglob("*"))
    assert any(p.is_file() for p in trash_files)
    assert await list_workspace_trash_entries(db_session, user_id=uid) == []

    report = await reconcile_user_workspace(db_session, uid)
    await db_session.commit()

    assert report.recovered_trash_orphans == 1
    entries = await list_workspace_trash_entries(db_session, user_id=uid)
    assert len(entries) == 1
    entry = entries[0]
    assert entry.original_path == "notes/freeform.md"
    assert entry.entry_type == "workspace_file"
    assert entry.trashed_path.startswith(".trash/")
    assert entry.deleted_at is not None


@pytest.mark.asyncio
async def test_tracked_trash_entry_is_not_touched_by_reconcile(
    db_session: AsyncSession, workspace: Path
):
    user = await _make_user(db_session, TEST_USER_ID, "owner")
    await create_folder(db_session, user.id, name="notes", parent_path=None)
    target = workspace_path(user.id, "notes/keep.md", mode="write")
    target.write_text("body", encoding="utf-8")
    await db_session.commit()
    await move_workspace_entry_to_trash(
        db_session, user_id=user.id, relative_path="notes/keep.md"
    )
    await db_session.commit()

    report = await reconcile_user_workspace(db_session, user.id)

    assert report.recovered_trash_orphans == 0


@pytest.mark.asyncio
async def test_missing_blog_post_file_is_flagged(
    db_session: AsyncSession, workspace: Path
):
    user = await _make_user(db_session, TEST_USER_ID, "author")
    post = await create_post(
        db_session, {"title": "P", "slug": "p", "content": "body"}, user.id
    )
    await db_session.commit()

    physical = workspace_path(user.id, post.file_path, mode="read")
    assert physical.exists()
    physical.unlink()

    report = await reconcile_user_workspace(db_session, user.id)
    await db_session.commit()
    await db_session.refresh(post)

    assert report.flagged_missing_blog_posts == 1
    assert post.content_storage_state == BLOG_MISSING_STATE
    assert post.last_storage_error


@pytest.mark.asyncio
async def test_present_blog_post_file_is_not_flagged(
    db_session: AsyncSession, workspace: Path
):
    user = await _make_user(db_session, TEST_USER_ID, "author")
    await create_post(db_session, {"title": "P", "slug": "p", "content": "body"}, user.id)
    await db_session.commit()

    report = await reconcile_user_workspace(db_session, user.id)

    assert report.flagged_missing_blog_posts == 0


@pytest.mark.asyncio
async def test_reconcile_all_isolates_per_user_failure(
    db_session: AsyncSession, workspace: Path, monkeypatch: pytest.MonkeyPatch
):
    user_a = await _make_user(db_session, 201, "owner-201")
    user_b = await _make_user(db_session, 202, "owner-202")
    await create_post(db_session, {"title": "A", "slug": "a", "content": "x"}, user_a.id)
    await create_post(db_session, {"title": "B", "slug": "b", "content": "x"}, user_b.id)
    await db_session.commit()

    from src.services.workspace import workspace_reconcile_service as svc

    original = svc.reconcile_user_workspace

    async def boom(db: AsyncSession, user_id: int):
        if user_id == user_a.id:
            raise RuntimeError("simulated crash")
        return await original(db, user_id)

    monkeypatch.setattr(svc, "reconcile_user_workspace", boom)

    results = await reconcile_all_workspaces()

    assert user_b.id in results
    assert user_a.id not in results
