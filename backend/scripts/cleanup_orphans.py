"""孤儿物理资源清理脚本。

回收站永久删除采用「DB 先提交、物理后清理」：数据库硬删记录并 commit 之后，
物理资源（上传文件 / FalkorDB 向量）以 best-effort 方式清理；一旦
物理删除失败或进程中途退出，会留下「无数据库引用的孤儿资源」。本脚本扫描并
删除这些孤儿，幂等可重复运行，建议配合定时任务周期性执行。

用法::

    cd backend && uv run python scripts/cleanup_orphans.py            # 实际删除
    cd backend && uv run python scripts/cleanup_orphans.py --dry-run   # 只列出孤儿
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# 允许 `python scripts/cleanup_orphans.py` 直接运行时找到 src 包
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from src.config import settings
from src.database.models import (
    BlogPost as BlogPostModel,
    ChatAttachment as ChatAttachmentModel,
    Conversation as ConversationModel,
    FileDocument as FileDocumentModel,
    Message as MessageModel,
)
from src.database.session import async_session
from src.services.workspace.file.orphan_cleanup_service import cleanup_workspace_upload_orphans
from src.services.workspace.trash.trash_service import _extract_local_filename

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup_orphans")


def _stored_filename(stored_path: str | None) -> str | None:
    if not stored_path:
        return None
    path = Path(stored_path)
    if path.is_absolute() or ".." in path.parts:
        return None
    return path.name or None


async def _collect_referenced_upload_names(db) -> dict[int, set[str]]:
    """按 user ID 收集数据库中仍被引用的上传文件名。"""

    referenced: dict[int, set[str]] = {}

    def add(user_id, filename: str | None) -> None:
        if filename is None:
            return
        try:
            owner_id = int(user_id)
        except (TypeError, ValueError) as exc:
            raise RuntimeError(f"上传引用缺少数值 user_id: {user_id!r}") from exc
        referenced.setdefault(owner_id, set()).add(filename)

    for user_id, stored in (
        await db.execute(select(FileDocumentModel.user_id, FileDocumentModel.file_path))
    ).all():
        add(user_id, _stored_filename(stored))
    for user_id, cover in (
        await db.execute(select(BlogPostModel.user_id, BlogPostModel.cover_image))
    ).all():
        add(user_id, _extract_local_filename(cover or ""))

    message_rows = await db.execute(
        select(ConversationModel.user_id, MessageModel.image_url, MessageModel.file_url).join(
            MessageModel,
            MessageModel.conversation_id == ConversationModel.id,
        )
    )
    for user_id, image_url, file_url in message_rows.all():
        for value in (image_url, file_url):
            add(user_id, _extract_local_filename(value or ""))
    return referenced


async def cleanup_upload_orphans(db, *, dry_run: bool) -> int:
    referenced = await _collect_referenced_upload_names(db)
    return cleanup_workspace_upload_orphans(
        settings.workspace_root,
        referenced,
        dry_run=dry_run,
    )


async def cleanup_chat_attachment_orphans(db, *, dry_run: bool) -> int:
    referenced = {
        stored_path
        for (stored_path,) in (
            await db.execute(select(ChatAttachmentModel.stored_path))
        ).all()
        if stored_path
    }
    attachment_root = Path(settings.chat_attachment_dir).resolve()
    if not attachment_root.exists():
        return 0
    removed = 0
    for path in attachment_root.rglob("*"):
        if not path.is_file():
            continue
        try:
            relative = path.resolve().relative_to(attachment_root).as_posix()
        except ValueError:
            logger.warning("跳过附件目录外文件: %s", path)
            continue
        if relative in referenced:
            continue
        logger.info("发现孤儿聊天附件: %s", path)
        removed += 1
        if not dry_run:
            try:
                path.unlink()
            except OSError:
                logger.warning("删除失败: %s", path, exc_info=True)
    return removed


async def main() -> None:
    parser = argparse.ArgumentParser(description="清理无数据库引用的孤儿物理资源")
    parser.add_argument("--dry-run", action="store_true", help="只列出孤儿，不实际删除")
    args = parser.parse_args()

    async with async_session() as db:
        uploads = await cleanup_upload_orphans(db, dry_run=args.dry_run)
        chat_attachments = await cleanup_chat_attachment_orphans(db, dry_run=args.dry_run)
    mode = "dry-run" if args.dry_run else "deleted"
    logger.info(
        "完成（%s）：上传孤儿 %d，聊天附件孤儿 %d",
        mode,
        uploads,
        chat_attachments,
    )


if __name__ == "__main__":
    asyncio.run(main())
