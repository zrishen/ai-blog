"""孤儿物理资源清理脚本。

回收站永久删除采用「DB 先提交、物理后清理」：数据库硬删记录并 commit 之后，
物理资源（上传文件 / Chroma 向量 / Markdown）以 best-effort 方式清理；一旦
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
    FileDocument as FileDocumentModel,
    Message as MessageModel,
)
from src.database.session import async_session
from src.services.trash.trash_service import _extract_local_filename
from src.services.rag.vector_store import _get_client, delete_document_chunks, list_collections

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup_orphans")


async def _collect_referenced_upload_names(db) -> set[str]:
    """收集数据库中仍被引用的所有上传文件 stored_name（跨用户）。"""
    referenced: set[str] = set()
    for (stored,) in (await db.execute(select(FileDocumentModel.file_path))).all():
        if stored:
            referenced.add(stored)
    for (cover,) in (await db.execute(select(BlogPostModel.cover_image))).all():
        extracted = _extract_local_filename(cover or "")
        if extracted:
            referenced.add(extracted)
    result = await db.execute(select(MessageModel.image_url, MessageModel.file_url))
    for image_url, file_url in result.all():
        for value in (image_url, file_url):
            extracted = _extract_local_filename(value or "")
            if extracted:
                referenced.add(extracted)
    return referenced


async def cleanup_upload_orphans(db, *, dry_run: bool) -> int:
    referenced = await _collect_referenced_upload_names(db)
    upload_root = Path(settings.upload_dir)
    if not upload_root.exists():
        return 0
    removed = 0
    for path in upload_root.rglob("*"):
        if not path.is_file() or path.name in referenced:
            continue
        logger.info("发现孤儿上传文件: %s", path)
        removed += 1
        if not dry_run:
            try:
                path.unlink()
            except OSError:
                logger.warning("删除失败: %s", path, exc_info=True)
    return removed


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


async def cleanup_markdown_orphans(db, *, dry_run: bool) -> int:
    referenced_slugs = {
        slug for (slug,) in (await db.execute(select(BlogPostModel.slug))).all() if slug
    }
    content_root = Path(settings.blog_content_dir)
    if not content_root.exists():
        return 0
    removed = 0
    for path in content_root.rglob("*.md"):
        if path.stem in referenced_slugs:
            continue
        logger.info("发现孤儿 Markdown: %s", path)
        removed += 1
        if not dry_run:
            try:
                path.unlink()
            except OSError:
                logger.warning("删除失败: %s", path, exc_info=True)
    return removed


async def cleanup_chroma_orphans(db, *, dry_run: bool) -> int:
    removed = 0
    client = await asyncio.to_thread(_get_client)
    for collection_name in await list_collections():
        rows = (
            await db.execute(
                select(FileDocumentModel.file_path).where(
                    FileDocumentModel.collection_name == collection_name
                )
            )
        ).all()
        referenced = {stored for (stored,) in rows if stored}
        try:
            collection = await asyncio.to_thread(client.get_collection, name=collection_name)
        except Exception:
            logger.warning("无法打开 collection: %s", collection_name, exc_info=True)
            continue
        data = await asyncio.to_thread(collection.get, include=["metadatas"])
        stored_names = {
            m.get("stored_name")
            for m in (data.get("metadatas") or [])
            if m.get("stored_name")
        }
        for stored in stored_names:
            if stored in referenced:
                continue
            logger.info("发现孤儿向量 chunks: collection=%s stored_name=%s", collection_name, stored)
            removed += 1
            if not dry_run:
                await delete_document_chunks(collection_name, stored)
    return removed


async def main() -> None:
    parser = argparse.ArgumentParser(description="清理无数据库引用的孤儿物理资源")
    parser.add_argument("--dry-run", action="store_true", help="只列出孤儿，不实际删除")
    args = parser.parse_args()

    async with async_session() as db:
        uploads = await cleanup_upload_orphans(db, dry_run=args.dry_run)
        chat_attachments = await cleanup_chat_attachment_orphans(db, dry_run=args.dry_run)
        markdown = await cleanup_markdown_orphans(db, dry_run=args.dry_run)
        vectors = await cleanup_chroma_orphans(db, dry_run=args.dry_run)
    mode = "dry-run" if args.dry_run else "deleted"
    logger.info(
        "完成（%s）：上传孤儿 %d，聊天附件孤儿 %d，Markdown 孤儿 %d，向量孤儿 %d",
        mode,
        uploads,
        chat_attachments,
        markdown,
        vectors,
    )


if __name__ == "__main__":
    asyncio.run(main())
