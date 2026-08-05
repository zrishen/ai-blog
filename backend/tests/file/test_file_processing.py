"""File processing job progress, isolation, staging, and compensation tests."""

import asyncio
import io
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.files import upload_to_file_library
from src.database.models import FileDocument, FileProcessingJob, User
from src.main import app
from src.services.file import file_processing_service, file_service
from src.services.file.file_processing_service import (
    PROGRESS_MODELS,
    STALE_RUNNING_AFTER,
    _claim_job,
    _index_document_knowledge,
    _run_job,
    calculate_progress_percent,
    empty_progress,
    reconcile_jobs,
)
from src.utils.auth import get_current_user


def _request_headers() -> dict[str, str]:
    return {"X-File-Request-Id": str(uuid.uuid4())}


@pytest.mark.asyncio
async def test_index_document_knowledge_links_chunks_to_consolidated_knowledge(
    db_session: AsyncSession,
    monkeypatch,
):
    monkeypatch.setattr(file_processing_service.settings, "memory_enabled", True)
    llm = object()

    async def get_llm(*args, **kwargs):
        return llm

    async def link_document(**kwargs):
        assert kwargs["resource_type"] == "file"
        assert kwargs["resource_id"] == 42
        return "document-1"

    extracted_payloads: list[dict] = []

    async def extract(chunk, received_llm):
        assert received_llm is llm
        return {
            "entities": [{"name": chunk}],
            "facts": [{"subject_name": chunk, "predicate": "mentions", "object_text": "knowledge"}],
            "episodes": [{"kind": "chat", "summary": "must not persist"}],
        }

    async def consolidate(*, user_id, extracted):
        assert user_id == 7
        extracted_payloads.append(extracted)
        count = len(extracted_payloads)
        return {"entities": [(f"entity-{count}", True)], "facts": [f"fact-{count}"], "episodes": []}

    mentions: list[tuple[str, int, list[str]]] = []
    sources: list[tuple[str, list[str], list[str]]] = []

    async def link_mentions(*, user_id, stored_name, chunk_index, entity_ids):
        mentions.append((stored_name, chunk_index, entity_ids))

    async def link_sources(*, doc_id, entity_ids, fact_ids):
        sources.append((doc_id, entity_ids, fact_ids))

    progress: list[tuple[str, int, int, str]] = []

    async def report(stage, completed, total, unit):
        progress.append((stage, completed, total, unit))

    monkeypatch.setattr(file_processing_service, "_get_document_memory_llm", get_llm)
    monkeypatch.setattr(file_processing_service.graph_store, "link_document", link_document)
    monkeypatch.setattr(file_processing_service.extractor, "extract", extract)
    monkeypatch.setattr(file_processing_service.consolidator, "consolidate", consolidate)
    monkeypatch.setattr(file_processing_service.graph_store, "link_chunk_entities", link_mentions)
    monkeypatch.setattr(file_processing_service.graph_store, "link_document_knowledge", link_sources)

    job = SimpleNamespace(
        job_type="index",
        target_resource_type="file",
        target_resource_id=42,
        user_id=7,
        original_name="source.pdf",
        stored_name="source.pdf",
    )
    await _index_document_knowledge(db_session, job, ["first chunk", "second chunk"], report)

    assert mentions == [
        ("source.pdf", 0, ["entity-1"]),
        ("source.pdf", 1, ["entity-2"]),
    ]
    assert sources == [
        ("document-1", ["entity-1"], ["fact-1"]),
        ("document-1", ["entity-2"], ["fact-2"]),
    ]
    assert [payload["episodes"] for payload in extracted_payloads] == [[], []]
    assert [payload["facts"][0]["source_doc_id"] for payload in extracted_payloads] == [
        "document-1",
        "document-1",
    ]
    assert progress == [
        ("brain_extract", 0, 2, "chunk"),
        ("brain_extract", 1, 2, "chunk"),
        ("brain_extract", 2, 2, "chunk"),
    ]


