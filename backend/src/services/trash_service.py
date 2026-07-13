"""统一回收站服务。

聚合 conversation / file_document / blog_post 三类已软删资源，提供列表、
恢复与永久删除。所有操作严格当前用户隔离，且仅作用于 deleted_at 非空的记录。

资源删除规则：
- 恢复 file 时复用 file_service.vectorize_and_store 重建向量，成功才清 deleted_at；
  失败时清新 chunks 以避免残留半向量，并保留在回收站中。
- 永久删除 conversation 时一并清理独占的本地附件（Message.image_url/file_url），
  再硬删 Conversation；Message 经外键 CASCADE 同步删除。
- 永久删除 file 时先删 Chroma chunks（幂等），再删独占上传文件，最后硬删记录。
- 永久删除 blog 时删独占 Markdown 与独占本地封面，最后硬删记录。
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import delete as sql_delete
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    BlogPost as BlogPostModel,
    Conversation as ConversationModel,
    FileDocument as FileDocumentModel,
    Message as MessageModel,
)
from src.schemas.trash import (
    TrashDeleteItemRef,
    TrashFailedItem,
    TrashItem,
)
from src.services.file_service import get_user_upload_dir, vectorize_and_store
from src.services.markdown_blog_service import delete_post_file
from src.services.vector_store import delete_document_chunks

logger = logging.getLogger(__name__)


SUPPORTED_TYPES = {"conversation", "file_document", "blog_post"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── 路径与引用安全检查 ──────────────────────────────────────────


def _is_safe_user_relative_name(name: str) -> bool:
    """判断字符串是否仅是用户上传目录内的相对文件名（不含分隔符、目录穿越、外部 URL）。"""
    if not name or not isinstance(name, str):
        return False
    if name in {".", ".."}:
        return False
    if "\x00" in name:
        return False
    if name.strip() != name:
        return False
    if name.startswith(("http://", "https://", "ftp://", "file://", "//", "data:", "blob:")):
        return False
    pp = PurePath(name)
    if pp.is_absolute():
        return False
    if len(pp.parts) != 1:
        return False
    if "/" in name or "\\" in name or ".." in name:
        return False
    return True


def _is_external_or_empty(value: Optional[str]) -> bool:
    """默认封面（外链或空）不参与本地文件清理。"""
    if not value:
        return True
    raw = value.strip()
    if not raw:
        return True
    if raw.startswith(("http://", "https://", "//", "data:", "blob:", "ftp:", "file:")):
        return True
    return False


_UPLOAD_REF_RE = re.compile(r"^/api/(?:public/)?uploads/(?:([^/]+)/)?([^/]+)$")
_COVER_REF_RE = re.compile(r"^/api/blog/cover/([^/]+)$")


def _extract_local_filename(value: str) -> Optional[str]:
    """从 /api/uploads/{name}、/api/public/uploads/{user}/{name}、/api/blog/cover/{name}
    或纯文件名中提取并校验最终的 stored filename。

    返回 None 表示该引用不是用户本地文件，不应被删除。
    """
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if _is_external_or_empty(raw):
        return None

    m = _UPLOAD_REF_RE.match(raw)
    if m:
        candidate = m.group(2)
        return candidate if _is_safe_user_relative_name(candidate) else None
    m = _COVER_REF_RE.match(raw)
    if m:
        candidate = m.group(1)
        return candidate if _is_safe_user_relative_name(candidate) else None

    return raw if _is_safe_user_relative_name(raw) else None


async def _count_other_file_document_refs(
    db: AsyncSession,
    stored_name: str,
    *,
    exclude_doc_id: int | None,
    user_id_str: str,
) -> int:
    """统计其他 FileDocument（含正常和软删）是否引用同一 stored 文件名。"""
    stmt = select(FileDocumentModel.id).where(
        FileDocumentModel.user_id == user_id_str,
        FileDocumentModel.file_path == stored_name,
    )
    if exclude_doc_id is not None:
        stmt = stmt.where(FileDocumentModel.id != exclude_doc_id)
    result = await db.execute(stmt)
    return len(result.scalars().all())


async def _count_other_blog_cover_refs(
    db: AsyncSession,
    stored_name: str,
    *,
    exclude_post_id: int | None,
    user_id: int,
) -> int:
    """统计当前用户其他文章对同一本地封面文件的引用。"""
    stmt = select(BlogPostModel.cover_image).where(
        BlogPostModel.user_id == user_id,
    )
    if exclude_post_id is not None:
        stmt = stmt.where(BlogPostModel.id != exclude_post_id)
    result = await db.execute(stmt)
    return sum(
        1
        for cover_value in result.scalars().all()
        if _extract_local_filename(cover_value or "") == stored_name
    )


async def _count_message_refs_for_filename(
    db: AsyncSession,
    stored_name: str,
    *,
    exclude_conversation_id: int | None,
    user_id: int,
) -> int:
    """统计当前用户其他消息对同一上传文件的精确引用。"""
    stmt = (
        select(MessageModel.image_url, MessageModel.file_url)
        .join(
            ConversationModel,
            ConversationModel.id == MessageModel.conversation_id,
        )
        .where(ConversationModel.user_id == user_id)
    )
    if exclude_conversation_id is not None:
        stmt = stmt.where(MessageModel.conversation_id != exclude_conversation_id)
    result = await db.execute(stmt)
    return sum(
        1
        for image_url, file_url in result.all()
        if any(
            _extract_local_filename(value or "") == stored_name
            for value in (image_url, file_url)
        )
    )


# ── 列表 ───────────────────────────────────────────────────────


async def list_trash(db: AsyncSession, *, user_id: int) -> list[TrashItem]:
    """聚合三类资源已软删项，按 deleted_at 倒序返回。"""
    user_id_str = str(user_id)
    items: list[TrashItem] = []

    convs = (
        await db.execute(
            select(ConversationModel).where(
                ConversationModel.user_id == user_id,
                ConversationModel.deleted_at.is_not(None),
            )
        )
    ).scalars().all()
    for c in convs:
        if c.deleted_at is None:
            continue
        items.append(
            TrashItem(type="conversation", id=c.id, name=c.title, deleted_at=c.deleted_at)
        )

    docs = (
        await db.execute(
            select(FileDocumentModel).where(
                FileDocumentModel.user_id == user_id_str,
                FileDocumentModel.deleted_at.is_not(None),
            )
        )
    ).scalars().all()
    for d in docs:
        if d.deleted_at is None:
            continue
        items.append(
            TrashItem(type="file_document", id=d.id, name=d.original_name, deleted_at=d.deleted_at)
        )

    posts = (
        await db.execute(
            select(BlogPostModel).where(
                BlogPostModel.user_id == user_id,
                BlogPostModel.deleted_at.is_not(None),
            )
        )
    ).scalars().all()
    for p in posts:
        if p.deleted_at is None:
            continue
        items.append(TrashItem(type="blog_post", id=p.id, name=p.title, deleted_at=p.deleted_at))

    items.sort(
        key=lambda it: it.deleted_at.timestamp() if it.deleted_at else 0.0,
        reverse=True,
    )
    return items


# ── 恢复 ───────────────────────────────────────────────────────


def _not_found_error() -> HTTPException:
    return HTTPException(status_code=404, detail="回收站中未找到该项目")


def _conflict_error(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=f"{code}: {message}")


def _purge_error(message: str) -> HTTPException:
    return HTTPException(status_code=500, detail=f"PURGE_FAILED: {message}")


async def _restore_conversation(db: AsyncSession, *, item_id: int, user_id: int) -> TrashItem:
    result = await db.execute(
        select(ConversationModel).where(
            ConversationModel.id == item_id,
            ConversationModel.user_id == user_id,
            ConversationModel.deleted_at.is_not(None),
        )
    )
    conv = result.scalar_one_or_none()
    if conv is None:
        raise _not_found_error()
    assert conv.deleted_at is not None
    deleted_at = conv.deleted_at

    # Message 没有 deleted_at 字段；会话软删后消息记录保持不变，
    # 列表/查询通过 Conversation.deleted_at 过滤即可。这里仅清父级软删。
    conv.deleted_at = None
    conv.updated_at = _now()
    await db.commit()
    await db.refresh(conv)
    return TrashItem(type="conversation", id=conv.id, name=conv.title, deleted_at=deleted_at)


async def _restore_blog_post(db: AsyncSession, *, item_id: int, user_id: int) -> TrashItem:
    result = await db.execute(
        select(BlogPostModel).where(
            BlogPostModel.id == item_id,
            BlogPostModel.user_id == user_id,
            BlogPostModel.deleted_at.is_not(None),
        )
    )
    post = result.scalar_one_or_none()
    if post is None:
        raise _not_found_error()
    assert post.deleted_at is not None
    deleted_at = post.deleted_at

    post.deleted_at = None
    await db.commit()
    await db.refresh(post)
    return TrashItem(type="blog_post", id=post.id, name=post.title, deleted_at=deleted_at)


async def _restore_file_document(db: AsyncSession, *, item_id: int, user_id: int) -> TrashItem:
    result = await db.execute(
        select(FileDocumentModel).where(
            FileDocumentModel.id == item_id,
            FileDocumentModel.user_id == str(user_id),
            FileDocumentModel.deleted_at.is_not(None),
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise _not_found_error()
    assert doc.deleted_at is not None
    deleted_at = doc.deleted_at

    stored_name = doc.file_path
    original_name = doc.original_name
    collection_name = doc.collection_name
    category_id = doc.category_id
    doc_id = doc.id

    # 原始上传文件必须存在才能恢复向量
    upload_path = get_user_upload_dir(user_id) / stored_name
    if not upload_path.exists() or not upload_path.is_file():
        raise _conflict_error("ORIGINAL_FILE_MISSING", "原始文件已丢失，无法恢复向量索引")

    # 保持软删状态下重建向量；失败时清新 chunks 并抛错
    try:
        await vectorize_and_store(
            stored_name,
            collection_name,
            original_name=original_name,
            category_id=category_id,
            user_id=user_id,
        )
    except Exception as exc:
        logger.exception(
            "恢复文件时向量重建失败: doc_id=%s stored_name=%s",
            doc_id,
            stored_name,
        )
        try:
            await delete_document_chunks(collection_name, stored_name)
        except Exception:
            logger.exception(
                "向量重建失败后清理 chunks 也失败: doc_id=%s stored_name=%s",
                doc_id,
                stored_name,
            )
        raise _conflict_error("VECTORIZATION_FAILED", f"向量重建失败：{exc}") from exc

    doc.deleted_at = None
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        try:
            await delete_document_chunks(collection_name, stored_name)
        except Exception:
            logger.exception(
                "文件恢复提交失败后清理 chunks 也失败: doc_id=%s stored_name=%s",
                doc_id,
                stored_name,
            )
        raise _conflict_error("RESTORE_COMMIT_FAILED", "恢复状态保存失败，请重试") from exc

    await db.refresh(doc)
    return TrashItem(
        type="file_document",
        id=doc.id,
        name=doc.original_name,
        deleted_at=deleted_at,
    )


async def restore_item(
    db: AsyncSession,
    *,
    item_type: str,
    item_id: int,
    user_id: int,
) -> TrashItem:
    if item_type not in SUPPORTED_TYPES:
        raise _not_found_error()
    if item_type == "conversation":
        return await _restore_conversation(db, item_id=item_id, user_id=user_id)
    if item_type == "file_document":
        return await _restore_file_document(db, item_id=item_id, user_id=user_id)
    return await _restore_blog_post(db, item_id=item_id, user_id=user_id)


# ── 永久删除 ───────────────────────────────────────────────────


async def _collect_conversation_attachment_names(
    db: AsyncSession, conversation_id: int
) -> list[str]:
    """收集会话下所有 Message 引用的本地附件 stored 文件名（去重）。"""
    result = await db.execute(
        select(MessageModel.image_url, MessageModel.file_url).where(
            MessageModel.conversation_id == conversation_id,
        )
    )
    names: set[str] = set()
    for image_url, file_url in result.all():
        for value in (image_url, file_url):
            extracted = _extract_local_filename(value or "")
            if extracted:
                names.add(extracted)
    return sorted(names)


async def _purge_uploaded_file_if_exclusive(
    db: AsyncSession,
    *,
    stored_name: str,
    user_id: int,
    exclude_doc_id: int | None = None,
    exclude_post_id: int | None = None,
    exclude_conversation_id: int | None = None,
) -> bool:
    """仅当其他资源都不再引用该 stored 文件名时才删除本地文件。"""
    user_id_str = str(user_id)

    file_refs = await _count_other_file_document_refs(
        db, stored_name, exclude_doc_id=exclude_doc_id, user_id_str=user_id_str
    )
    if file_refs > 0:
        return False

    cover_refs = await _count_other_blog_cover_refs(
        db,
        stored_name,
        exclude_post_id=exclude_post_id,
        user_id=user_id,
    )
    if cover_refs > 0:
        return False

    msg_refs = await _count_message_refs_for_filename(
        db,
        stored_name,
        exclude_conversation_id=exclude_conversation_id,
        user_id=user_id,
    )
    if msg_refs > 0:
        return False

    upload_path = get_user_upload_dir(user_id) / stored_name
    if not upload_path.exists():
        return True
    if not upload_path.is_file():
        raise _purge_error("上传资源不是普通文件，无法永久删除")
    try:
        upload_path.unlink()
    except OSError as exc:
        raise _purge_error("本地文件删除失败") from exc
    return True


async def _purge_conversation(db: AsyncSession, *, item_id: int, user_id: int) -> None:
    result = await db.execute(
        select(ConversationModel).where(
            ConversationModel.id == item_id,
            ConversationModel.user_id == user_id,
            ConversationModel.deleted_at.is_not(None),
        )
    )
    conv = result.scalar_one_or_none()
    if conv is None:
        raise _not_found_error()

    attachment_names = await _collect_conversation_attachment_names(db, item_id)

    for stored_name in attachment_names:
        await _purge_uploaded_file_if_exclusive(
            db,
            stored_name=stored_name,
            user_id=user_id,
            exclude_conversation_id=item_id,
        )

    await db.execute(
        sql_delete(MessageModel).where(MessageModel.conversation_id == item_id)
    )
    await db.execute(
        sql_delete(ConversationModel).where(
            ConversationModel.id == item_id,
            ConversationModel.user_id == user_id,
        )
    )
    await db.commit()


async def _purge_file_document(db: AsyncSession, *, item_id: int, user_id: int) -> None:
    result = await db.execute(
        select(FileDocumentModel).where(
            FileDocumentModel.id == item_id,
            FileDocumentModel.user_id == str(user_id),
            FileDocumentModel.deleted_at.is_not(None),
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise _not_found_error()

    collection_name = doc.collection_name
    stored_name = doc.file_path
    doc_id = doc.id

    try:
        await delete_document_chunks(collection_name, stored_name)
    except Exception as exc:
        logger.exception(
            "永久删除文件时 Chroma 清理失败: doc_id=%s stored_name=%s",
            doc_id,
            stored_name,
        )
        raise _purge_error("向量索引清理失败") from exc

    await _purge_uploaded_file_if_exclusive(
        db,
        stored_name=stored_name,
        user_id=user_id,
        exclude_doc_id=doc_id,
    )

    await db.execute(
        sql_delete(FileDocumentModel).where(FileDocumentModel.id == doc_id)
    )
    await db.commit()


async def _purge_blog_post(db: AsyncSession, *, item_id: int, user_id: int) -> None:
    result = await db.execute(
        select(BlogPostModel).where(
            BlogPostModel.id == item_id,
            BlogPostModel.user_id == user_id,
            BlogPostModel.deleted_at.is_not(None),
        )
    )
    post = result.scalar_one_or_none()
    if post is None:
        raise _not_found_error()

    slug = post.slug
    post_id = post.id
    cover_value = post.cover_image or ""

    # Markdown 文件按 slug 命名且为博客专用，独占则删除
    if slug:
        delete_post_file(slug, user_id)

    # 本地封面仅当独占时删除
    if not _is_external_or_empty(cover_value):
        cover_stored = _extract_local_filename(cover_value)
        if cover_stored:
            await _purge_uploaded_file_if_exclusive(
                db,
                stored_name=cover_stored,
                user_id=user_id,
                exclude_post_id=post_id,
            )

    await db.execute(
        sql_delete(BlogPostModel).where(
            BlogPostModel.id == post_id,
            BlogPostModel.user_id == user_id,
        )
    )
    await db.commit()


async def purge_item(
    db: AsyncSession,
    *,
    item_type: str,
    item_id: int,
    user_id: int,
) -> None:
    if item_type not in SUPPORTED_TYPES:
        raise _not_found_error()
    if item_type == "conversation":
        return await _purge_conversation(db, item_id=item_id, user_id=user_id)
    if item_type == "file_document":
        return await _purge_file_document(db, item_id=item_id, user_id=user_id)
    return await _purge_blog_post(db, item_id=item_id, user_id=user_id)


# ── 清空 ───────────────────────────────────────────────────────


async def empty_trash(db: AsyncSession, *, user_id: int) -> dict[str, Any]:
    """逐项清空回收站。

    返回：
        status: 'ok' / 'partial'
        deleted: [{type,id}]
        failed: [{item:{type,id}, code, message}]
        remaining: 未成功删除、仍留在回收站的项目数量
    """
    items = await list_trash(db, user_id=user_id)

    deleted: list[TrashDeleteItemRef] = []
    failed: list[TrashFailedItem] = []
    remaining: list[TrashDeleteItemRef] = []

    for item in items:
        ref = TrashDeleteItemRef(type=item.type, id=item.id)
        try:
            await purge_item(
                db,
                item_type=item.type,
                item_id=item.id,
                user_id=user_id,
            )
            deleted.append(ref)
        except HTTPException as exc:
            await db.rollback()
            code = _error_code_from_exception(exc)
            failed.append(
                TrashFailedItem(
                    item=ref,
                    code=code,
                    message=str(exc.detail) if exc.detail else "永久删除失败",
                )
            )
            remaining.append(ref)
        except Exception as exc:
            await db.rollback()
            logger.exception(
                "清空回收站单项失败: type=%s id=%s",
                item.type,
                item.id,
            )
            failed.append(
                TrashFailedItem(
                    item=ref,
                    code="PURGE_FAILED",
                    message=str(exc) or "永久删除失败",
                )
            )
            remaining.append(ref)

    status = "partial" if failed else "ok"
    return {
        "status": status,
        "deleted": [r.model_dump() for r in deleted],
        "failed": [f.model_dump() for f in failed],
        "remaining": len(remaining),
    }


def _error_code_from_exception(exc: HTTPException) -> str:
    detail = exc.detail
    if isinstance(detail, str) and ":" in detail:
        return detail.split(":", 1)[0].strip()
    return f"HTTP_{exc.status_code}"


__all__ = [
    "SUPPORTED_TYPES",
    "list_trash",
    "restore_item",
    "purge_item",
    "empty_trash",
]
