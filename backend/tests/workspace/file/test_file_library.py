"""文件库测试。"""

import io
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import FileDocument, FileProcessingJob
from src.services.workspace.file import file_service
from src.services.workspace.file.file_processing_service import _run_job
from src.utils import user_dir


# ---- Documents ----

@pytest.mark.asyncio
async def test_upload_file_document(client: AsyncClient):
    file_content = b"%PDF-1.4 File library document content."
    files = {"file": ("file_doc.pdf", io.BytesIO(file_content), "application/pdf")}

    resp = await client.post("/api/v1/files/documents", files=files, headers={"X-File-Request-Id": str(uuid.uuid4())})
    assert resp.status_code == 202
    data = resp.json()
    assert data["job_type"] == "upload"
    assert data["status"] == "queued"
    assert data["progress_percent"] == 30
    assert data["original_name"] == "file_doc.pdf"


@pytest.mark.asyncio
async def test_upload_file_document_passes_numeric_user_id_to_vectorizer(
    client: AsyncClient,
    monkeypatch,
):
    received_user_ids: list[int | str] = []

    async def capture_vectorize(*args, **kwargs):
        received_user_ids.append(kwargs["user_id"])
        return []

    monkeypatch.setattr("src.services.workspace.file.file_processing_service.vectorize_and_store", capture_vectorize)
    files = {"file": ("numeric-id.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}

    response = await client.post("/api/v1/files/documents", files=files, data={"auto_index": "true"}, headers={"X-File-Request-Id": str(uuid.uuid4())})
    await _run_job(response.json()["id"])

    assert response.status_code == 202
    assert len(received_user_ids) == 1
    assert isinstance(received_user_ids[0], int)


def test_numeric_user_id_resolves_username_upload_directory(tmp_path, monkeypatch):
    from src.config import settings

    workspace_root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(workspace_root))
    monkeypatch.setitem(user_dir._username_cache, 7, "named-user")

    assert file_service.get_user_upload_dir(7) == workspace_root / "named-user" / "uploads"


@pytest.mark.asyncio
async def test_list_file_documents(client: AsyncClient):
    resp = await client.get("/api/v1/files/documents")
    assert resp.status_code == 200
    data = resp.json()
    assert "documents" in data
    assert isinstance(data["documents"], list)


@pytest.mark.asyncio
async def test_update_file_document_rename(client: AsyncClient, db_session: AsyncSession):
    files = {"file": ("old_name.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/v1/files/documents", files=files, headers={"X-File-Request-Id": str(uuid.uuid4())})
    await _run_job(doc_resp.json()["id"])
    job = await db_session.get(FileProcessingJob, doc_resp.json()["id"])
    doc_id = job.result_document_id

    resp = await client.patch(f"/api/v1/files/documents/{doc_id}", json={
        "original_name": "  新名称.pdf  ",
    })
    assert resp.status_code == 200

    refreshed = await db_session.get(FileDocument, doc_id)
    assert refreshed is not None
    assert refreshed.original_name == "新名称.pdf"


@pytest.mark.asyncio
async def test_update_file_document_rejects_empty_name(client: AsyncClient, db_session: AsyncSession):
    files = {"file": ("ok.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/v1/files/documents", files=files, headers={"X-File-Request-Id": str(uuid.uuid4())})
    await _run_job(doc_resp.json()["id"])
    job = await db_session.get(FileProcessingJob, doc_resp.json()["id"])
    doc_id = job.result_document_id

    resp = await client.patch(f"/api/v1/files/documents/{doc_id}", json={
        "original_name": "   ",
    })
    assert resp.status_code == 400

    resp_missing = await client.patch("/api/v1/files/documents/999999", json={
        "original_name": "新名",
    })
    assert resp_missing.status_code == 404


@pytest.mark.asyncio
async def test_delete_file_document(client: AsyncClient, db_session: AsyncSession):
    files = {"file": ("del_doc.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/v1/files/documents", files=files, headers={"X-File-Request-Id": str(uuid.uuid4())})
    await _run_job(doc_resp.json()["id"])
    job = await db_session.get(FileProcessingJob, doc_resp.json()["id"])
    doc_id = job.result_document_id

    resp = await client.delete(f"/api/v1/files/documents/{doc_id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_list_file_collections(client: AsyncClient):
    resp = await client.get("/api/v1/files/collections")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_delete_file_collection_keeps_failed_document_active(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    for name in ("collection-a.pdf", "collection-b.pdf"):
        files = {"file": (name, io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
        response = await client.post("/api/v1/files/documents", files=files, headers={"X-File-Request-Id": str(uuid.uuid4())})
        assert response.status_code == 202
        await _run_job(response.json()["id"])

    documents = (
        await db_session.execute(select(FileDocument).order_by(FileDocument.id))
    ).scalars().all()
    collection_name = documents[0].collection_name
    calls = 0

    async def delete_chunks(name: str, stored_name: str):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("vector store unavailable")
        return True

    monkeypatch.setattr("src.api.files.delete_document_chunks", delete_chunks)

    response = await client.delete(f"/api/v1/files/collections/{collection_name}")
    assert response.status_code == 500

    db_session.expire_all()
    documents = (
        await db_session.execute(select(FileDocument).order_by(FileDocument.id))
    ).scalars().all()
    assert documents[0].deleted_at is not None
    assert documents[1].deleted_at is None