def test_progress_models_match_contract_and_finalize_caps_before_success():
    assert PROGRESS_MODELS["upload_v1"] == {
        "browser_upload": 25,
        "persist_file": 5,
        "cleanup_index": 2,
        "parse": 13,
        "chunk": 5,
        "embedding": 25,
        "metadata": 5,
        "vector_store": 15,
        "finalize": 5,
    }
    assert sum(PROGRESS_MODELS["upload_v1"].values()) == 100
    assert sum(PROGRESS_MODELS["restore_v1"].values()) == 100
    assert PROGRESS_MODELS["index_v1"] == {
        "cleanup_index": 2,
        "parse": 10,
        "chunk": 5,
        "embedding": 35,
        "metadata": 5,
        "vector_store": 23,
        "brain_extract": 15,
        "finalize": 5,
    }
    assert sum(PROGRESS_MODELS["index_v1"].values()) == 100

    progress = empty_progress("upload_v1")
    assert progress["model_version"] == "upload_v1"
    assert progress["current_stage"] == "browser_upload"
    for stage in progress["stages"]:
        progress["stages"][stage] = {"completed": 1, "total": 1, "unit": "operation"}
    assert calculate_progress_percent("upload_v1", progress, status="running") == 99
    assert calculate_progress_percent("upload_v1", progress, status="succeeded") == 100

    restore = empty_progress("restore_v1")
    for stage in restore["stages"]:
        restore["stages"][stage] = {"completed": 1, "total": 1, "unit": "operation"}
    assert calculate_progress_percent("restore_v1", restore, status="running") == 99
    assert calculate_progress_percent("restore_v1", restore, status="succeeded") == 100


@pytest.mark.asyncio
async def test_upload_returns_202_before_document_is_visible(
    client: AsyncClient,
    db_session: AsyncSession,
):
    response = await client.post(
        "/api/v1/files/documents",
        files={"file": ("queued.pdf", io.BytesIO(b"%PDF-1.4 queued"), "application/pdf")},
        headers=_request_headers(),
    )
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert body["progress_percent"] == 30
    assert body["progress_json"]["model_version"] == "upload_v1"
    assert body["progress_json"]["current_stage"] == "finalize"
    assert body["progress_json"]["stages"]["browser_upload"]["completed"] == 1
    assert body["progress_json"]["stages"]["persist_file"]["completed"] == 1
    job = await db_session.get(FileProcessingJob, body["id"])
    assert job.staging_path is None
    assert not (file_service.get_user_upload_dir(job.user_id) / ".processing" / f"{job.id}.part").exists()
    documents = (await db_session.execute(select(FileDocument))).scalars().all()
    assert documents == []


@pytest.mark.asyncio
async def test_upload_requires_uuid_header_and_rejects_empty_file(client: AsyncClient):
    missing = await client.post(
        "/api/v1/files/documents",
        files={"file": ("x.pdf", io.BytesIO(b"x"), "application/pdf")},
    )
    assert missing.status_code == 422

    invalid = await client.post(
        "/api/v1/files/documents",
        files={"file": ("x.pdf", io.BytesIO(b"x"), "application/pdf")},
        headers={"X-File-Request-Id": "not-a-uuid"},
    )
    assert invalid.status_code == 400

    empty = await client.post(
        "/api/v1/files/documents",
        files={"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")},
        headers=_request_headers(),
    )
    assert empty.status_code == 400
    assert "empty" in empty.json()["detail"].lower()


