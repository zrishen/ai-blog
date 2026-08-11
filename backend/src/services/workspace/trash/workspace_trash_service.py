"""Physical, user-scoped workspace trash operations."""

from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from pathlib import Path, PurePosixPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError, OwnershipError
from src.core.path_guard import workspace_dir, workspace_path
from src.core.workspace_path import validate_workspace_relative_path
from src.database.models import WorkspaceTrashEntry


def _relative_path(value: str) -> str:
    return validate_workspace_relative_path(value)


def _trash_path(user_id: int, relative_path: str, token: str) -> tuple[str, Path]:
    root = workspace_dir(user_id, create=True)
    trash_relative = f".trash/{token}/{relative_path}"
    target = root / PurePosixPath(trash_relative)
    resolved_root = root.resolve()
    if not target.parent.resolve().is_relative_to(resolved_root):
        raise OwnershipError("Workspace trash path is invalid")
    return trash_relative, target


def _stored_trash_path(entry: WorkspaceTrashEntry) -> Path:
    path = PurePosixPath(entry.trashed_path)
    if len(path.parts) < 3 or path.parts[0] != ".trash":
        raise OwnershipError("Workspace trash entry is invalid")
    validate_workspace_relative_path("/".join(path.parts[1:]))
    root = workspace_dir(entry.user_id)
    target = root / path
    if not target.parent.resolve().is_relative_to(root.resolve()):
        raise OwnershipError("Workspace trash entry is invalid")
    return target


def _remove_empty_trash_parents(path: Path, root: Path) -> None:
    stop = root / ".trash"
    current = path.parent
    while current != stop and current.is_relative_to(stop):
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


async def move_workspace_entry_to_trash(
    db: AsyncSession,
    *,
    user_id: int,
    relative_path: str,
    entry_type: str = "workspace_file",
    blog_post_id: int | None = None,
) -> WorkspaceTrashEntry:
    """Move one regular file or empty/non-empty folder into .trash without committing."""

    original_path = _relative_path(relative_path)
    source = workspace_path(user_id, original_path)
    if source.is_symlink() or not source.exists():
        raise NotFoundError("Workspace entry not found")
    token = uuid.uuid4().hex
    trashed_path, target = _trash_path(user_id, original_path, token)
    try:
        target.parent.mkdir(parents=True, exist_ok=False)
        await asyncio.to_thread(os.replace, source, target)
    except FileExistsError as exc:
        raise ConflictError("Workspace trash target already exists") from exc
    except OSError as exc:
        raise OwnershipError("Workspace entry could not be moved to trash") from exc

    entry = WorkspaceTrashEntry(
        user_id=user_id,
        entry_type=entry_type,
        blog_post_id=blog_post_id,
        original_path=original_path,
        trashed_path=trashed_path,
    )
    db.add(entry)
    await db.flush()
    return entry


async def get_blog_trash_entry(
    db: AsyncSession,
    *,
    user_id: int,
    blog_post_id: int,
) -> WorkspaceTrashEntry | None:
    return await db.scalar(
        select(WorkspaceTrashEntry).where(
            WorkspaceTrashEntry.user_id == user_id,
            WorkspaceTrashEntry.entry_type == "blog_post",
            WorkspaceTrashEntry.blog_post_id == blog_post_id,
        )
    )


async def get_workspace_trash_entry(
    db: AsyncSession,
    *,
    user_id: int,
    entry_id: int,
) -> WorkspaceTrashEntry:
    entry = await db.scalar(
        select(WorkspaceTrashEntry).where(
            WorkspaceTrashEntry.id == entry_id,
            WorkspaceTrashEntry.user_id == user_id,
            WorkspaceTrashEntry.entry_type == "workspace_file",
        )
    )
    if entry is None:
        raise NotFoundError("Workspace trash entry not found")
    return entry


async def list_workspace_trash_entries(db: AsyncSession, *, user_id: int) -> list[WorkspaceTrashEntry]:
    return list(
        (
            await db.execute(
                select(WorkspaceTrashEntry).where(
                    WorkspaceTrashEntry.user_id == user_id,
                    WorkspaceTrashEntry.entry_type == "workspace_file",
                )
            )
        ).scalars()
    )


async def restore_workspace_trash_entry(
    db: AsyncSession,
    *,
    entry: WorkspaceTrashEntry,
) -> None:
    target = workspace_path(entry.user_id, entry.original_path)
    if target.exists():
        raise ConflictError("Workspace restore target already exists")
    root = workspace_dir(entry.user_id, create=True)
    source = _stored_trash_path(entry)
    try:
        if source.is_symlink() or not source.exists():
            raise NotFoundError("Workspace trash file not found")
        target.parent.mkdir(parents=True, exist_ok=True)
        target = workspace_path(entry.user_id, entry.original_path, mode="write")
        await asyncio.to_thread(os.replace, source, target)
        await asyncio.to_thread(_remove_empty_trash_parents, source, root)
    except FileNotFoundError as exc:
        raise NotFoundError("Workspace trash file not found") from exc
    except OSError as exc:
        raise OwnershipError("Workspace trash entry could not be restored") from exc
    await db.delete(entry)


async def purge_workspace_trash_entry(db: AsyncSession, *, entry: WorkspaceTrashEntry) -> None:
    root = workspace_dir(entry.user_id, create=True)
    source = _stored_trash_path(entry)
    try:
        if source.is_dir():
            await asyncio.to_thread(shutil.rmtree, source)
        else:
            await asyncio.to_thread(source.unlink, missing_ok=True)
        await asyncio.to_thread(_remove_empty_trash_parents, source, root)
    except OSError as exc:
        raise OwnershipError("Workspace trash entry could not be purged") from exc
    await db.delete(entry)
