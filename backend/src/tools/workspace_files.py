"""User-scoped filesystem tools for the real workspace, without shell access."""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path, PurePosixPath

from langchain_core.tools import tool
from sqlalchemy import select

from src.core.context import current_user_id_cv
from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.core.path_guard import require_user, workspace_dir, workspace_path
from src.database.models import BlogPost
from src.database.session import async_session
from src.services.workspace.workspace_file_service import move_entry

_MAX_PATH_LENGTH = 500
_MAX_TEXT_BYTES = 1_000_000
_MAX_RESULTS = 200
_MAX_GREP_LINE_LENGTH = 500


def _user_id() -> int:
    user_id = current_user_id_cv.get()
    assert user_id is not None
    return user_id


def _relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > _MAX_PATH_LENGTH or "\\" in value:
        raise ValidationFailedError("Workspace path is invalid")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or value != path.as_posix()
        or any(part in {"", ".", ".."} or part.startswith(".") for part in path.parts)
    ):
        raise ValidationFailedError("Workspace path is invalid")
    return path.as_posix()


def _glob_pattern(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > _MAX_PATH_LENGTH or "\\" in value:
        raise ValidationFailedError("Workspace glob is invalid")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or value != path.as_posix()
        or any(part in {"", ".", ".."} or part.startswith(".") for part in path.parts)
    ):
        raise ValidationFailedError("Workspace glob is invalid")
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
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _write_text(user_id: int, relative_path: str, content: str) -> None:
    if not isinstance(content, str):
        raise ValidationFailedError("Workspace content must be text")
    _atomic_write(_prepare_write_target(user_id, relative_path), content)


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
async def workspace_read_file(path: str, start_line: int = 1, end_line: int = 0) -> str:
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
async def workspace_write_file(path: str, content: str) -> str:
    """Atomically replace or create a UTF-8 file inside the workspace."""

    relative_path = _relative_path(path)
    await asyncio.to_thread(_write_text, _user_id(), relative_path, content)
    return f"Wrote {relative_path}"


@tool
@require_user
async def workspace_edit_file(path: str, old_text: str, new_text: str) -> str:
    """Replace one exact text occurrence in a workspace file; it fails unless the match is unique."""

    relative_path = _relative_path(path)
    if not old_text:
        raise ValidationFailedError("old_text must not be empty")
    user_id = _user_id()
    text = await asyncio.to_thread(_read_text, user_id, relative_path)
    count = text.count(old_text)
    if count != 1:
        return f"Edit not applied: expected one exact match in {relative_path}, found {count}"
    await asyncio.to_thread(_write_text, user_id, relative_path, text.replace(old_text, new_text, 1))
    return f"Edited {relative_path}"


@tool
@require_user
async def workspace_glob(pattern: str = "**/*", limit: int = 100) -> str:
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
async def workspace_grep(query: str, path_pattern: str = "**/*", limit: int = 50) -> str:
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
async def workspace_move_file(path: str, target_folder: str = "") -> str:
    """Move a file or folder to another workspace folder and preserve managed blog paths."""

    relative_path = _relative_path(path)
    target_path = _relative_path(target_folder) if target_folder else None
    async with async_session() as db:
        entry = await move_entry(db, _user_id(), path=relative_path, target_path=target_path)
    return f"Moved {relative_path} to {entry.path}"


@tool
@require_user
async def workspace_delete_file(path: str) -> str:
    """Delete a regular workspace file or an empty folder. Managed blog files use the existing recycle-bin lifecycle."""

    relative_path = _relative_path(path)
    user_id = _user_id()
    async with async_session() as db:
        post = (
            await db.execute(
                select(BlogPost).where(
                    BlogPost.user_id == user_id,
                    BlogPost.deleted_at.is_(None),
                    BlogPost.file_path == relative_path,
                )
            )
        ).scalar_one_or_none()
        if post is not None:
            from src.services.workspace.blog.blog_service import delete_post

            await delete_post(db, post.id, user_id)
            return f"Moved managed blog {relative_path} to the recycle bin"

    def delete_regular() -> None:
        target = workspace_path(user_id, relative_path)
        if target.is_symlink() or not target.exists():
            raise NotFoundError("Workspace entry not found")
        try:
            if target.is_dir():
                target.rmdir()
            elif target.is_file():
                target.unlink()
            else:
                raise NotFoundError("Workspace entry not found")
        except OSError as exc:
            raise ConflictError("Workspace folder must be empty before deletion") from exc

    await asyncio.to_thread(delete_regular)
    return f"Deleted {relative_path}"
