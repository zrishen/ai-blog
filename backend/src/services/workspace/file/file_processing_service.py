"""Durable background jobs for file-library upload and restore processing."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import math
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost, FileDocument, FileProcessingJob, User
from src.database.session import async_session
from src.services.infra.llm.llm_factory import _chat_model_kwargs, _create_llm
from src.services.workspace.blog.blog_body_service import get_post_body
from src.services.workspace.file.file_service import delete_uploaded_file, vectorize_and_store, vectorize_text_and_store
from src.services.infra.llm.llm_settings_service import get_user_llm_settings, has_usable_api_key
from src.services.memory import consolidator, extractor, graph_store
from src.services.accounts.subscription.subscription_service import should_use_platform_key

logger = logging.getLogger(__name__)


class FileProcessingActiveError(RuntimeError):
    def __init__(self, job: FileProcessingJob):
        super().__init__("A file upload is already being processed")
        self.job = job


@dataclass(frozen=True)
class _BlogBodySnapshot:
    body: str
    sha256: str


PROGRESS_MODELS: dict[str, dict[str, int]] = {
    "upload_v1": {
        "browser_upload": 25,
        "persist_file": 5,
        "cleanup_index": 2,
        "parse": 13,
        "chunk": 5,
        "embedding": 25,
        "metadata": 5,
        "vector_store": 15,
        "finalize": 5,
    },
    "restore_v1": {
        "cleanup_index": 2,
        "parse": 18,
        "chunk": 5,
        "embedding": 35,
        "metadata": 5,
        "vector_store": 30,
        "finalize": 5,
    },
    # 「加入 AI 知识」索引：file 走 vectorize_and_store（含 parse），blog 走
    # vectorize_text_and_store（无 parse，瞬间跳过该段权重）。
    "index_v1": {
        "cleanup_index": 2,
        "parse": 10,
        "chunk": 5,
        "embedding": 35,
        "metadata": 5,
        "vector_store": 23,
        "brain_extract": 15,
        "finalize": 5,
    },
}
ACTIVE_STATUSES = ("staging", "queued", "running")
MAX_ATTEMPTS = 3
STALE_RUNNING_AFTER = timedelta(minutes=5)
STALE_STAGING_AFTER = timedelta(hours=1)
HEARTBEAT_INTERVAL_SECONDS = 10.0

_task_registry: dict[str, asyncio.Task] = {}
_reconcile_registry: dict[str, asyncio.Task] = {}
# 按 event loop 缓存并发信号量：{"global": 全局封顶 Semaphore, "users": {user_id: 单用户上限 Semaphore}}
_worker_semaphores: dict[int, dict[str, Any]] = {}


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _worker_concurrency_state() -> tuple[Any, asyncio.Semaphore]:
    """返回 (user_sem_factory, global_sem)。

    global_sem 为全系统共享的并发封顶；user_sem_factory(user_id) 按 user_id 缓存单用户上限。
    acquire 顺序须 per-user 先、全局后（见 _run_job），避免拿着全局槽卡在 per-user 上空等。
    """
    loop_id = id(asyncio.get_running_loop())
    state = _worker_semaphores.get(loop_id)
    if state is None:
        state = {
            "global": asyncio.Semaphore(settings.file_processing_concurrency),
            "users": {},
        }
        _worker_semaphores.clear()
        _worker_semaphores[loop_id] = state

    def user_sem(user_id: int) -> asyncio.Semaphore:
        semaphore = state["users"].get(user_id)
        if semaphore is None:
            semaphore = asyncio.Semaphore(settings.file_processing_user_concurrency)
            state["users"][user_id] = semaphore
        return semaphore

    return user_sem, state["global"]


def _normalize_progress(
    progress_json: dict[str, Any] | None,
    model_version: str,
    current_stage: str,
) -> dict[str, Any]:
    if not progress_json or not isinstance(progress_json.get("stages"), dict):
        return empty_progress(model_version, current_stage)
    progress = {
        "model_version": progress_json.get("model_version") or model_version,
        "current_stage": progress_json.get("current_stage") or current_stage,
        "stages": dict(progress_json["stages"]),
    }
    for stage in PROGRESS_MODELS[model_version]:
        progress["stages"].setdefault(
            stage,
            {"completed": 0, "total": 1, "unit": "operation"},
        )
    return progress


def empty_progress(model_version: str, current_stage: str | None = None) -> dict[str, Any]:
    first_stage = current_stage or next(iter(PROGRESS_MODELS[model_version]))
    return {
        "model_version": model_version,
        "current_stage": first_stage,
        "stages": {
            stage: {"completed": 0, "total": 1, "unit": "operation"}
            for stage in PROGRESS_MODELS[model_version]
        },
    }


def calculate_progress_percent(
    model_version: str,
    progress_json: dict[str, Any],
    *,
    status: str | None = None,
) -> int:
    weighted = 0.0
    stages = progress_json.get("stages") or {}
    for stage, weight in PROGRESS_MODELS[model_version].items():
        value = stages.get(stage) or {}
        completed = max(0, int(value.get("completed", 0) or 0))
        total = max(1, int(value.get("total", 1) or 1))
        weighted += weight * min(1.0, completed / total)
    percent = math.floor(weighted)
    if status != "succeeded":
        return min(percent, 99)
    return 100


def _active_key(
    job_type: str,
    user_id: int,
    source_document_id: int | None,
    *,
    target_resource_type: str | None = None,
    target_resource_id: int | None = None,
) -> str:
    if job_type == "restore":
        return f"restore:{user_id}:{source_document_id}"
    if job_type == "index":
        return f"index:{user_id}:{target_resource_type}:{target_resource_id}"
    return f"upload:{user_id}"


async def get_job(db: AsyncSession, *, job_id: str, user_id: int) -> FileProcessingJob | None:
    return (
        await db.execute(
            select(FileProcessingJob).where(
                FileProcessingJob.id == job_id,
                FileProcessingJob.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def list_jobs(
    db: AsyncSession,
    *,
    user_id: int,
    active_only: bool = False,
    client_request_id: str | None = None,
) -> list[FileProcessingJob]:
    stmt = select(FileProcessingJob).where(FileProcessingJob.user_id == user_id)
    if active_only:
        stmt = stmt.where(FileProcessingJob.status.in_(ACTIVE_STATUSES))
    if client_request_id:
        stmt = stmt.where(FileProcessingJob.client_request_id == client_request_id)
    result = await db.execute(stmt.order_by(FileProcessingJob.created_at.desc()))
    return list(result.scalars().all())


async def create_or_reuse_upload_job(
    db: AsyncSession,
    *,
    user_id: int,
    client_request_id: str,
    original_name: str,
    stored_name: str,
    collection_name: str,
    processing_dir: Path,
    auto_index: bool = False,
) -> tuple[FileProcessingJob, bool]:
    existing = (
        await db.execute(
            select(FileProcessingJob).where(
                FileProcessingJob.user_id == user_id,
                FileProcessingJob.client_request_id == client_request_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing, False

    active_key = _active_key("upload", user_id, None)
    active = (
        await db.execute(
            select(FileProcessingJob).where(FileProcessingJob.active_key == active_key)
        )
    ).scalar_one_or_none()
    if active:
        raise FileProcessingActiveError(active)

    now = utcnow()
    job_id = str(uuid.uuid4())
    job = FileProcessingJob(
        id=job_id,
        user_id=user_id,
        job_type="upload",
        status="staging",
        current_stage="browser_upload",
        progress_model_version="upload_v1",
        progress_percent=0,
        progress_json=empty_progress("upload_v1"),
        client_request_id=client_request_id,
        original_name=original_name,
        stored_name=stored_name,
        collection_name=collection_name,
        auto_index=auto_index,
        staging_path=str(processing_dir / f"{job_id}.part"),
        active_key=active_key,
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (
            await db.execute(
                select(FileProcessingJob).where(
                    FileProcessingJob.user_id == user_id,
                    FileProcessingJob.client_request_id == client_request_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return existing, False
        active = (
            await db.execute(
                select(FileProcessingJob).where(FileProcessingJob.active_key == active_key)
            )
        ).scalar_one_or_none()
        if active:
            raise FileProcessingActiveError(active)
        raise
    await db.refresh(job)
    return job, True


async def create_or_reuse_restore_job(
    db: AsyncSession,
    *,
    user_id: int,
    source_document: FileDocument,
    client_request_id: str | None = None,
) -> FileProcessingJob:
    active_key = _active_key("restore", user_id, source_document.id)
    existing = (
        await db.execute(
            select(FileProcessingJob).where(FileProcessingJob.active_key == active_key)
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    request_id = client_request_id or str(uuid.uuid4())
    now = utcnow()
    job = FileProcessingJob(
        id=str(uuid.uuid4()),
        user_id=user_id,
        job_type="restore",
        status="queued",
        current_stage="cleanup_index",
        progress_model_version="restore_v1",
        progress_percent=0,
        progress_json=empty_progress("restore_v1"),
        client_request_id=request_id,
        source_document_id=source_document.id,
        original_name=source_document.original_name,
        stored_name=source_document.file_path,
        collection_name=source_document.collection_name,
        active_key=active_key,
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return (
            await db.execute(
                select(FileProcessingJob).where(FileProcessingJob.active_key == active_key)
            )
        ).scalar_one()
    await db.refresh(job)
    return job


async def create_or_reuse_index_job(
    db: AsyncSession,
    *,
    user_id: int,
    target_resource_type: str,
    target_resource_id: int,
    collection_name: str,
    original_name: str,
    stored_name: str,
    client_request_id: str | None = None,
) -> FileProcessingJob:
    """创建「加入 AI 知识」索引 job（幂等：同一资源已有活跃 index job 则复用；stored_name 同时是向量删除键，file=doc.file_path，blog=f"blog_post:{id}"）。"""
    active_key = _active_key(
        "index",
        user_id,
        None,
        target_resource_type=target_resource_type,
        target_resource_id=target_resource_id,
    )
    existing = (
        await db.execute(
            select(FileProcessingJob).where(FileProcessingJob.active_key == active_key)
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    request_id = client_request_id or str(uuid.uuid4())
    now = utcnow()
    job = FileProcessingJob(
        id=str(uuid.uuid4()),
        user_id=user_id,
        job_type="index",
        status="queued",
        current_stage="cleanup_index",
        progress_model_version="index_v1",
        progress_percent=0,
        progress_json=empty_progress("index_v1"),
        client_request_id=request_id,
        original_name=original_name,
        stored_name=stored_name,
        collection_name=collection_name,
        target_resource_type=target_resource_type,
        target_resource_id=target_resource_id,
        active_key=active_key,
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return (
            await db.execute(
                select(FileProcessingJob).where(FileProcessingJob.active_key == active_key)
            )
        ).scalar_one()
    await db.refresh(job)
    return job


async def fail_staging_job(
    db: AsyncSession,
    job: FileProcessingJob,
    *,
    error_code: str,
    error_message: str,
) -> None:
    now = utcnow()
    job.status = "failed"
    job.error_code = error_code
    job.error_message = error_message
    job.finished_at = now
    job.updated_at = now
    job.active_key = None
    await db.commit()


async def mark_upload_queued(db: AsyncSession, job: FileProcessingJob) -> None:
    next_stage = "finalize" if not job.auto_index else "cleanup_index"
    progress = _normalize_progress(job.progress_json, "upload_v1", "browser_upload")
    progress["stages"]["browser_upload"] = {"completed": 1, "total": 1, "unit": "file"}
    progress["stages"]["persist_file"] = {"completed": 1, "total": 1, "unit": "file"}
    progress["current_stage"] = next_stage
    job.progress_json = progress
    job.progress_percent = calculate_progress_percent("upload_v1", progress, status="queued")
    job.status = "queued"
    job.current_stage = next_stage
    job.staging_path = None
    job.updated_at = utcnow()
    await db.commit()
    await db.refresh(job)


async def has_active_restore(db: AsyncSession, *, user_id: int, source_document_id: int) -> bool:
    result = await db.execute(
        select(FileProcessingJob.id).where(
            FileProcessingJob.user_id == user_id,
            FileProcessingJob.source_document_id == source_document_id,
            FileProcessingJob.job_type == "restore",
            FileProcessingJob.status.in_(ACTIVE_STATUSES),
        ).limit(1)
    )
    return result.first() is not None


def schedule_job(job_id: str) -> None:
    current = _task_registry.get(job_id)
    if current and not current.done():
        return
    task = asyncio.create_task(_run_job(job_id), name=f"file-processing-{job_id}")
    _task_registry[job_id] = task
    task.add_done_callback(lambda finished, key=job_id: _task_registry.pop(key, None))


async def cancel_jobs_for_resource(
    db: AsyncSession, *, user_id: int, resource_type: str, resource_id: int
) -> None:
    """取消并终结某资源进行中的 index job：从 AI 知识移除资源时调用，避免 job 仍跑完
    浪费 embedding/LLM、写入记忆孤儿，并在 mark_indexed 时因 RagSource 已删而误标 failed。"""
    result = await db.execute(
        select(FileProcessingJob).where(
            FileProcessingJob.user_id == user_id,
            FileProcessingJob.job_type == "index",
            FileProcessingJob.target_resource_type == resource_type,
            FileProcessingJob.target_resource_id == resource_id,
            FileProcessingJob.status.in_(ACTIVE_STATUSES),
        )
    )
    now = utcnow()
    cancelled_any = False
    for job in result.scalars():
        task = _task_registry.pop(job.id, None)
        if task is not None and not task.done():
            task.cancel()
        job.status = "cancelled"
        job.finished_at = now
        job.heartbeat_at = now
        job.updated_at = now
        job.execution_token = None
        job.active_key = None
        cancelled_any = True
    if cancelled_any:
        await db.commit()


async def _update_progress(
    db: AsyncSession,
    job_id: str,
    token: str,
    stage: str,
    completed: int,
    total: int,
    unit: str,
) -> int:
    job = await db.get(FileProcessingJob, job_id)
    if not job or job.execution_token != token or job.status != "running":
        raise RuntimeError("File processing worker is no longer current")
    progress = _normalize_progress(job.progress_json, job.progress_model_version, stage)
    progress["stages"][stage] = {
        "completed": max(0, completed),
        "total": max(1, total),
        "unit": unit,
    }
    progress["current_stage"] = stage
    percent = calculate_progress_percent(job.progress_model_version, progress, status=job.status)
    job.progress_json = progress
    job.current_stage = stage
    job.progress_percent = percent
    job.heartbeat_at = utcnow()
    job.updated_at = job.heartbeat_at
    await db.commit()
    return percent


async def _peek_job_user_id(job_id: str) -> int | None:
    """主键查 job.user_id，用于 acquire 信号量前选 per-user 槽；job 不存在返回 None。"""
    async with async_session() as db:
        row = (await db.execute(
            select(FileProcessingJob.user_id).where(FileProcessingJob.id == job_id)
        )).first()
        return row[0] if row else None


async def _claim_job(db: AsyncSession, job_id: str) -> tuple[FileProcessingJob, str] | None:
    token = str(uuid.uuid4())
    now = utcnow()
    result = await db.execute(
        update(FileProcessingJob)
        .where(
            FileProcessingJob.id == job_id,
            FileProcessingJob.status == "queued",
            FileProcessingJob.attempt_count < MAX_ATTEMPTS,
        )
        .values(
            status="running",
            execution_token=token,
            attempt_count=FileProcessingJob.attempt_count + 1,
            started_at=func.coalesce(FileProcessingJob.started_at, now),
            heartbeat_at=now,
            updated_at=now,
            error_code=None,
            error_message=None,
        )
    )
    if result.rowcount != 1:
        await db.rollback()
        return None
    await db.commit()
    job = await db.get(FileProcessingJob, job_id)
    if not job or job.execution_token != token:
        return None
    return job, token


async def _heartbeat_job(job_id: str, token: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        now = utcnow()
        async with async_session() as heartbeat_db:
            result = await heartbeat_db.execute(
                update(FileProcessingJob)
                .where(
                    FileProcessingJob.id == job_id,
                    FileProcessingJob.execution_token == token,
                    FileProcessingJob.status == "running",
                )
                .values(heartbeat_at=now, updated_at=now)
            )
            await heartbeat_db.commit()
            if result.rowcount != 1:
                return


async def _snapshot_blog_post_body(db: AsyncSession, job: FileProcessingJob) -> _BlogBodySnapshot:
    """Read a blog body and its SHA-256 before destructive index cleanup."""
    post = await db.get(BlogPost, job.target_resource_id)
    if post is None or post.user_id != job.user_id or post.deleted_at is not None:
        raise RuntimeError("Blog post is no longer available for indexing")
    body = await get_post_body(post) or ""
    return _BlogBodySnapshot(
        body=body,
        sha256=hashlib.sha256(body.encode("utf-8")).hexdigest(),
    )


async def _vectorize_blog_post(
    job: FileProcessingJob, snapshot: _BlogBodySnapshot, reporter
) -> list[str]:
    """Vectorize the immutable blog-body snapshot prepared before cleanup."""
    return await vectorize_text_and_store(
        snapshot.body,
        job.collection_name,
        source_id=job.stored_name or f"blog_post:{job.target_resource_id}",
        original_name=job.original_name,
        user_id=job.user_id,
        resource_type="blog_post",
        resource_id=job.target_resource_id,
        progress_reporter=reporter,
    )


async def _get_document_memory_llm(db: AsyncSession, user_id: int):
    user = await db.get(User, user_id)
    if user is None:
        logger.warning("Skipping document knowledge extraction because user %s no longer exists", user_id)
        return None

    use_platform_key = await should_use_platform_key(db, user)
    llm_settings = await get_user_llm_settings(db, user_id)
    if not use_platform_key and llm_settings is None:
        logger.info("Skipping document knowledge extraction for user %s: no usable LLM settings", user_id)
        return None

    model_kwargs = _chat_model_kwargs(
        "fast",
        llm_settings,
        allow_official_fallback=use_platform_key,
    )
    if not has_usable_api_key(model_kwargs):
        logger.info("Skipping document knowledge extraction for user %s: no usable API key", user_id)
        return None
    return _create_llm(model_kwargs, "fast")


async def _index_document_knowledge(
    db: AsyncSession,
    job: FileProcessingJob,
    chunks: list[str],
    progress_reporter=None,
) -> None:
    """Extract document knowledge after raw chunks are safely present in the brain."""
    if (
        not settings.memory_enabled
        or job.job_type != "index"
        or not chunks
        or not job.target_resource_type
        or job.target_resource_id is None
    ):
        if progress_reporter:
            await progress_reporter("brain_extract", 1, 1, "operation")
        return

    llm = await _get_document_memory_llm(db, job.user_id)
    if llm is None:
        if progress_reporter:
            await progress_reporter("brain_extract", 1, 1, "operation")
        return

    doc_id = await graph_store.link_document(
        user_id=job.user_id,
        resource_type=job.target_resource_type,
        resource_id=job.target_resource_id,
        title=job.original_name or job.stored_name or str(job.target_resource_id),
    )
    stored_name = job.stored_name or ""
    if progress_reporter:
        await progress_reporter("brain_extract", 0, len(chunks), "chunk")
    total_entities = 0
    total_facts = 0
    for chunk_index, chunk in enumerate(chunks):
        extracted = await extractor.extract(chunk, llm)
        extracted["episodes"] = []
        for fact in extracted.get("facts", []):
            fact["source_doc_id"] = doc_id
        consolidated = await consolidator.consolidate(user_id=job.user_id, extracted=extracted)
        total_entities += len(consolidated["entities"])
        total_facts += len(consolidated["facts"])
        entity_ids = [entity_id for entity_id, _ in consolidated["entities"]]
        await graph_store.link_chunk_entities(
            user_id=job.user_id, stored_name=stored_name,
            chunk_index=chunk_index, entity_ids=entity_ids,
        )
        await graph_store.link_document_knowledge(
            doc_id=doc_id,
            entity_ids=entity_ids,
            fact_ids=consolidated["facts"],
        )
        if progress_reporter:
            await progress_reporter("brain_extract", chunk_index + 1, len(chunks), "chunk")
    logger.info(
        "document knowledge extracted user_id=%s doc_id=%s chunks=%d entities=%d facts=%d",
        job.user_id, doc_id, len(chunks), total_entities, total_facts,
    )


async def _run_job(job_id: str) -> None:
    _t0 = time.time()
    user_id = await _peek_job_user_id(job_id)
    user_sem, global_sem = _worker_concurrency_state()
    async with contextlib.AsyncExitStack() as stack:
        if user_id is not None:
            await stack.enter_async_context(user_sem(user_id))
        await stack.enter_async_context(global_sem)
        async with async_session() as db:
            claimed = await _claim_job(db, job_id)
            if not claimed:
                return
            job, token = claimed
            heartbeat_task = asyncio.create_task(
                _heartbeat_job(job.id, token),
                name=f"file-processing-heartbeat-{job.id}",
            )
            last_report: tuple[str, int, float] | None = None
            progress_state = _normalize_progress(job.progress_json, job.progress_model_version, job.current_stage)
            cleaned_index = False
            try:
                # auto_index=False（默认）：上传仅存文件 + 建 FileDocument 元记录，不索引；
                # 索引由「加入 AI 知识」(rag_service) 触发。
                if job.job_type == "upload" and not job.auto_index:
                    await _finalize_success(db, job.id, token, [], indexed=False)
                    return
                # restore：从未加入 AI 知识（无 RagSource）的文件不重建向量——用户没把它加入
                # 知识库，恢复也不该顺手索引，避免无谓 embedding/向量成本。文件库软删只清向量、
                # 保留 RagSource，故其存在性即「曾否加入知识库」的可靠判据。
                if job.job_type == "restore" and job.source_document_id is not None:
                    from src.services.workspace import rag_service

                    if await rag_service.get_rag_source(
                        db, job.user_id, "file", job.source_document_id
                    ) is None:
                        await _finalize_success(db, job.id, token, [], indexed=False)
                        return
                blog_snapshot: _BlogBodySnapshot | None = None
                if job.job_type == "index" and job.target_resource_type == "blog_post":
                    blog_snapshot = await _snapshot_blog_post_body(db, job)

                cleaned_index = True
                await graph_store.delete_document_chunks(job.collection_name, job.stored_name or "")
                # 重建索引前完整清理旧记忆（Document/事实/孤立实体），避免新旧事实并存
                if job.job_type == "index" and job.target_resource_type and job.target_resource_id:
                    await graph_store.delete_resource_memory(
                        user_id=job.user_id,
                        resource_type=job.target_resource_type,
                        resource_id=job.target_resource_id,
                    )
                await _update_progress(db, job.id, token, "cleanup_index", 1, 1, "operation")
                progress_state["stages"]["cleanup_index"] = {
                    "completed": 1,
                    "total": 1,
                    "unit": "operation",
                }
                progress_state["current_stage"] = "cleanup_index"

                async def reporter(stage: str, completed: int, total: int, unit: str) -> None:
                    nonlocal last_report
                    progress_state["stages"][stage] = {
                        "completed": max(0, completed),
                        "total": max(1, total),
                        "unit": unit,
                    }
                    progress_state["current_stage"] = stage
                    predicted = calculate_progress_percent(job.progress_model_version, progress_state, status="running")
                    now_monotonic = time.monotonic()
                    should_write = (
                        last_report is None
                        or last_report[0] != stage
                        or last_report[1] != predicted
                        or completed >= total
                        or now_monotonic - last_report[2] >= 0.5
                    )
                    if should_write:
                        persisted = await _update_progress(db, job.id, token, stage, completed, total, unit)
                        last_report = (stage, persisted, now_monotonic)

                if job.job_type == "index" and job.target_resource_type == "blog_post":
                    if blog_snapshot is None:  # pragma: no cover - guarded by the branch above
                        raise RuntimeError("Blog body snapshot was not prepared")
                    chunks = await _vectorize_blog_post(job, blog_snapshot, reporter)
                else:
                    chunks = await vectorize_and_store(
                        job.stored_name or "",
                        job.collection_name,
                        original_name=job.original_name,
                        user_id=job.user_id,
                        resource_type=job.target_resource_type if job.job_type == "index" else None,
                        resource_id=job.target_resource_id if job.job_type == "index" else None,
                        progress_reporter=reporter,
                )
                if job.job_type == "index":
                    await _index_document_knowledge(db, job, chunks, reporter)
                    # 推进 RagSource 状态；file 顺带回写 chunk 数到 FileDocument。
                    from src.services.workspace import rag_service

                    if job.target_resource_type == "file":
                        indexed_doc = await db.get(FileDocument, job.target_resource_id)
                        if indexed_doc is not None:
                            indexed_doc.chunk_content = f"{len(chunks)} chunks"
                        await rag_service.mark_indexed(
                            db,
                            job.user_id,
                            job.target_resource_type,
                            job.target_resource_id,
                            version=str(len(chunks)),
                        )
                    elif job.target_resource_type == "blog_post":
                        if blog_snapshot is None:  # pragma: no cover - guarded by the branch above
                            raise RuntimeError("Blog body snapshot was not prepared")
                        await rag_service.mark_blog_post_indexed_if_current(
                            db,
                            job.user_id,
                            job.target_resource_id,
                            body_sha256=blog_snapshot.sha256,
                        )
                    else:
                        await rag_service.mark_indexed(
                            db,
                            job.user_id,
                            job.target_resource_type,
                            job.target_resource_id,
                            version=str(len(chunks)),
                        )
                logger.info(
                    "file job done job_id=%s job_type=%s user_id=%s resource=%s/%s chunks=%d indexed=True duration_ms=%d",
                    job.id, job.job_type, job.user_id,
                    job.target_resource_type, job.target_resource_id,
                    len(chunks), int((time.time() - _t0) * 1000),
                )
                await _finalize_success(db, job.id, token, chunks, indexed=True)
            except asyncio.CancelledError:
                logger.warning("File processing task cancelled; stale reconciliation will recover: %s", job_id)
                raise
            except Exception as exc:
                logger.exception("File processing job failed: %s", job_id)
                await _finalize_failure(job.id, token, exc, cleanup_vectors=cleaned_index)
            finally:
                heartbeat_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await heartbeat_task


async def _finalize_success(
    db: AsyncSession, job_id: str, token: str, chunks: list[str], *, indexed: bool = True
) -> None:
    await db.rollback()
    job = await db.get(FileProcessingJob, job_id)
    if not job or job.execution_token != token or job.status != "running":
        return
    await db.refresh(job)
    progress = _normalize_progress(job.progress_json, job.progress_model_version, "finalize")
    progress["stages"]["finalize"] = {"completed": 0, "total": 1, "unit": "transaction"}
    if job.job_type == "index":
        # RagSource 已在 _run_job 推进；index 不创建/恢复 FileDocument。
        pass
    elif job.job_type == "upload":
        doc = FileDocument(
            collection_name=job.collection_name,
            user_id=str(job.user_id),
            original_name=job.original_name,
            file_path=job.stored_name,
            chunk_content=f"{len(chunks)} chunks" if indexed else "not indexed",
            meta="",
            created_at=utcnow(),
        )
        db.add(doc)
        await db.flush()
        job.result_document_id = doc.id
    else:
        doc = await db.get(FileDocument, job.source_document_id)
        if not doc or doc.user_id != str(job.user_id) or doc.deleted_at is None:
            raise RuntimeError("Restore source document is no longer available")
        doc.deleted_at = None
        doc.chunk_content = f"{len(chunks)} chunks"
        job.result_document_id = doc.id
        # 文件系统位置不由虚拟归档关系管理；恢复只恢复资源本身。

    progress["stages"]["finalize"] = {"completed": 1, "total": 1, "unit": "transaction"}
    progress["current_stage"] = "finalize"
    now = utcnow()
    job.progress_json = progress
    job.status = "succeeded"
    job.current_stage = "finalize"
    job.progress_percent = calculate_progress_percent(job.progress_model_version, progress, status="succeeded")
    job.finished_at = now
    job.heartbeat_at = now
    job.updated_at = now
    job.execution_token = None
    job.active_key = None
    await db.commit()


async def _finalize_failure(
    job_id: str,
    token: str,
    exc: Exception,
    *,
    cleanup_vectors: bool = True,
) -> None:
    async with async_session() as db:
        job = await db.get(FileProcessingJob, job_id)
        if not job or job.execution_token != token or job.status != "running":
            return
        collection_name = job.collection_name
        stored_name = job.stored_name or ""
        user_id = job.user_id
        job_type = job.job_type
        target_resource_type = job.target_resource_type
        target_resource_id = job.target_resource_id
    if cleanup_vectors:
        try:
            await graph_store.delete_document_chunks(collection_name, stored_name)
        except Exception:
            logger.exception("Failed to clean partial chunks for job %s", job_id)
    if job_type == "upload" and stored_name:
        await asyncio.to_thread(delete_uploaded_file, stored_name, user_id)
    if job_type == "index" and target_resource_type and target_resource_id:
        async with async_session() as fail_db:
            with contextlib.suppress(Exception):
                from src.services.workspace import rag_service

                await rag_service.mark_failed(
                    fail_db,
                    user_id,
                    target_resource_type,
                    target_resource_id,
                    error_message=str(exc)[:2000],
                )
    async with async_session() as db:
        job = await db.get(FileProcessingJob, job_id)
        if not job or job.execution_token != token or job.status != "running":
            return
        now = utcnow()
        job.status = "failed"
        job.error_code = "FILE_PROCESSING_FAILED"
        job.error_message = str(exc)[:2000]
        job.finished_at = now
        job.heartbeat_at = now
        job.updated_at = now
        job.execution_token = None
        job.active_key = None
        await db.commit()


async def _reconcile_after(job_id: str, delay: float) -> None:
    await asyncio.sleep(max(0.0, delay))
    current = asyncio.current_task()
    if _reconcile_registry.get(job_id) is current:
        _reconcile_registry.pop(job_id, None)
    await reconcile_jobs()


def _schedule_reconcile(job_id: str, delay: float) -> None:
    current = _reconcile_registry.get(job_id)
    if current and not current.done():
        return
    task = asyncio.create_task(
        _reconcile_after(job_id, delay),
        name=f"file-processing-reconcile-{job_id}",
    )
    _reconcile_registry[job_id] = task

    def clear_finished(finished: asyncio.Task) -> None:
        if _reconcile_registry.get(job_id) is finished:
            _reconcile_registry.pop(job_id, None)

    task.add_done_callback(clear_finished)


async def reconcile_jobs() -> None:
    now = utcnow()
    async with async_session() as db:
        jobs = (
            await db.execute(
                select(FileProcessingJob).where(
                    or_(
                        FileProcessingJob.status == "queued",
                        FileProcessingJob.status == "running",
                        FileProcessingJob.status == "staging",
                    )
                )
            )
        ).scalars().all()
        to_schedule: list[str] = []
        delayed_reconcile: list[tuple[str, float]] = []
        for job in jobs:
            changed = False
            if job.status == "staging" and job.updated_at < now - STALE_STAGING_AFTER:
                if job.staging_path:
                    path = Path(job.staging_path)
                    if path.suffix == ".part":
                        try:
                            await asyncio.to_thread(path.unlink, missing_ok=True)
                        except OSError:
                            logger.exception("Failed to remove stale staging file: %s", path)
                job.status = "failed"
                job.error_code = "STALE_STAGING"
                job.error_message = "Upload staging did not complete"
                job.finished_at = now
                job.active_key = None
                changed = True
            elif job.status == "running":
                stale_at = (job.heartbeat_at or job.updated_at) + STALE_RUNNING_AFTER
                if stale_at <= now:
                    job.execution_token = None
                    if job.attempt_count < MAX_ATTEMPTS:
                        job.status = "queued"
                        to_schedule.append(job.id)
                    else:
                        job.status = "failed"
                        job.error_code = "MAX_ATTEMPTS_EXCEEDED"
                        job.error_message = "File processing retry limit exceeded"
                        job.finished_at = now
                        job.active_key = None
                    changed = True
                else:
                    delayed_reconcile.append((job.id, (stale_at - now).total_seconds()))
            elif job.status == "queued":
                if job.attempt_count < MAX_ATTEMPTS:
                    to_schedule.append(job.id)
                else:
                    job.status = "failed"
                    job.error_code = "MAX_ATTEMPTS_EXCEEDED"
                    job.error_message = "File processing retry limit exceeded"
                    job.finished_at = now
                    job.active_key = None
                changed = True
            if changed:
                job.updated_at = now
        await db.commit()
    for job_id in to_schedule:
        schedule_job(job_id)
    for job_id, delay in delayed_reconcile:
        _schedule_reconcile(job_id, delay + 0.01)
