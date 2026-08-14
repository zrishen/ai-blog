"""User-scoped filesystem tools for the real workspace, without shell access."""

from __future__ import annotations

import asyncio
import contextlib
import os
import uuid
from pathlib import Path, PurePosixPath

from langchain_core.tools import tool

from src.core.context import current_user_id_cv
from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.core.path_guard import require_user, workspace_dir, workspace_path
from src.core.workspace_lock import workspace_lock
from src.core.workspace_path import validate_workspace_relative_path
from src.database import session as session_module
from src.services.workspace.blog.blog_document_reconcile_service import reconcile_blog_document
from src.services.workspace.resource_resolver import ResourceKind, resolve_workspace_resource
from src.services.workspace.trash.workspace_trash_service import move_workspace_entry_to_trash
from src.services.workspace.workspace_file_service import move_entry
from src.services.workspace.workspace_git_service import (
    ensure_workspace_repository,
    get_workspace_git_diff,
    get_workspace_git_status,
    list_workspace_git_revisions,
    record_workspace_change,
    restore_workspace_file,
)

_MAX_PATH_LENGTH = 500
_MAX_TEXT_BYTES = 1_000_000
_MAX_RESULTS = 200
_MAX_GREP_LINE_LENGTH = 500


def _user_id() -> int:
    user_id = current_user_id_cv.get()
    assert user_id is not None
    return user_id


def _relative_path(value: str) -> str:
    return validate_workspace_relative_path(value, max_length=_MAX_PATH_LENGTH)


def _glob_pattern(value: str) -> str:
    """glob pattern 校验：允许 ``*?[]`` 通配符，只防 ``..`` 穿越 / 绝对路径 / 反斜杠 / 控制字符。"""
    if (
        not isinstance(value, str)
        or not value
        or len(value) > _MAX_PATH_LENGTH
        or "\\" in value
        or any(ord(ch) < 32 for ch in value)
    ):
        raise ValidationFailedError("Workspace glob pattern is invalid")
    path = PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix() or ".." in path.parts:
        raise ValidationFailedError("Workspace glob pattern is invalid")
    return value


def _read_text(user_id: int, relative_path: str) -> str:
    target = workspace_path(user_id, relative_path)
    if target.is_symlink() or not target.is_file():
        raise NotFoundError("Workspace file not found")
    try:
        payload = target.read_bytes()
    except OSError as exc:
        raise OwnershipError("Workspace file could not be read") from exc
    if len(payload) > _MAX_TEXT_BYTES:
        raise ValidationFailedError("Workspace file is too large for text tools")
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValidationFailedError("Workspace file is not UTF-8 text") from exc


def _prepare_write_target(user_id: int, relative_path: str) -> Path:
    workspace_dir(user_id, create=True)
    target = workspace_path(user_id, relative_path)
    if target.is_symlink() or target.is_dir():
        raise ConflictError("Workspace path is not a regular file")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise OwnershipError("Workspace parent directory could not be created") from exc
    target = workspace_path(user_id, relative_path, mode="write")
    if target.is_symlink() or target.is_dir():
        raise ConflictError("Workspace path is not a regular file")
    return target


def _atomic_write(target: Path, content: str) -> None:
    payload = content.encode("utf-8")
    if len(payload) > _MAX_TEXT_BYTES:
        raise ValidationFailedError("Workspace text is too large")
    temporary = target.parent / f".{target.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("xb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    except OSError as exc:
        raise OwnershipError("Workspace file could not be written") from exc
    finally:
        with contextlib.suppress(OSError):
            temporary.unlink(missing_ok=True)


def _write_text(user_id: int, relative_path: str, content: str) -> None:
    if not isinstance(content, str):
        raise ValidationFailedError("Workspace content must be text")
    _atomic_write(_prepare_write_target(user_id, relative_path), content)


async def _sync_managed_blog_document(user_id: int, relative_path: str) -> None:
    async with session_module.async_session() as db:
        await reconcile_blog_document(db, user_id=user_id, relative_path=relative_path)


async def _assert_not_managed_file_document(user_id: int, relative_path: str) -> None:
    """受管 FileDocument 必须经专用 API 更新/删除，禁止通用文件工具覆盖。"""

    async with session_module.async_session() as db:
        resolved = await resolve_workspace_resource(db, user_id=user_id, relative_path=relative_path)
    if resolved.kind is ResourceKind.FILE_DOCUMENT:
        raise ConflictError("Managed file document must be updated through its dedicated API")


