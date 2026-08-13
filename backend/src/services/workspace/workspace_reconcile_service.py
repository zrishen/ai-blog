"""崩溃一致性兜底：扫描 workspace 与 DB 的失配并 best-effort 修复。

处理进程在 ``os.replace`` 成功、DB commit 之前崩溃留下的两类孤儿：
- trash 不可见孤儿（文件已进 ``.trash`` 但无 ``WorkspaceTrashEntry``）：重建 entry 恢复可见。
- DB 指向不存在文件（BlogPost/FileDocument）：标记/计数。
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import OwnershipError
from src.core.path_guard import workspace_dir, workspace_path, workspace_users_root
from src.database import session as _db_session
from src.database.models import BlogPost, FileDocument, WorkspaceTrashEntry

logger = logging.getLogger(__name__)

TRASH_DIR_NAME = ".trash"
# BlogPost.content_storage_state 的 CHECK 只允许 legacy/verified/error，无 missing。
BLOG_MISSING_STATE = "error"


@dataclass
class WorkspaceReconcileReport:
    recovered_trash_orphans: int = 0
    flagged_missing_blog_posts: int = 0
    flagged_missing_documents: int = 0


def _naive_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _collect_trash_files(trash: Path) -> list[Path]:
    return [p for p in trash.rglob("*") if p.is_file()]


def _trashed_path_of(file: Path, user_root: Path) -> str | None:
    try:
        rel = file.relative_to(user_root)
    except ValueError:
        return None
    return PurePosixPath(*rel.parts).as_posix()


def _parse_trashed_path(trashed_path: str) -> str | None:
    """``.trash/<token>/<original...>`` → original_path；解析不出返回 None。"""
    parts = PurePosixPath(trashed_path).parts
    if len(parts) < 3 or parts[0] != TRASH_DIR_NAME:
        return None
    original = "/".join(parts[2:])
    return original or None


def _covered_by_active(trashed_path: str, active: set[str]) -> bool:
    if trashed_path in active:
        return True
    # 父级目录已是 active 条目（整目录被回收）则该叶子文件已被覆盖。
    return any(trashed_path.startswith(ap + "/") for ap in active)


async def _recover_trash_orphans(db: AsyncSession, user_id: int) -> int:
    user_root = workspace_dir(user_id)
    trash = user_root / TRASH_DIR_NAME
    if not trash.is_dir():
        return 0

    active = {
        tp
        for (tp,) in (
            await db.execute(select(WorkspaceTrashEntry.trashed_path).where(WorkspaceTrashEntry.user_id == user_id))
        ).all()
    }

    files = await asyncio.to_thread(_collect_trash_files, trash)
    recovered = 0
    for file in files:
        trashed_path = _trashed_path_of(file, user_root)
        if trashed_path is None or _covered_by_active(trashed_path, active):
            continue
        original_path = _parse_trashed_path(trashed_path) or file.name
        try:
            trashed_at = _naive_utc(datetime.fromtimestamp(file.stat().st_mtime, tz=UTC))
        except OSError:
            trashed_at = _utcnow()
        db.add(
            WorkspaceTrashEntry(
                user_id=user_id,
                entry_type="workspace_file",
                blog_post_id=None,
                original_path=original_path,
                trashed_path=trashed_path,
                deleted_at=trashed_at,
            )
        )
        active.add(trashed_path)
        recovered += 1
    return recovered


async def _flag_missing_blog_posts(db: AsyncSession, user_id: int) -> int:
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
    flagged = 0
    for post in posts:
        if post.file_path is None:
            continue
        try:
            resolved = workspace_path(user_id, post.file_path, mode="read")
        except Exception:
            continue
        if resolved.exists():
            continue
        post.content_storage_state = BLOG_MISSING_STATE
        post.last_storage_error = "workspace reconcile: file missing"
        flagged += 1
    return flagged


async def _count_missing_documents(db: AsyncSession, user_id: int) -> int:
    # FileDocument 无 stale/missing 标记列，此处仅计数，不改动行。
    docs = list(
        (
            await db.execute(
                select(FileDocument).where(
                    FileDocument.user_id == str(user_id),
                    FileDocument.deleted_at.is_(None),
                )
            )
        ).scalars()
    )
    missing = 0
    for doc in docs:
        try:
            resolved = workspace_path(user_id, doc.file_path, mode="read")
        except Exception:
            continue
        if not resolved.exists():
            missing += 1
    return missing


async def reconcile_user_workspace(db: AsyncSession, user_id: int) -> WorkspaceReconcileReport:
    report = WorkspaceReconcileReport()
    report.recovered_trash_orphans = await _recover_trash_orphans(db, user_id)
    report.flagged_missing_blog_posts = await _flag_missing_blog_posts(db, user_id)
    report.flagged_missing_documents = await _count_missing_documents(db, user_id)
    return report


async def reconcile_all_workspaces() -> dict[int, WorkspaceReconcileReport]:
    results: dict[int, WorkspaceReconcileReport] = {}

    directory_ids: set[int] = set()
    try:
        users_root = workspace_users_root()
        if users_root.is_dir():
            for child in users_root.iterdir():
                if child.is_dir() and child.name.isdigit():
                    directory_ids.add(int(child.name))
    except (OSError, OwnershipError):
        pass

    async with _db_session.async_session() as db:
        blog_ids = {uid for (uid,) in (await db.execute(select(BlogPost.user_id).distinct())).all()}
        doc_ids: set[int] = set()
        for (uid_str,) in (await db.execute(select(FileDocument.user_id).distinct())).all():
            try:
                doc_ids.add(int(uid_str))
            except (TypeError, ValueError):
                continue

    for uid in directory_ids | blog_ids | doc_ids:
        try:
            async with _db_session.async_session() as session:
                report = await reconcile_user_workspace(session, uid)
                await session.commit()
            results[uid] = report
        except Exception:
            logger.warning("workspace reconcile failed for user_id=%s", uid, exc_info=True)
    return results
