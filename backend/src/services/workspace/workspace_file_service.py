"""Filesystem-native workspace tree for user-owned content."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.core.path_guard import workspace_dir, workspace_path
from src.database.models import BlogPost
from src.services.workspace.blog.blog_document_store import validate_blog_document_path
from src.services.workspace.blog.blog_document_reconcile_service import reconcile_blog_document

_MAX_SEGMENT_LENGTH = 300
_MAX_PATH_LENGTH = 500
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkspaceEntry:
    path: str
    name: str
    kind: str
    resource_type: str | None = None
    resource_id: int | None = None
    blog_status: str | None = None


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


def _name(value: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > _MAX_SEGMENT_LENGTH
        or value.strip() != value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or value.startswith(".")
    ):
        raise ValidationFailedError("Workspace entry name is invalid")
    return value


def _join(parent_path: str | None, name: str) -> str:
    return f"{_relative_path(parent_path)}/{_name(name)}" if parent_path else _name(name)


def _entry_path(user_id: int, relative_path: str, *, mode: str = "read") -> Path:
    relative_path = _relative_path(relative_path)
    return workspace_path(user_id, relative_path, mode=mode)  # type: ignore[arg-type]


def _directory(user_id: int, relative_path: str | None, *, create_root: bool = False) -> Path:
    if relative_path is None:
        root = workspace_dir(user_id, create=create_root)
        if not root.exists():
            raise NotFoundError("Workspace directory not found")
        return root
    path = _entry_path(user_id, relative_path)
    if path.is_symlink() or not path.is_dir():
        raise NotFoundError("Workspace directory not found")
    return path


async def list_entries(db: AsyncSession, user_id: int) -> list[WorkspaceEntry]:
    """List the actual, non-hidden workspace tree with attached blog metadata."""

    root = workspace_dir(user_id, create=True)
    posts = list(
        (
            await db.execute(
                select(BlogPost).where(
                    BlogPost.user_id == user_id,
                    BlogPost.deleted_at.is_(None),
                    BlogPost.file_path.is_not(None),
                )
            )
        ).scalars()
    )
    for post in posts:
        if post.file_path is None:
            continue
        try:
            path = _entry_path(user_id, post.file_path)
            if path.is_symlink() or not path.is_file():
                continue
            await reconcile_blog_document(db, user_id=user_id, relative_path=post.file_path)
        except Exception:
            logger.warning("Unable to reconcile workspace blog document: post_id=%s", post.id, exc_info=True)
    blogs = {post.file_path: post for post in posts if post.file_path}
    entries: list[WorkspaceEntry] = []
    for current_root, directories, filenames in os.walk(root, followlinks=False):
        current = Path(current_root)
        directories[:] = sorted(
            (name for name in directories if not name.startswith(".")), key=str.casefold
        )
        for name in directories:
            path = current / name
            relative = path.relative_to(root).as_posix()
            entries.append(WorkspaceEntry(path=relative, name=name, kind="folder"))
        for name in sorted((name for name in filenames if not name.startswith(".")), key=str.casefold):
            path = current / name
            if path.is_symlink() or not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            post = blogs.get(relative)
            entries.append(
                WorkspaceEntry(
                    path=relative,
                    name=name,
                    kind="blog" if post else "file",
                    resource_type="blog_post" if post else None,
                    resource_id=post.id if post else None,
                    blog_status=post.status if post else None,
                )
            )
    return sorted(entries, key=lambda entry: (entry.path.casefold(), entry.kind != "folder"))


async def create_folder(
    db: AsyncSession,
    user_id: int,
    *,
    name: str,
    parent_path: str | None,
) -> WorkspaceEntry:
    del db
    target_relative = _join(parent_path, name)
    parent = _directory(user_id, parent_path, create_root=True)
    target = _entry_path(user_id, target_relative, mode="write")
    if target.exists():
        raise ConflictError("Workspace entry already exists")
    try:
        target.mkdir()
    except OSError as exc:
        raise OwnershipError("Workspace folder could not be created") from exc
    if target.parent != parent or target.is_symlink() or not target.is_dir():
        raise OwnershipError("Workspace folder could not be created safely")
    return WorkspaceEntry(path=target_relative, name=target.name, kind="folder")


async def rename_entry(
    db: AsyncSession,
    user_id: int,
    *,
    path: str,
    name: str,
) -> WorkspaceEntry:
    source_relative = _relative_path(path)
    source = _entry_path(user_id, source_relative)
    if source.is_symlink() or not source.exists():
        raise NotFoundError("Workspace entry not found")
    return await move_entry(
        db,
        user_id,
        path=source_relative,
        target_path=PurePosixPath(source_relative).parent.as_posix() if "/" in source_relative else None,
        name=name,
    )


async def move_entry(
    db: AsyncSession,
    user_id: int,
    *,
    path: str,
    target_path: str | None,
    name: str | None = None,
) -> WorkspaceEntry:
    source_relative = _relative_path(path)
    source = _entry_path(user_id, source_relative)
    if source.is_symlink() or not source.exists():
        raise NotFoundError("Workspace entry not found")
    destination_name = _name(name or source.name)
    destination_relative = _join(target_path, destination_name)
    if source_relative == destination_relative:
        raise ValidationFailedError("Workspace entry already has that path")
    if source.is_dir() and destination_relative.startswith(f"{source_relative}/"):
        raise ValidationFailedError("Workspace folder cannot be moved into itself")

    _directory(user_id, target_path)
    destination = _entry_path(user_id, destination_relative, mode="write")
    if destination.exists():
        raise ConflictError("Workspace entry already exists")
    if source.is_file() and source.suffix.lower() == ".md":
        validate_blog_document_path(destination_relative)

    posts = list(
        (
            await db.execute(
                select(BlogPost).where(
                    BlogPost.user_id == user_id,
                    BlogPost.deleted_at.is_(None),
                    (BlogPost.file_path == source_relative)
                    | BlogPost.file_path.like(f"{source_relative}/%"),
                )
            )
        ).scalars()
    )
    try:
        os.replace(source, destination)
    except OSError as exc:
        raise OwnershipError("Workspace entry could not be moved") from exc

    for post in posts:
        assert post.file_path is not None
        suffix = post.file_path.removeprefix(source_relative)
        post.file_path = f"{destination_relative}{suffix}"
    if posts:
        await db.commit()
    kind = "folder" if destination.is_dir() else "blog" if posts else "file"
    post = posts[0] if len(posts) == 1 and kind == "blog" else None
    return WorkspaceEntry(
        path=destination_relative,
        name=destination.name,
        kind=kind,
        resource_type="blog_post" if post else None,
        resource_id=post.id if post else None,
        blog_status=post.status if post else None,
    )


async def delete_folder(db: AsyncSession, user_id: int, *, path: str) -> None:
    del db
    relative_path = _relative_path(path)
    directory = _entry_path(user_id, relative_path)
    if directory.is_symlink() or not directory.is_dir():
        raise NotFoundError("Workspace folder not found")
    try:
        directory.rmdir()
    except OSError as exc:
        raise ConflictError("Workspace folder must be empty before deletion") from exc