def _iter_workspace_files(user_id: int, pattern: str):
    root = workspace_dir(user_id)
    if not root.is_dir():
        return
    resolved_root = root.resolve()
    for candidate in root.glob(pattern):
        if candidate.is_symlink() or not candidate.is_file():
            continue
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if not resolved.is_relative_to(resolved_root):
            continue
        relative = candidate.relative_to(root).as_posix()
        if any(part.startswith(".") for part in PurePosixPath(relative).parts):
            continue
        yield relative, candidate


@tool
@require_user
async def read(path: str, start_line: int = 1, end_line: int = 0) -> str:
    """Read a UTF-8 workspace text file. Lines are 1-based; end_line=0 reads to EOF."""

    relative_path = _relative_path(path)
    if start_line < 1 or end_line < 0 or (end_line and end_line < start_line):
        raise ValidationFailedError("Line range is invalid")
    text = await asyncio.to_thread(_read_text, _user_id(), relative_path)
    lines = text.splitlines()
    selected = lines[start_line - 1 : end_line or None]
    if not selected and start_line > len(lines):
        return f"{relative_path}: no lines in the requested range"
    last_line = start_line + len(selected) - 1
    return f"{relative_path} (lines {start_line}-{last_line}):\n" + "\n".join(selected)


@tool
@require_user
async def write(path: str, content: str) -> str:
    """Atomically replace or create a UTF-8 file inside the workspace."""

    relative_path = _relative_path(path)
    user_id = _user_id()
    async with workspace_lock(user_id):
        await _assert_not_managed_file_document(user_id, relative_path)
        await asyncio.to_thread(ensure_workspace_repository, user_id)
        await asyncio.to_thread(_write_text, user_id, relative_path, content)
        await _sync_managed_blog_document(user_id, relative_path)
        await asyncio.to_thread(record_workspace_change, user_id, f"Write {relative_path}")
    return f"Wrote {relative_path}"


@tool
@require_user
async def edit(path: str, old_text: str, new_text: str) -> str:
    """Replace one exact text occurrence in a workspace file; it fails unless the match is unique."""

    relative_path = _relative_path(path)
    if not old_text:
        raise ValidationFailedError("old_text must not be empty")
    user_id = _user_id()
    async with workspace_lock(user_id):
        await _assert_not_managed_file_document(user_id, relative_path)
        await asyncio.to_thread(ensure_workspace_repository, user_id)
        text = await asyncio.to_thread(_read_text, user_id, relative_path)
        count = text.count(old_text)
        if count != 1:
            return f"Edit not applied: expected one exact match in {relative_path}, found {count}"
        await asyncio.to_thread(_write_text, user_id, relative_path, text.replace(old_text, new_text, 1))
        await _sync_managed_blog_document(user_id, relative_path)
        await asyncio.to_thread(record_workspace_change, user_id, f"Edit {relative_path}")
    return f"Edited {relative_path}"


def _create_folder(user_id: int, relative_path: str) -> bool:
    workspace_dir(user_id, create=True)
    target = workspace_path(user_id, relative_path)
    if target.is_symlink() or target.is_file():
        raise ConflictError("Workspace path is not a directory")
    created = not target.exists()
    if not created:
        return False
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise OwnershipError("Workspace folder could not be created") from exc
    # mkdir 后重新经 write 模式校验：父目录此时已存在，确认落点仍在用户根内、无 symlink 逃逸
    resolved = workspace_path(user_id, relative_path, mode="write")
    if resolved.is_symlink() or not resolved.is_dir():
        raise OwnershipError("Workspace folder could not be created safely")
    return True


@tool
@require_user
async def create_folder(path: str) -> str:
    """Create a workspace folder (including parents). Idempotent: succeeds if it already exists."""

    relative_path = _relative_path(path)
    user_id = _user_id()
    async with workspace_lock(user_id):
        created = await asyncio.to_thread(_create_folder, user_id, relative_path)
    return f"{'Created' if created else 'Exists'} {relative_path}"


@tool
@require_user
async def glob(pattern: str = "**/*", limit: int = 100) -> str:
    """List workspace files matching a relative glob pattern such as notes/**/*.md."""

    pattern = _glob_pattern(pattern)
    limit = max(1, min(limit, _MAX_RESULTS))
    user_id = _user_id()
    matches = await asyncio.to_thread(
        lambda: sorted((relative for relative, _ in _iter_workspace_files(user_id, pattern)), key=str.casefold)[:limit]
    )
    return "\n".join(matches) if matches else "No files matched."


