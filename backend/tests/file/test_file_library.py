"""文件库测试。"""

import io
import sqlite3
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import FileDocument, FileProcessingJob
from src.services.file import file_service
from src.services.file.file_processing_service import _run_job
from src.utils.user_dir import resolve_username


# ---- Categories ----

@pytest.mark.asyncio
async def test_create_file_category(client: AsyncClient):
    resp = await client.post("/api/v1/files/categories", json={
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
    await client.post("/api/v1/files/categories", json={"name": "分类A"})
    await client.post("/api/v1/files/categories", json={"name": "分类B"})

    resp = await client.get("/api/v1/files/categories")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2


@pytest.mark.asyncio
async def test_list_file_categories_flat(client: AsyncClient):
    await client.post("/api/v1/files/categories", json={"name": "扁平分类"})

    resp = await client.get("/api/v1/files/categories", params={"flat": True})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_subcategory(client: AsyncClient):
    parent_resp = await client.post("/api/v1/files/categories", json={"name": "父分类"})
    parent_id = parent_resp.json()["id"]

    child_resp = await client.post("/api/v1/files/categories", json={
        "name": "子分类",
        "parent_id": parent_id,
    })
    assert child_resp.status_code == 201
    assert child_resp.json()["parent_id"] == parent_id


@pytest.mark.asyncio
async def test_update_file_category(client: AsyncClient):
    create_resp = await client.post("/api/v1/files/categories", json={"name": "原名称"})
    cat_id = create_resp.json()["id"]

    resp = await client.put(f"/api/v1/files/categories/{cat_id}", json={
        "name": "新名称",
        "description": "新描述",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名称"


@pytest.mark.asyncio
async def test_delete_file_category(client: AsyncClient):
    create_resp = await client.post("/api/v1/files/categories", json={"name": "待删除"})
    cat_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/v1/files/categories/{cat_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_delete_nonexistent_category(client: AsyncClient):
    resp = await client.delete("/api/v1/files/categories/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_file_category_preserves_soft_deleted_documents(
    client: AsyncClient, db_session: AsyncSession
):
    """分类删除只软删 active 文档；已软删文档不重复处理（保留回收站恢复语义）。"""
    from datetime import datetime, timezone

    cat_resp = await client.post("/api/v1/files/categories", json={"name": "分类A"})
    cat_id = cat_resp.json()["id"]

    doc = FileDocument(
        collection_name="user_1_files",
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

    resp = await client.delete(f"/api/v1/files/categories/{cat_id}")
    assert resp.status_code == 200

    refreshed = await db_session.get(FileDocument, soft_deleted_id)
    assert refreshed is not None
    assert refreshed.category_id == cat_id  # 已软删文档不重复处理


@pytest.mark.asyncio
async def test_delete_file_category_cascades_subcategories(
    client: AsyncClient, db_session: AsyncSession
):
    """删除分类时连带删除其下所有子孙分类，子孙分类下的 active 文档被软删（可在回收站恢复）。"""
    from src.database.models import FileCategory as FileCategoryModel

    root_resp = await client.post("/api/v1/files/categories", json={"name": "根"})
    root_id = root_resp.json()["id"]
    child_resp = await client.post(
        "/api/v1/files/categories", json={"name": "子", "parent_id": root_id}
    )
    child_id = child_resp.json()["id"]
    grand_resp = await client.post(
        "/api/v1/files/categories", json={"name": "孙", "parent_id": child_id}
    )
    grand_id = grand_resp.json()["id"]

    active_doc = FileDocument(
        collection_name="user_1_files",
        user_id="1",
        original_name="孙级文档.pdf",
        file_path="grandchild.pdf",
        chunk_content="0 chunks",
        meta="",
        category_id=grand_id,
    )
    db_session.add(active_doc)
    await db_session.commit()
    active_doc_id = active_doc.id

    resp = await client.delete(f"/api/v1/files/categories/{root_id}")
    assert resp.status_code == 200

    remaining_ids = {
        row[0]
        for row in (
            await db_session.execute(
                select(FileCategoryModel.id).where(
                    FileCategoryModel.id.in_([root_id, child_id, grand_id])
                )
            )
        ).all()
    }
    assert remaining_ids == set(), "子孙分类未级联删除"

    refreshed_doc = await db_session.get(FileDocument, active_doc_id)
    assert refreshed_doc is not None
    await db_session.refresh(refreshed_doc)
    assert refreshed_doc.category_id is None  # 子孙分类下文档被软删时解绑分类
    assert refreshed_doc.deleted_at is not None  # 子孙分类下 active 文档被软删


@pytest.mark.asyncio
async def test_create_category_invalid_parent(client: AsyncClient):
    resp = await client.post("/api/v1/files/categories", json={
        "name": "无父分类",
        "parent_id": 99999,
    })
    assert resp.status_code == 400


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

    monkeypatch.setattr("src.services.file.file_processing_service.vectorize_and_store", capture_vectorize)
    files = {"file": ("numeric-id.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}

    response = await client.post("/api/v1/files/documents", files=files, data={"auto_index": "true"}, headers={"X-File-Request-Id": str(uuid.uuid4())})
    await _run_job(response.json()["id"])

    assert response.status_code == 202
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
    resolve_username.cache_clear()
    try:
        assert file_service.get_user_upload_dir(7) == upload_root / "named-user"
        assert file_service.get_user_upload_dir("7") == upload_root / "7"
    finally:
        resolve_username.cache_clear()


@pytest.mark.asyncio
async def test_list_file_documents(client: AsyncClient):
    resp = await client.get("/api/v1/files/documents")
    assert resp.status_code == 200
    data = resp.json()
    assert "documents" in data
    assert isinstance(data["documents"], list)


@pytest.mark.asyncio
async def test_set_document_category(client: AsyncClient, db_session: AsyncSession):
    cat_resp = await client.post("/api/v1/files/categories", json={"name": "文档分类"})
    cat_id = cat_resp.json()["id"]

    files = {"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/v1/files/documents", files=files, headers={"X-File-Request-Id": str(uuid.uuid4())})
    await _run_job(doc_resp.json()["id"])
    job = await db_session.get(FileProcessingJob, doc_resp.json()["id"])
    doc_id = job.result_document_id

    resp = await client.patch(f"/api/v1/files/documents/{doc_id}/category", json={
        "category_id": cat_id,
    })
    assert resp.status_code == 200


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
            raise RuntimeError("chroma unavailable")
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


@pytest.mark.asyncio
async def test_update_category_rejects_moving_under_descendant(client: AsyncClient):
    """禁止把分类移到自己的后代下，避免形成父子环导致遍历/删除无限循环。"""
    grandchild_resp = await client.post("/api/v1/files/categories", json={"name": "祖先"})
    grandchild_id = grandchild_resp.json()["id"]
    child_resp = await client.post("/api/v1/files/categories", json={
        "name": "后代",
        "parent_id": grandchild_id,
    })
    child_id = child_resp.json()["id"]

    # 把祖先的父设为后代（后代是祖先的子分类）→ 必须被拒绝
    resp = await client.put(f"/api/v1/files/categories/{grandchild_id}", json={
        "parent_id": child_id,
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_collect_descendant_category_ids_tolerates_cycle(db_session: AsyncSession):
    """历史坏数据已存在父子环时，BFS 的 visited 保护应避免无限循环。"""
    from src.api.files import _collect_descendant_category_ids
    from src.database.models import FileCategory as FileCategoryModel

    cycle_a = FileCategoryModel(id=9001, name="环A", slug="cycle-a", parent_id=9002, user_id=1)
    cycle_b = FileCategoryModel(id=9002, name="环B", slug="cycle-b", parent_id=9001, user_id=1)
    db_session.add_all([cycle_a, cycle_b])
    await db_session.commit()

    result = await _collect_descendant_category_ids(db_session, 9001, 1)
    assert set(result) <= {9001, 9002}