@pytest.mark.asyncio
async def test_upload_enforces_actual_chunked_size_limit(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(file_service, "MAX_FILE_SIZE", 3)
    monkeypatch.setattr("src.api.files.MAX_FILE_SIZE", 3)
    response = await client.post(
        "/api/v1/files/documents",
        files={"file": ("large.pdf", io.BytesIO(b"1234"), "application/pdf")},
        headers=_request_headers(),
    )
    assert response.status_code == 400
    assert "100MB" in response.json()["detail"]


@pytest.mark.asyncio
async def test_upload_cancellation_cleans_staging_file_and_releases_active_job(
    db_session: AsyncSession,
    monkeypatch,
):
    user = User(username="cancel-user", password_hash="x")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    upload = UploadFile(
        filename="cancelled.pdf",
        file=io.BytesIO(b"%PDF-1.4 cancelled"),
        headers={"content-type": "application/pdf"},
    )

    async def cancel_on_read(*args, **kwargs):
        raise asyncio.CancelledError

    monkeypatch.setattr(upload, "read", cancel_on_read)
    request_id = str(uuid.uuid4())
    with pytest.raises(asyncio.CancelledError):
        await upload_to_file_library(
            file=upload,
            x_file_request_id=request_id,
            db=db_session,
            user=user,
        )

    job = (
        await db_session.execute(
            select(FileProcessingJob).where(
                FileProcessingJob.user_id == user.id,
                FileProcessingJob.client_request_id == request_id,
            )
        )
    ).scalar_one()
    assert job.status == "failed"
    assert job.error_code == "UPLOAD_CANCELLED"
    assert job.active_key is None
    assert job.staging_path is not None
    assert not Path(job.staging_path).exists()
    assert not (file_service.get_user_upload_dir(user.id) / job.stored_name).exists()


@pytest.mark.asyncio
async def test_upload_request_id_is_idempotent_and_job_list_filters(client: AsyncClient):
    request_id = str(uuid.uuid4())
    headers = {"X-File-Request-Id": request_id}
    first = await client.post(
        "/api/v1/files/documents",
        files={"file": ("first.pdf", io.BytesIO(b"%PDF-1.4 first"), "application/pdf")},
        headers=headers,
    )
    second = await client.post(
        "/api/v1/files/documents",
        files={"file": ("second.pdf", io.BytesIO(b"%PDF-1.4 second"), "application/pdf")},
        headers=headers,
    )
    assert first.status_code == 202
    assert second.status_code == 202
    assert second.json()["id"] == first.json()["id"]

    filtered = await client.get(
        "/api/v1/files/processing-jobs",
        params={"active_only": "true", "client_request_id": request_id},
    )
    assert filtered.status_code == 200
    assert [job["id"] for job in filtered.json()] == [first.json()["id"]]

    conflict = await client.post(
        "/api/v1/files/documents",
        files={"file": ("other.pdf", io.BytesIO(b"%PDF-1.4 other"), "application/pdf")},
        headers=_request_headers(),
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"].startswith("FILE_PROCESSING_ACTIVE:")


@pytest.mark.asyncio
async def test_processing_job_query_is_user_isolated(client: AsyncClient):
    response = await client.post(
        "/api/v1/files/documents",
        files={"file": ("private.pdf", io.BytesIO(b"%PDF-1.4 private"), "application/pdf")},
        headers=_request_headers(),
    )
    job_id = response.json()["id"]

    async def other_user():
        return User(id=909, username="other", password_hash="x")

    original = app.dependency_overrides.get(get_current_user)
    try:
        app.dependency_overrides[get_current_user] = other_user
        assert (await client.get(f"/api/v1/files/processing-jobs/{job_id}")).status_code == 404
        assert (await client.get("/api/v1/files/processing-jobs")).json() == []
    finally:
        if original is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = original


@pytest.mark.asyncio
async def test_claim_job_only_claims_queued_job_once(
    client: AsyncClient,
    db_session: AsyncSession,
):
    response = await client.post(
        "/api/v1/files/documents",
        files={"file": ("claim.pdf", io.BytesIO(b"%PDF-1.4 claim"), "application/pdf")},
        headers=_request_headers(),
    )
    job_id = response.json()["id"]
    first = await _claim_job(db_session, job_id)
    second = await _claim_job(db_session, job_id)
    assert first is not None
    assert second is None


@pytest.mark.asyncio
async def test_reconcile_only_requeues_stale_running_and_preserves_fresh_timestamps(
    db_session: AsyncSession,
    monkeypatch,
):
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def make_job(job_id: str, status: str, heartbeat_at: datetime | None, updated_at: datetime):
        model = "upload_v1"
        return FileProcessingJob(
            id=job_id,
            user_id=1,
            job_type="upload",
            status=status,
            current_stage="parse",
            progress_model_version=model,
            progress_percent=32,
            progress_json=empty_progress(model, "parse"),
            client_request_id=str(uuid.uuid4()),
            original_name=f"{job_id}.pdf",
            stored_name=f"{job_id}.pdf",
            collection_name="user_1_file_test",
            active_key=f"test:{job_id}",
            attempt_count=1,
            execution_token=f"token-{job_id}" if status == "running" else None,
            heartbeat_at=heartbeat_at,
            created_at=updated_at,
            updated_at=updated_at,
        )

    stale_time = now - STALE_RUNNING_AFTER - timedelta(seconds=1)
    fresh_time = now - timedelta(seconds=1)
    stale = make_job("stale-running", "running", stale_time, stale_time)
    fresh = make_job("fresh-running", "running", fresh_time, fresh_time)
    staging = make_job("fresh-staging", "staging", None, fresh_time)
    db_session.add_all([stale, fresh, staging])
    await db_session.commit()
    stale_id, fresh_id, staging_id = stale.id, fresh.id, staging.id

    scheduled: list[str] = []
    delayed: list[tuple[str, float]] = []
    monkeypatch.setattr(file_processing_service, "schedule_job", scheduled.append)
    monkeypatch.setattr(
        file_processing_service,
        "_schedule_reconcile",
        lambda job_id, delay: delayed.append((job_id, delay)),
    )
    await reconcile_jobs()

    db_session.expire_all()
    stale_after = await db_session.get(FileProcessingJob, stale_id)
    fresh_after = await db_session.get(FileProcessingJob, fresh_id)
    staging_after = await db_session.get(FileProcessingJob, staging_id)
    assert stale_after.status == "queued"
    assert stale_after.execution_token is None
    assert scheduled == [stale_id]
    assert fresh_after.status == "running"
    assert fresh_after.updated_at == fresh_time
    assert staging_after.status == "staging"
    assert staging_after.updated_at == fresh_time
    assert delayed and delayed[0][0] == fresh_id


@pytest.mark.asyncio
async def test_delayed_reconcile_can_reschedule_same_job(monkeypatch):
    job_id = "fresh-running"
    replacement_tasks: list[asyncio.Task] = []

    async def fake_reconcile():
        file_processing_service._schedule_reconcile(job_id, 60)
        replacement_tasks.append(file_processing_service._reconcile_registry[job_id])

    monkeypatch.setattr(file_processing_service, "reconcile_jobs", fake_reconcile)
    file_processing_service._schedule_reconcile(job_id, 0)
    first = file_processing_service._reconcile_registry[job_id]
    await first

    replacement = replacement_tasks[0]
    assert replacement is not first
    assert file_processing_service._reconcile_registry[job_id] is replacement
    replacement.cancel()
    with pytest.raises(asyncio.CancelledError):
        await replacement
    await asyncio.sleep(0)
    assert job_id not in file_processing_service._reconcile_registry


@pytest.mark.asyncio
async def test_upload_failure_cleans_document_chunks_and_file(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    response = await client.post(
        "/api/v1/files/documents",
        files={"file": ("failure.pdf", io.BytesIO(b"%PDF-1.4 failure"), "application/pdf")},
        data={"auto_index": "true"},
        headers=_request_headers(),
    )
    job_id = response.json()["id"]
    job = await db_session.get(FileProcessingJob, job_id)
    upload_path = file_service.get_user_upload_dir(job.user_id) / job.stored_name
    assert upload_path.exists()

    cleanup_calls: list[tuple[str, str]] = []

    async def cleanup(collection: str, stored: str):
        cleanup_calls.append((collection, stored))
        return True

    async def fail_vectorize(*args, **kwargs):
        raise RuntimeError("embedding unavailable")

    monkeypatch.setattr(file_processing_service.graph_store, "delete_document_chunks", cleanup)
    monkeypatch.setattr(file_processing_service, "vectorize_and_store", fail_vectorize)
    await _run_job(job_id)

    db_session.expire_all()
    failed = await db_session.get(FileProcessingJob, job_id)
    assert failed.status == "failed"
    assert failed.error_code == "FILE_PROCESSING_FAILED"
    assert failed.result_document_id is None
    assert not upload_path.exists()
    assert len(cleanup_calls) >= 2
    assert (await db_session.execute(select(FileDocument))).scalars().all() == []


@pytest.mark.asyncio
async def test_upload_without_auto_index_skips_vectorization(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    """上传默认不索引：_run_job 不调 vectorize，FileDocument 标记 not indexed。"""
    vectorize_calls: list[int] = []

    async def spy_vectorize(*args, **kwargs):
        vectorize_calls.append(1)
        return ["chunk"]

    monkeypatch.setattr(file_processing_service, "vectorize_and_store", spy_vectorize)

    response = await client.post(
        "/api/v1/files/documents",
        files={"file": ("plain.pdf", io.BytesIO(b"%PDF-1.4 plain"), "application/pdf")},
        headers=_request_headers(),
    )
    job_id = response.json()["id"]
    await _run_job(job_id)

    db_session.expire_all()
    job = await db_session.get(FileProcessingJob, job_id)
    assert job.status == "succeeded"
    assert job.result_document_id is not None
    doc = await db_session.get(FileDocument, job.result_document_id)
    assert doc.chunk_content == "not indexed"
    assert vectorize_calls == []


@pytest.mark.asyncio
async def test_active_restore_blocks_purge_and_empty_trash_is_partial(
    client: AsyncClient,
    db_session: AsyncSession,
):
    source = file_service.get_user_upload_dir(1) / f"restore-{uuid.uuid4().hex}.pdf"
    source.write_bytes(b"%PDF-1.4 restore")
    doc = FileDocument(
        collection_name="user_1_file_test",
        user_id="1",
        original_name="restore.pdf",
        file_path=source.name,
        chunk_content="1 chunks",
        meta="",
        deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    restore = await client.post(f"/api/v1/trash/file_document/{doc.id}/restore")
    assert restore.status_code == 202
    assert restore.json()["job_type"] == "restore"

    purge = await client.delete(f"/api/v1/trash/file_document/{doc.id}")
    assert purge.status_code == 409
    assert purge.json()["detail"].startswith("FILE_PROCESSING_ACTIVE:")

    empty = await client.delete("/api/v1/trash")
    assert empty.status_code == 200
    assert empty.json()["status"] == "partial"
    assert any(item["code"] == "FILE_PROCESSING_ACTIVE" for item in empty.json()["failed"])


@pytest.mark.asyncio
async def test_purge_file_document_removes_ai_knowledge(client: AsyncClient, db_session: AsyncSession):
    """永久删除文件时关联删除 RagSource，避免 AI 知识列表残留孤儿。"""
    from src.services.workspace import rag_service

    source = file_service.get_user_upload_dir(1) / f"purge-rag-{uuid.uuid4().hex}.pdf"
    source.write_bytes(b"%PDF-1.4 purge")
    doc = FileDocument(
        collection_name="user_1_file_test",
        user_id="1",
        original_name="purge.pdf",
        file_path=source.name,
        chunk_content="2 chunks",
        meta="",
        deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)
    doc_id = doc.id

    await rag_service.add_to_ai_knowledge(db_session, 1, resource_type="file", resource_id=doc_id)
    await rag_service.mark_indexed(db_session, 1, "file", doc_id)

    resp = await client.delete(f"/api/v1/trash/file_document/{doc_id}")
    assert resp.status_code == 200

    db_session.expire_all()
    assert await rag_service.get_rag_source(db_session, 1, "file", doc_id) is None
