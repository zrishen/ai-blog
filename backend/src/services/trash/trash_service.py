"""统一回收站服务：聚合 conversation / file_document / blog_post 三类软删资源，提供列表、恢复与永久删除；严格当前用户隔离，仅作用于 deleted_at 非空记录。

永久删除遵循「DB 先提交、物理后清理」：先硬删记录并 commit，再 best-effort 清理物理资源（上传文件 / FalkorDB 向量），失败留孤儿由维护任务回收，避免「DB 仍可见、资源已丢」的不一致。
"""

from __future__ import annotations

import asyncio
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
    BlogPostRevision,
    ChatAttachment as ChatAttachmentModel,
    Conversation as ConversationModel,
    FileDocument as FileDocumentModel,
    FileProcessingJob,
    Message as MessageModel,
    WorkspaceNode as WorkspaceNodeModel,
)
from src.schemas.trash import (
    TrashDeleteItemRef,
    TrashFailedItem,
    TrashItem,
)
from src.services.chat.chat_attachment_service import _resolve_stored_path
from src.services.file.file_processing_service import (
    create_or_reuse_restore_job,
    has_active_restore,
    schedule_job,
)
from src.services.file.file_service import get_user_upload_dir
from src.services.memory.graph_store import delete_document_chunks, delete_resource_memory
from src.services.workspace import rag_service
from src.services.workspace.resource_service import detach_resource_if_any

logger = logging.getLogger(__name__)


SUPPORTED_TYPES = {"conversation", "file_document", "blog_post", "workspace_folder"}


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


# 兼容 /api/ 与 /api/v1/ 前缀（历史 markdown 可能存旧前缀引用）
_UPLOAD_REF_RE = re.compile(r"^/api(?:/v1)?/(?:public/)?uploads/(?:([^/]+)/)?([^/]+)$")
_COVER_REF_RE = re.compile(r"^/api(?:/v1)?/blog/cover/([^/]+)$")


