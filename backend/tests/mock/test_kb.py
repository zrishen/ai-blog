"""知识库测试。"""

import io

import pytest
from httpx import AsyncClient


# ---- Categories ----

@pytest.mark.asyncio
async def test_create_kb_category(client: AsyncClient):
    resp = await client.post("/api/kb/categories", json={
        "name": "测试分类",
        "description": "测试描述",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "测试分类"
    assert data["description"] == "测试描述"
    assert data["parent_id"] is None


@pytest.mark.asyncio
async def test_list_kb_categories(client: AsyncClient):
    await client.post("/api/kb/categories", json={"name": "分类A"})
    await client.post("/api/kb/categories", json={"name": "分类B"})

    resp = await client.get("/api/kb/categories")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2


@pytest.mark.asyncio
async def test_list_kb_categories_flat(client: AsyncClient):
    await client.post("/api/kb/categories", json={"name": "扁平分类"})

    resp = await client.get("/api/kb/categories", params={"flat": True})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_subcategory(client: AsyncClient):
    # 创建父分类
    parent_resp = await client.post("/api/kb/categories", json={"name": "父分类"})
    parent_id = parent_resp.json()["id"]

    # 创建子分类
    child_resp = await client.post("/api/kb/categories", json={
        "name": "子分类",
        "parent_id": parent_id,
    })
    assert child_resp.status_code == 201
    assert child_resp.json()["parent_id"] == parent_id


@pytest.mark.asyncio
async def test_update_kb_category(client: AsyncClient):
    create_resp = await client.post("/api/kb/categories", json={"name": "原名称"})
    cat_id = create_resp.json()["id"]

    resp = await client.put(f"/api/kb/categories/{cat_id}", json={
        "name": "新名称",
        "description": "新描述",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名称"


@pytest.mark.asyncio
async def test_delete_kb_category(client: AsyncClient):
    create_resp = await client.post("/api/kb/categories", json={"name": "待删除"})
    cat_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/kb/categories/{cat_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_delete_nonexistent_category(client: AsyncClient):
    resp = await client.delete("/api/kb/categories/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_category_invalid_parent(client: AsyncClient):
    resp = await client.post("/api/kb/categories", json={
        "name": "无父分类",
        "parent_id": 99999,
    })
    assert resp.status_code == 400


# ---- Documents ----

@pytest.mark.asyncio
async def test_upload_kb_document(client: AsyncClient):
    file_content = b"%PDF-1.4 Knowledge base document content."
    files = {"file": ("kb_doc.pdf", io.BytesIO(file_content), "application/pdf")}

    resp = await client.post("/api/kb/documents", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "collection_name" in data
    assert "original_name" in data
    assert data["original_name"] == "kb_doc.pdf"


@pytest.mark.asyncio
async def test_list_kb_documents(client: AsyncClient):
    resp = await client.get("/api/kb/documents")
    assert resp.status_code == 200
    data = resp.json()
    assert "documents" in data
    assert isinstance(data["documents"], list)


@pytest.mark.asyncio
async def test_set_document_category(client: AsyncClient):
    # 创建分类
    cat_resp = await client.post("/api/kb/categories", json={"name": "文档分类"})
    cat_id = cat_resp.json()["id"]

    # 上传文档
    files = {"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/kb/documents", files=files)
    doc_id = doc_resp.json()["id"]

    # 设置分类
    resp = await client.patch(f"/api/kb/documents/{doc_id}/category", json={
        "category_id": cat_id,
    })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_kb_document(client: AsyncClient):
    files = {"file": ("del_doc.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/kb/documents", files=files)
    doc_id = doc_resp.json()["id"]

    resp = await client.delete(f"/api/kb/documents/{doc_id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_list_kb_collections(client: AsyncClient):
    resp = await client.get("/api/kb/collections")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
