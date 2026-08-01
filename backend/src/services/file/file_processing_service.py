"""Durable background jobs for file-library upload and restore processing."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost, FileDocument, FileProcessingJob
from src.database.session import async_session
from src.services.file.file_service import delete_uploaded_file, vectorize_and_store, vectorize_text_and_store
from src.services.rag.vector_store import delete_document_chunks

logger = logging.getLogger(__name__)


class FileProcessingActiveError(RuntimeError):
    def __init__(self, job: FileProcessingJob):
        super().__init__("A file upload is already being processed")
        self.job = job


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
        "vector_store": 38,
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
_worker_semaphores: dict[int, asyncio.Semaphore] = {}


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _worker_semaphore() -> asyncio.Semaphore:
    loop_id = id(asyncio.get_running_loop())
    semaphore = _worker_semaphores.get(loop_id)
    if semaphore is None:
        semaphore = asyncio.Semaphore(1)
        _worker_semaphores.clear()
        _worker_semaphores[loop_id] = semaphore
    return semaphore


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
    progress = _normalize_progress(job.progress_json, "upload_v1", "browser_upload")
    progress["stages"]["browser_upload"] = {"completed": 1, "total": 1, "unit": "file"}
    progress["stages"]["persist_file"] = {"completed": 1, "total": 1, "unit": "file"}
    progress["current_stage"] = "cleanup_index"
    job.progress_json = progress
    job.progress_percent = calculate_progress_percent("upload_v1", progress, status="queued")
    job.status = "queued"
    job.current_stage = "cleanup_index"
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


async def _vectorize_blog_post(
    db: AsyncSession, job: FileProcessingJob, reporter
) -> list[str]:
    """index job 的 blog_post 分支：读 MD 正文 → vectorize_text_and_store。"""
    post = await db.get(BlogPost, job.target_resource_id)
    if post is None or post.user_id != job.user_id or post.deleted_at is not None:
        raise RuntimeError("Blog post is no longer available for indexing")
    body = post.content or ""
    return await vectorize_text_and_store(
        body,
        job.collection_name,
        source_id=job.stored_name or f"blog_post:{post.id}",
        original_name=job.original_name,
        user_id=job.user_id,
        resource_type="blog_post",
        progress_reporter=reporter,
    )


async def _run_job(job_id: str) -> None:
    async with _worker_semaphore():
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
            try:
                # auto_index=False（默认）：上传仅存文件 + 建 FileDocument 元记录，不索引；
                # 索引由「加入 AI 知识」(rag_service) 或目录 auto_index 触发。
                if job.job_type == "upload" and not job.auto_index:
                    await _finalize_success(db, job.id, token, [], indexed=False)
                    return
                await delete_document_chunks(job.collection_name, job.stored_name or "")
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
                    chunks = await _vectorize_blog_post(db, job, reporter)
                else:
                    chunks = await vectorize_and_store(
                        job.stored_name or "",
                        job.collection_name,
                        original_name=job.original_name,
                        user_id=job.user_id,
                        progress_reporter=reporter,
                    )
                if job.job_type == "index":
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
                await _finalize_success(db, job.id, token, chunks, indexed=True)
            except asyncio.CancelledError:
                logger.warning("File processing task cancelled; stale reconciliation will recover: %s", job_id)
                raise
            except Exception as exc:
                logger.exception("File processing job failed: %s", job_id)
                await _finalize_failure(job.id, token, exc)
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
        # 还原后统一回未分类（inbox）：清掉原工作区挂靠点，不论原先挂在哪个目录
        from src.services.workspace.resource_service import detach_resource_if_any

        await detach_resource_if_any(db, job.user_id, "file", doc.id)

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


async def _finalize_failure(job_id: str, token: str, exc: Exception) -> None:
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
    try:
        await delete_document_chunks(collection_name, stored_name)
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
