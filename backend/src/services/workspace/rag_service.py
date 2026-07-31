"""RAG 索引源服务：管理「加入 AI 知识」的资源及其索引状态机。

Phase 1 仅做 DB 层状态机（RagSource CRUD）；实际 embedding/向量库写入由 Phase 2 接入
（file_service 解耦后，index 动作调用 vectorize 并回写状态）。collection_name 默认按用户隔离。
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import NotFoundError, OwnershipError
from src.database.models import BlogPost as BlogPostModel
from src.database.models import FileDocument as FileDocumentModel
from src.database.models import FileProcessingJob
from src.database.models import RagSource as RagSourceModel
from src.database.models import _utcnow

# pending=待索引 active=已索引 stale=内容变更待重索引 failed=索引失败
_ACTIVE = "active"


def default_collection_name(user_id: int) -> str:
    return f"user_{user_id}"


def blog_collection_name(user_id: int) -> str:
    """文章向量集合：按用户 + embedding 模型隔离（与文件集合并列，便于单独清理）。

    不要用 default_collection_name 的无后缀版本——换 embedding 模型后旧向量无法定位。
    """
    from src.services.rag.embedding_service import get_embedding_collection_suffix

    return f"user_{user_id}_blog{get_embedding_collection_suffix()}"


async def _get(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> RagSourceModel | None:
    stmt = select(RagSourceModel).where(
        RagSourceModel.user_id == user_id,
        RagSourceModel.resource_type == resource_type,
        RagSourceModel.resource_id == resource_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def add_to_ai_knowledge(
    db: AsyncSession,
    user_id: int,
    *,
    resource_type: str,
    resource_id: int,
    collection_name: str | None = None,
) -> RagSourceModel:
    """加入 AI 知识：建 RagSource(pending)。已存在则幂等返回（不重复索引）。"""
    existing = await _get(db, user_id, resource_type, resource_id)
    if existing is not None:
        return existing
    source = RagSourceModel(
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        index_status="pending",
        collection_name=collection_name or default_collection_name(user_id),
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


async def remove_from_ai_knowledge(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> RagSourceModel:
    """从 AI 知识移除：删 RagSource 记录。返回被删记录（含 collection_name，供调用方删向量）。"""
    source = await _get(db, user_id, resource_type, resource_id)
    if source is None:
        raise NotFoundError("该资源未加入 AI 知识")
    await db.delete(source)
    await db.commit()
    return source


async def mark_stale(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> RagSourceModel | None:
    """内容变更后标记 stale。未加入 AI 知识的资源返回 None（无需标记）。"""
    source = await _get(db, user_id, resource_type, resource_id)
    if source is None:
        return None
    source.index_status = "stale"
    await db.commit()
    await db.refresh(source)
    return source


async def mark_indexed(
    db: AsyncSession,
    user_id: int,
    resource_type: str,
    resource_id: int,
    *,
    version: str | None = None,
) -> RagSourceModel:
    """索引完成：置 active + 版本指纹，清错误。"""
    source = await _get(db, user_id, resource_type, resource_id)
    if source is None:
        raise NotFoundError("该资源未加入 AI 知识")
    source.index_status = _ACTIVE
    source.indexed_version = version
    source.indexed_at = _utcnow()
    source.error_message = None
    await db.commit()
    await db.refresh(source)
    return source


async def mark_failed(
    db: AsyncSession,
    user_id: int,
    resource_type: str,
    resource_id: int,
    *,
    error_message: str,
) -> RagSourceModel:
    source = await _get(db, user_id, resource_type, resource_id)
    if source is None:
        raise NotFoundError("该资源未加入 AI 知识")
    source.index_status = "failed"
    source.error_message = error_message
    await db.commit()
    await db.refresh(source)
    return source


async def get_rag_source(
    db: AsyncSession, user_id: int, resource_type: str, resource_id: int
) -> RagSourceModel | None:
    return await _get(db, user_id, resource_type, resource_id)


async def list_ai_knowledge(
    db: AsyncSession, user_id: int, *, status: str | None = None
) -> list[RagSourceModel]:
    stmt = select(RagSourceModel).where(RagSourceModel.user_id == user_id)
    if status:
        stmt = stmt.where(RagSourceModel.index_status == status)
    stmt = stmt.order_by(RagSourceModel.updated_at.desc())
    sources = list((await db.execute(stmt)).scalars().all())
    return await _without_soft_deleted_sources(db, sources)


async def _without_soft_deleted_sources(
    db: AsyncSession, sources: list[RagSourceModel]
) -> list[RagSourceModel]:
    """剔除底层资源已软删（进回收站）的 RAG 源，使 AI 知识与删除状态一致；恢复后自动重现。"""
    from src.services.workspace.resource_service import soft_deleted_resource_ids

    by_type: dict[str, list[int]] = {}
    for s in sources:
        if s.resource_id is not None:
            by_type.setdefault(s.resource_type, []).append(s.resource_id)
    hidden: set[tuple[str, int]] = set()
    for rtype, rids in by_type.items():
        for rid in await soft_deleted_resource_ids(db, rtype, rids):
            hidden.add((rtype, rid))
    if not hidden:
        return sources
    return [s for s in sources if (s.resource_type, s.resource_id) not in hidden]


# ---- file 资源的真实索引（接 vectorize / ChromaDB）----


async def _get_owned_file_document(
    db: AsyncSession, user_id: int, document_id: int
) -> FileDocumentModel:
    """取 FileDocument 并校验归属（FileDocument.user_id 存的是字符串）。"""
    doc = await db.get(FileDocumentModel, document_id)
    if doc is None or doc.deleted_at is not None:
        raise NotFoundError("文件不存在")
    if doc.user_id != str(user_id):
        raise OwnershipError("无权操作该文件")
    return doc


async def index_file_document(
    db: AsyncSession, user_id: int, document_id: int
) -> tuple[RagSourceModel, FileProcessingJob]:
    """对已上传文件触发异步索引：建 RagSource(pending) + 创建 index job 并调度。

    向量化在 job worker 内执行（带进度），完成由 worker 回写 active；失败标 failed。
    重新索引已加入的资源会覆盖旧向量（worker 先 cleanup）。
    """
    from src.services.file.file_processing_service import (
        create_or_reuse_index_job,
        schedule_job,
    )

    doc = await _get_owned_file_document(db, user_id, document_id)
    source = await add_to_ai_knowledge(
        db,
        user_id,
        resource_type="file",
        resource_id=document_id,
        collection_name=doc.collection_name,
    )
    job = await create_or_reuse_index_job(
        db,
        user_id=user_id,
        target_resource_type="file",
        target_resource_id=document_id,
        collection_name=doc.collection_name,
        original_name=doc.original_name,
        stored_name=doc.file_path,
    )
    schedule_job(job.id)
    return source, job


async def index_blog_post(
    db: AsyncSession, user_id: int, post_id: int
) -> tuple[RagSourceModel, FileProcessingJob]:
    """对文章触发异步索引：建 RagSource(pending) + 创建 index job 并调度。

    向量化在 worker 内读 MD 正文执行；完成回写 active，失败标 failed。
    """
    from src.services.file.file_processing_service import (
        create_or_reuse_index_job,
        schedule_job,
    )

    post = await db.get(BlogPostModel, post_id)
    if post is None or post.deleted_at is not None:
        raise NotFoundError("文章不存在")
    if post.user_id != user_id:
        raise OwnershipError("无权操作该文章")
    collection = blog_collection_name(user_id)
    source = await add_to_ai_knowledge(
        db,
        user_id,
        resource_type="blog_post",
        resource_id=post_id,
        collection_name=collection,
    )
    job = await create_or_reuse_index_job(
        db,
        user_id=user_id,
        target_resource_type="blog_post",
        target_resource_id=post_id,
        collection_name=collection,
        original_name=post.title or f"文章 #{post_id}",
        stored_name=f"blog_post:{post_id}",
    )
    schedule_job(job.id)
    return source, job


async def unindex_file_document(
    db: AsyncSession, user_id: int, document_id: int
) -> None:
    """从 AI 知识移除文件：删向量 + 删 RagSource，文件本身保留并标记 not indexed。"""
    from src.services.rag.vector_store import delete_document_chunks

    doc = await _get_owned_file_document(db, user_id, document_id)
    source = await get_rag_source(db, user_id, "file", document_id)
    if source is None:
        raise NotFoundError("该资源未加入 AI 知识")
    collection_name = source.collection_name
    await remove_from_ai_knowledge(db, user_id, "file", document_id)
    await delete_document_chunks(collection_name, doc.file_path)
    doc.chunk_content = "not indexed"
    await db.commit()


async def unindex_blog_post(
    db: AsyncSession, user_id: int, post_id: int
) -> None:
    """从 AI 知识移除文章：删向量 + 删 RagSource，文章本身保留。"""
    from src.services.rag.vector_store import delete_document_chunks

    source = await get_rag_source(db, user_id, "blog_post", post_id)
    if source is None:
        raise NotFoundError("该资源未加入 AI 知识")
    collection_name = source.collection_name
    await remove_from_ai_knowledge(db, user_id, "blog_post", post_id)
    await delete_document_chunks(collection_name, f"blog_post:{post_id}")


async def backfill_rag_sources_from_files(db: AsyncSession) -> int:
    """存量迁移：已索引的 FileDocument（chunk_content 形如 'N chunks', N>0）补建 RagSource(active)。

    幂等——已有 RagSource 的跳过。RAG 解耦上线后用于兼容历史已索引文件。
    """
    stmt = select(FileDocumentModel).where(FileDocumentModel.deleted_at.is_(None))
    docs = (await db.execute(stmt)).scalars().all()
    count = 0
    for doc in docs:
        content = doc.chunk_content or ""
        if not content.endswith("chunks") or content == "0 chunks":
            continue
        try:
            user_id = int(doc.user_id)
        except (TypeError, ValueError):
            continue
        if await get_rag_source(db, user_id, "file", doc.id) is not None:
            continue
        db.add(
            RagSourceModel(
                user_id=user_id,
                resource_type="file",
                resource_id=doc.id,
                index_status="active",
                collection_name=doc.collection_name,
            )
        )
        count += 1
    await db.commit()
    return count
