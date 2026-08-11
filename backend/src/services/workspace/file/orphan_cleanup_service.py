"""按不可变 user ID 工作区扫描孤儿上传文件。"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def cleanup_workspace_upload_orphans(
    workspace_root: str | Path,
    referenced: dict[int, set[str]],
    *,
    dry_run: bool,
) -> int:
    """Delete unreferenced files below ``workspace/users/<user_id>/uploads``."""

    users_root = Path(workspace_root).resolve() / "users"
    if not users_root.is_dir() or users_root.is_symlink():
        return 0

    removed = 0
    for user_root in users_root.iterdir():
        if not user_root.is_dir() or user_root.is_symlink():
            continue
        try:
            user_id = int(user_root.name)
        except ValueError:
            logger.warning("跳过非 user ID 工作区: %s", user_root)
            continue
        upload_root = user_root / "uploads"
        if not upload_root.is_dir() or upload_root.is_symlink():
            continue
        owner_references = referenced.get(user_id, set())
        for path in upload_root.rglob("*"):
            if not path.is_file() or path.is_symlink() or path.name in owner_references:
                continue
            logger.info("发现孤儿上传文件: %s", path)
            removed += 1
            if not dry_run:
                try:
                    path.unlink()
                except OSError:
                    logger.warning("删除失败: %s", path, exc_info=True)
    return removed