def _extract_local_filename(value: str) -> Optional[str]:
    """从 /api/[v1/]uploads/{name}、/api/[v1/]public/uploads/{user}/{name}、/api/[v1/]blog/cover/{name}
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

    # 工作区文件夹：只列「删除根」（软删且父级未软删），连带软删的子 folder 不重复出现
    soft_folder_ids_stmt = select(WorkspaceNodeModel.id).where(
        WorkspaceNodeModel.user_id == user_id,
        WorkspaceNodeModel.node_type == "folder",
        WorkspaceNodeModel.deleted_at.is_not(None),
    )
    folders = (
        await db.execute(
            select(WorkspaceNodeModel).where(
                WorkspaceNodeModel.user_id == user_id,
                WorkspaceNodeModel.node_type == "folder",
                WorkspaceNodeModel.deleted_at.is_not(None),
                or_(
                    WorkspaceNodeModel.parent_id.is_(None),
                    ~WorkspaceNodeModel.parent_id.in_(soft_folder_ids_stmt),
                ),
            )
        )
    ).scalars().all()
    for f in folders:
        if f.deleted_at is None:
            continue
        items.append(
            TrashItem(type="workspace_folder", id=f.id, name=f.name, deleted_at=f.deleted_at)
        )

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

    # Message 无 deleted_at，靠 Conversation.deleted_at 过滤；这里仅清父级软删
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
    # 还原后统一回未分类（inbox）：清掉原工作区挂靠点，不论原先挂在哪个目录
    await detach_resource_if_any(db, user_id, "blog_post", item_id)
    await db.commit()
    await db.refresh(post)
    return TrashItem(type="blog_post", id=post.id, name=post.title, deleted_at=deleted_at)


async def _restore_file_document(db: AsyncSession, *, item_id: int, user_id: int) -> FileProcessingJob:
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

    upload_path = get_user_upload_dir(user_id) / doc.file_path
    exists, is_file = await asyncio.gather(
        asyncio.to_thread(upload_path.exists),
        asyncio.to_thread(upload_path.is_file),
    )
    if not exists or not is_file:
        raise _conflict_error("ORIGINAL_FILE_MISSING", "原始文件已丢失，无法恢复向量索引")

    job = await create_or_reuse_restore_job(
        db,
        user_id=user_id,
        source_document=doc,
    )
    schedule_job(job.id)
    return job


async def _restore_folder(db: AsyncSession, *, item_id: int, user_id: int) -> TrashItem:
    """恢复工作区文件夹子树（目录 + 挂靠关系），委托 node_service.restore_subtree。"""
    from src.services.workspace.node_service import restore_subtree

    node = await db.get(WorkspaceNodeModel, item_id)
    if (
        node is None
        or node.user_id != user_id
        or node.deleted_at is None
        or node.node_type != "folder"
    ):
        raise _not_found_error()
    name = node.name
    deleted_at = node.deleted_at
    await restore_subtree(db, user_id, node)
    return TrashItem(type="workspace_folder", id=item_id, name=name, deleted_at=deleted_at)


async def restore_item(
    db: AsyncSession,
    *,
    item_type: str,
    item_id: int,
    user_id: int,
) -> TrashItem | FileProcessingJob:
    if item_type not in SUPPORTED_TYPES:
        raise _not_found_error()
    if item_type == "conversation":
        return await _restore_conversation(db, item_id=item_id, user_id=user_id)
    if item_type == "file_document":
        return await _restore_file_document(db, item_id=item_id, user_id=user_id)
    if item_type == "workspace_folder":
        return await _restore_folder(db, item_id=item_id, user_id=user_id)
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
        logger.warning("跳过非普通文件（留待孤儿清理）: %s", upload_path)
        return False
    try:
        upload_path.unlink()
    except OSError:
        # DB 记录此时已硬删；物理删除失败只留孤儿，由清理脚本回收，不回滚已提交的删除
        logger.warning("本地文件删除失败（留待孤儿清理）: %s", upload_path, exc_info=True)
        return False
    return True


async def _collect_chat_attachment_paths(
    db: AsyncSession,
    *,
    conversation_id: int,
    user_id: int,
) -> list[PurePath]:
    result = await db.execute(
        select(ChatAttachmentModel.stored_path)
        .join(MessageModel, ChatAttachmentModel.message_id == MessageModel.id)
        .where(
            MessageModel.conversation_id == conversation_id,
            ChatAttachmentModel.user_id == user_id,
        )
    )
    return [PurePath(stored_path) for stored_path in result.scalars().all()]


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

    # commit 前先收集物理资源信息（commit 后相关 Message 记录将被删除）
    attachment_names = await _collect_conversation_attachment_names(db, item_id)
    chat_attachment_paths = await _collect_chat_attachment_paths(
        db,
        conversation_id=item_id,
        user_id=user_id,
    )

    # 先硬删 DB 并提交（状态先不可恢复），物理清理失败也不出现「DB 可见、附件已丢」
    await db.execute(
        sql_delete(ChatAttachmentModel).where(
            ChatAttachmentModel.user_id == user_id,
            ChatAttachmentModel.message_id.in_(
                select(MessageModel.id).where(MessageModel.conversation_id == item_id)
            ),
        )
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

    # commit 成功后 best-effort 清理独占物理附件；失败仅留孤儿（由清理脚本回收），不影响已提交的删除。
    for stored_name in attachment_names:
        try:
            await _purge_uploaded_file_if_exclusive(
                db,
                stored_name=stored_name,
                user_id=user_id,
            )
        except Exception:
            logger.warning(
                "回收站清理附件失败（留待孤儿清理）: stored_name=%s", stored_name, exc_info=True
            )
    for stored_path in chat_attachment_paths:
        try:
            path = _resolve_stored_path(stored_path.as_posix())
            await asyncio.to_thread(path.unlink, missing_ok=True)
        except Exception:
            logger.warning(
                "回收站清理聊天附件失败（留待孤儿清理）: stored_path=%s",
                stored_path,
                exc_info=True,
            )


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
    if await has_active_restore(db, user_id=user_id, source_document_id=doc.id):
        raise _conflict_error("FILE_PROCESSING_ACTIVE", "文件正在恢复，暂不能永久删除")

    # commit 前先收集物理资源信息
    collection_name = doc.collection_name
    stored_name = doc.file_path
    doc_id = doc.id

    # 先硬删 DB 并提交，再 best-effort 清理向量与文件，避免「DB 还在、资源已丢」。
    await db.execute(
        sql_delete(FileDocumentModel).where(FileDocumentModel.id == doc_id)
    )
    await db.commit()

    # commit 成功后 best-effort 清理；失败留孤儿，由清理脚本回收。
    try:
        await delete_document_chunks(collection_name, stored_name)
        await delete_resource_memory(user_id=user_id, resource_type="file", resource_id=doc_id)
    except Exception:
        logger.warning(
            "向量索引清理失败（留待孤儿清理）: doc_id=%s stored_name=%s",
            doc_id,
            stored_name,
            exc_info=True,
        )
    try:
        await _purge_uploaded_file_if_exclusive(
            db,
            stored_name=stored_name,
            user_id=user_id,
        )
    except Exception:
        logger.warning(
            "上传文件清理失败（留待孤儿清理）: stored_name=%s", stored_name, exc_info=True
        )
    # 关联移出 AI 知识（删 RagSource）；向量已在上面清理，避免孤儿源残留。
    try:
        if await rag_service.get_rag_source(db, user_id, "file", doc_id) is not None:
            await rag_service.remove_from_ai_knowledge(db, user_id, "file", doc_id)
    except Exception:
        logger.warning("AI 知识源清理失败（留待孤儿清理）: doc_id=%s", doc_id, exc_info=True)


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

    # commit 前先收集物理资源信息
    post_id = post.id
    cover_value = post.cover_image or ""
    cover_stored = (
        _extract_local_filename(cover_value)
        if not _is_external_or_empty(cover_value)
        else None
    )

    # 先删除关联 revisions，再删除文章本体，避免依赖数据库级联行为。
    await db.execute(
        sql_delete(BlogPostRevision).where(
            BlogPostRevision.post_id == post_id,
            BlogPostRevision.user_id == user_id,
        )
    )
    await db.execute(
        sql_delete(BlogPostModel).where(
            BlogPostModel.id == post_id,
            BlogPostModel.user_id == user_id,
        )
    )
    await db.commit()

    # commit 后 best-effort 清理；失败留孤儿，由清理脚本回收
    try:
        rag_source = await rag_service.get_rag_source(db, user_id, "blog_post", post_id)
        if rag_source is not None:
            await delete_document_chunks(rag_source.collection_name, f"blog_post:{post_id}")
            await rag_service.remove_from_ai_knowledge(db, user_id, "blog_post", post_id)
        await delete_resource_memory(user_id=user_id, resource_type="blog_post", resource_id=post_id)
    except Exception:
        logger.warning("AI 知识向量清理失败（留待孤儿清理）: post_id=%s", post_id, exc_info=True)
    if cover_stored:
        try:
            await _purge_uploaded_file_if_exclusive(
                db,
                stored_name=cover_stored,
                user_id=user_id,
            )
        except Exception:
            logger.warning(
                "封面清理失败（留待孤儿清理）: stored_name=%s", cover_stored, exc_info=True
            )


async def _purge_folder(db: AsyncSession, *, item_id: int, user_id: int) -> None:
    """永久删除工作区文件夹子树，委托 node_service.purge_subtree（底层资源不动，回未分类）。"""
    from src.services.workspace.node_service import purge_subtree

    node = await db.get(WorkspaceNodeModel, item_id)
    if (
        node is None
        or node.user_id != user_id
        or node.deleted_at is None
        or node.node_type != "folder"
    ):
        raise _not_found_error()
    await purge_subtree(db, item_id)
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
    if item_type == "workspace_folder":
        return await _purge_folder(db, item_id=item_id, user_id=user_id)
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