@tool
@require_user
async def grep(query: str, path_pattern: str = "**/*", limit: int = 50) -> str:
    """Find literal text in UTF-8 workspace files. This does not execute shell commands or regular expressions."""

    if not isinstance(query, str) or not query:
        raise ValidationFailedError("Search text must not be empty")
    if len(query) > 1_000:
        raise ValidationFailedError("Search text is too long")
    pattern = _glob_pattern(path_pattern)
    limit = max(1, min(limit, _MAX_RESULTS))
    user_id = _user_id()

    def search() -> list[str]:
        matches: list[str] = []
        for relative, _ in _iter_workspace_files(user_id, pattern):
            try:
                text = _read_text(user_id, relative)
            except (NotFoundError, OwnershipError, ValidationFailedError):
                continue
            for line_number, line in enumerate(text.splitlines(), start=1):
                if query not in line:
                    continue
                rendered = line if len(line) <= _MAX_GREP_LINE_LENGTH else f"{line[:_MAX_GREP_LINE_LENGTH]}…"
                matches.append(f"{relative}:{line_number}: {rendered}")
                if len(matches) >= limit:
                    return matches
        return matches

    matches = await asyncio.to_thread(search)
    return "\n".join(matches) if matches else "No matches found."


@tool
@require_user
async def move(path: str, target_folder: str = "") -> str:
    """Move a file or folder to another workspace folder and preserve managed blog paths."""

    relative_path = _relative_path(path)
    target_path = _relative_path(target_folder) if target_folder else None
    user_id = _user_id()
    async with workspace_lock(user_id):
        await asyncio.to_thread(ensure_workspace_repository, user_id)
        async with session_module.async_session() as db:
            entry = await move_entry(db, user_id, path=relative_path, target_path=target_path)
        await asyncio.to_thread(record_workspace_change, user_id, f"Move {relative_path} to {entry.path}")
    return f"Moved {relative_path} to {entry.path}"


@tool
@require_user
async def delete(path: str) -> str:
    """Delete a regular workspace file or an empty folder. Managed resources use their dedicated lifecycle."""

    relative_path = _relative_path(path)
    user_id = _user_id()
    async with workspace_lock(user_id):
        await asyncio.to_thread(ensure_workspace_repository, user_id)
        async with session_module.async_session() as db:
            resolved = await resolve_workspace_resource(db, user_id=user_id, relative_path=relative_path)
            if resolved.kind is ResourceKind.BLOG_POST:
                from src.services.workspace.blog.blog_service import delete_post

                assert resolved.resource_id is not None
                await delete_post(db, resolved.resource_id, user_id)
                message = f"Moved managed blog {relative_path} to the recycle bin"
                change = f"Delete managed blog {relative_path}"
            elif resolved.kind is ResourceKind.FILE_DOCUMENT:
                raise ConflictError("Managed file document must be deleted through its dedicated API")
            else:
                await move_workspace_entry_to_trash(db, user_id=user_id, relative_path=relative_path)
                await db.commit()
                message = f"Moved {relative_path} to the recycle bin"
                change = f"Delete {relative_path}"
        await asyncio.to_thread(record_workspace_change, user_id, change)
    return message


@tool
@require_user
async def git(
    action: str,
    path: str = "",
    revision: str = "",
    base_revision: str = "",
    target_revision: str = "",
    limit: int = 10,
) -> str:
    """Workspace git operations. action selects the subcommand:
    - "status": show branch, HEAD revision, and uncommitted paths.
    - "history": list recent revisions; limit default 10.
    - "diff": show diff between base_revision (default "HEAD~1") and target_revision (default "HEAD").
    - "restore": restore one regular file at path from revision (default "HEAD"), then commit.
    """

    user_id = _user_id()
    if action == "status":
        status = await asyncio.to_thread(get_workspace_git_status, user_id)
        changed = "\n".join(status.changed_paths) if status.changed_paths else "clean"
        return f"branch: {status.branch}\nHEAD: {status.head}\nchanges:\n{changed}"
    if action == "history":
        revisions = await asyncio.to_thread(list_workspace_git_revisions, user_id, limit=limit)
        return "\n".join(f"{item.revision} {item.committed_at} {item.subject}" for item in revisions)
    if action == "diff":
        return await asyncio.to_thread(
            get_workspace_git_diff,
            user_id,
            base_revision=base_revision or "HEAD~1",
            target_revision=target_revision or "HEAD",
        )
    if action == "restore":
        if not path:
            raise ValidationFailedError("git restore requires a path")
        relative_path = _relative_path(path)
        async with workspace_lock(user_id):
            await _assert_not_managed_file_document(user_id, relative_path)
            restored_path = await asyncio.to_thread(
                restore_workspace_file,
                user_id,
                relative_path=relative_path,
                revision=revision or "HEAD",
            )
            await _sync_managed_blog_document(user_id, restored_path)
            await asyncio.to_thread(
                record_workspace_change, user_id, f"Restore {restored_path} from {revision or 'HEAD'}"
            )
        return f"Restored {restored_path} from {revision or 'HEAD'}"
    raise ValidationFailedError("Unknown git action")
