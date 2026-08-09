from types import SimpleNamespace

import pytest

from src.core.context import current_user_id_cv
from src.core.exceptions import NotFoundError, OwnershipError, ValidationFailedError
from src.tools import workspace_files


@pytest.fixture
def user_context():
    token = current_user_id_cv.set(1)
    try:
        yield
    finally:
        current_user_id_cv.reset(token)


@pytest.fixture(autouse=True)
def bypass_blog_reconcile(monkeypatch):
    async def no_op(*_args, **_kwargs):
        return None

    monkeypatch.setattr(workspace_files, "_sync_managed_blog_document", no_op)


@pytest.mark.asyncio
async def test_workspace_text_tools_round_trip_and_search(user_context):
    assert await workspace_files.workspace_write_file.ainvoke(
        {"path": "notes/plan.md", "content": "first\nneedle\nneedle\n"}
    ) == "Wrote notes/plan.md"

    assert await workspace_files.workspace_read_file.ainvoke(
        {"path": "notes/plan.md", "start_line": 2, "end_line": 2}
    ) == "notes/plan.md (lines 2-2):\nneedle"
    assert "found 2" in await workspace_files.workspace_edit_file.ainvoke(
        {"path": "notes/plan.md", "old_text": "needle", "new_text": "replaced"}
    )
    assert await workspace_files.workspace_edit_file.ainvoke(
        {"path": "notes/plan.md", "old_text": "needle\nneedle", "new_text": "matched"}
    ) == "Edited notes/plan.md"

    assert await workspace_files.workspace_glob.ainvoke({"pattern": "notes/**/*.md"}) == "notes/plan.md"
    assert await workspace_files.workspace_grep.ainvoke({"query": "matched"}) == "notes/plan.md:2: matched"


@pytest.mark.asyncio
async def test_workspace_tools_reject_unsafe_paths_and_other_users(user_context):
    await workspace_files.workspace_write_file.ainvoke({"path": "notes/private.txt", "content": "secret"})

    with pytest.raises(ValidationFailedError):
        await workspace_files.workspace_write_file.ainvoke({"path": "../escape.txt", "content": "no"})
    with pytest.raises(ValidationFailedError):
        await workspace_files.workspace_glob.ainvoke({"pattern": "notes//*.txt"})

    token = current_user_id_cv.set(2)
    try:
        with pytest.raises(NotFoundError):
            await workspace_files.workspace_read_file.ainvoke({"path": "notes/private.txt"})
    finally:
        current_user_id_cv.reset(token)


@pytest.mark.asyncio
async def test_workspace_tools_require_authenticated_user():
    token = current_user_id_cv.set(None)
    try:
        with pytest.raises(OwnershipError):
            await workspace_files.workspace_glob.ainvoke({})
    finally:
        current_user_id_cv.reset(token)


@pytest.mark.asyncio
async def test_workspace_move_delegates_to_path_service(monkeypatch, user_context):
    calls = []

    class Session:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *_args):
            return None

    async def fake_move(db, user_id, *, path, target_path):
        calls.append((db, user_id, path, target_path))
        return SimpleNamespace(path="archive/note.md")

    monkeypatch.setattr(workspace_files, "async_session", Session)
    monkeypatch.setattr(workspace_files, "move_entry", fake_move)

    assert await workspace_files.workspace_move_file.ainvoke(
        {"path": "notes/note.md", "target_folder": "archive"}
    ) == "Moved notes/note.md to archive/note.md"
    assert calls[0][1:] == (1, "notes/note.md", "archive")


@pytest.mark.asyncio
async def test_workspace_delete_removes_unmanaged_regular_file(monkeypatch, user_context):
    calls = []

    class Result:
        def scalar_one_or_none(self):
            return None

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, _statement):
            return Result()

        async def commit(self):
            return None

    monkeypatch.setattr(workspace_files, "async_session", Session)
    async def fake_move(db, *, user_id, relative_path):
        calls.append((db, user_id, relative_path))

    monkeypatch.setattr(workspace_files, "move_workspace_entry_to_trash", fake_move)
    await workspace_files.workspace_write_file.ainvoke({"path": "notes/delete.txt", "content": "temporary"})

    assert await workspace_files.workspace_delete_file.ainvoke({"path": "notes/delete.txt"}) == "Moved notes/delete.txt to the recycle bin"
    assert calls[0][1:] == (1, "notes/delete.txt")


@pytest.mark.asyncio
async def test_workspace_write_and_edit_notify_managed_blog_reconcile(monkeypatch, user_context):
    calls = []

    async def record_reconcile(user_id, relative_path):
        calls.append((user_id, relative_path))

    monkeypatch.setattr(workspace_files, "_sync_managed_blog_document", record_reconcile)
    await workspace_files.workspace_write_file.ainvoke({"path": "notes/reconcile.md", "content": "first"})
    await workspace_files.workspace_edit_file.ainvoke(
        {"path": "notes/reconcile.md", "old_text": "first", "new_text": "second"}
    )

    assert calls == [(1, "notes/reconcile.md"), (1, "notes/reconcile.md")]
