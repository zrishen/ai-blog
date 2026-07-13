"""文件库测试。"""

import io
import sqlite3

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import FileDocument
from src.services import file_service
from src.utils.user_dir import invalidate_username_cache


# ---- Categories ----

@pytest.mark.asyncio
async def test_create_file_category(client: AsyncClient):
    resp = await client.post("/api/files/categories", json={
        "name": "测试分类",
        "description": "测试描述",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "测试分类"
    assert data["description"] == "测试描述"
    assert data["parent_id"] is None


@pytest.mark.asyncio
async def test_list_file_categories(client: AsyncClient):
    await client.post("/api/files/categories", json={"name": "分类A"})
    await client.post("/api/files/categories", json={"name": "分类B"})

    resp = await client.get("/api/files/categories")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2


@pytest.mark.asyncio
async def test_list_file_categories_flat(client: AsyncClient):
    await client.post("/api/files/categories", json={"name": "扁平分类"})

    resp = await client.get("/api/files/categories", params={"flat": True})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_subcategory(client: AsyncClient):
    parent_resp = await client.post("/api/files/categories", json={"name": "父分类"})
    parent_id = parent_resp.json()["id"]

    child_resp = await client.post("/api/files/categories", json={
        "name": "子分类",
        "parent_id": parent_id,
    })
    assert child_resp.status_code == 201
    assert child_resp.json()["parent_id"] == parent_id


@pytest.mark.asyncio
async def test_update_file_category(client: AsyncClient):
    create_resp = await client.post("/api/files/categories", json={"name": "原名称"})
    cat_id = create_resp.json()["id"]

    resp = await client.put(f"/api/files/categories/{cat_id}", json={
        "name": "新名称",
        "description": "新描述",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名称"


@pytest.mark.asyncio
async def test_delete_file_category(client: AsyncClient):
    create_resp = await client.post("/api/files/categories", json={"name": "待删除"})
    cat_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/files/categories/{cat_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_delete_nonexistent_category(client: AsyncClient):
    resp = await client.delete("/api/files/categories/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_file_category_preserves_soft_deleted_documents(
    client: AsyncClient, db_session: AsyncSession
):
    """分类删除只解绑 active 文档；软删文档的 category_id 保持不动（不影响回收站恢复语义）。"""
    from datetime import datetime, timezone

    cat_resp = await client.post("/api/files/categories", json={"name": "分类A"})
    cat_id = cat_resp.json()["id"]

    doc = FileDocument(
        collection_name=f"user_1_files",
        user_id="1",
        original_name="已软删.pdf",
        file_path="soft_deleted.pdf",
        chunk_content="0 chunks",
        meta="",
        category_id=cat_id,
        deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(doc)
    await db_session.commit()
    soft_deleted_id = doc.id

    resp = await client.delete(f"/api/files/categories/{cat_id}")
    assert resp.status_code == 200

    refreshed = await db_session.get(FileDocument, soft_deleted_id)
    assert refreshed is not None
    assert refreshed.category_id == cat_id  # 软删文档分类未被解绑


@pytest.mark.asyncio
async def test_create_category_invalid_parent(client: AsyncClient):
    resp = await client.post("/api/files/categories", json={
        "name": "无父分类",
        "parent_id": 99999,
    })
    assert resp.status_code == 400


# ---- Documents ----

@pytest.mark.asyncio
async def test_upload_file_document(client: AsyncClient):
    file_content = b"%PDF-1.4 File library document content."
    files = {"file": ("file_doc.pdf", io.BytesIO(file_content), "application/pdf")}

    resp = await client.post("/api/files/documents", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "collection_name" in data
    assert "original_name" in data
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

    monkeypatch.setattr("src.api.files.vectorize_and_store", capture_vectorize)
    files = {"file": ("numeric-id.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}

    response = await client.post("/api/files/documents", files=files)

    assert response.status_code == 200
    assert len(received_user_ids) == 1
    assert isinstance(received_user_ids[0], int)


def test_numeric_user_id_resolves_username_upload_directory(tmp_path, monkeypatch):
    database_path = tmp_path / "users.db"
    connection = sqlite3.connect(database_path)
    connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)")
    connection.execute("INSERT INTO users (id, username) VALUES (?, ?)", (7, "named-user"))
    connection.commit()
    connection.close()

    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(
        settings,
        "database_url",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    monkeypatch.setattr(file_service, "UPLOAD_DIR", upload_root)
    invalidate_username_cache()
    try:
        assert file_service.get_user_upload_dir(7) == upload_root / "named-user"
        assert file_service.get_user_upload_dir("7") == upload_root / "7"
    finally:
        invalidate_username_cache()


@pytest.mark.asyncio
async def test_list_file_documents(client: AsyncClient):
    resp = await client.get("/api/files/documents")
    assert resp.status_code == 200
    data = resp.json()
    assert "documents" in data
    assert isinstance(data["documents"], list)


@pytest.mark.asyncio
async def test_set_document_category(client: AsyncClient):
    cat_resp = await client.post("/api/files/categories", json={"name": "文档分类"})
    cat_id = cat_resp.json()["id"]

    files = {"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/files/documents", files=files)
    doc_id = doc_resp.json()["id"]

    resp = await client.patch(f"/api/files/documents/{doc_id}/category", json={
        "category_id": cat_id,
    })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_file_document(client: AsyncClient):
    files = {"file": ("del_doc.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/files/documents", files=files)
    doc_id = doc_resp.json()["id"]

    resp = await client.delete(f"/api/files/documents/{doc_id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_list_file_collections(client: AsyncClient):
    resp = await client.get("/api/files/collections")
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
        response = await client.post("/api/files/documents", files=files)
        assert response.status_code == 200

    documents = (
        await db_session.execute(select(FileDocument).order_by(FileDocument.id))
    ).scalars().all()
    collection_name = documents[0].collection_name
    calls = 0

    async def delete_chunks(name: str, stored_name: str):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("chroma unavailable")
        return True

    monkeypatch.setattr("src.api.files.delete_document_chunks", delete_chunks)

    response = await client.delete(f"/api/files/collections/{collection_name}")
    assert response.status_code == 500

    db_session.expire_all()
    documents = (
        await db_session.execute(select(FileDocument).order_by(FileDocument.id))
    ).scalars().all()
    assert documents[0].deleted_at is not None
    assert documents[1].deleted_at is None
