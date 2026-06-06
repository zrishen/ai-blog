"""真实知识库测试 — 调用向量化服务。"""

import io

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_upload_and_search(client: AsyncClient):
    """上传文档并验证向量化。"""
    file_content = b"FastAPI is a modern web framework for Python."
    files = {"file": ("real_doc.txt", io.BytesIO(file_content), "text/plain")}

    resp = await client.post("/api/kb/documents", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["chunk_count"] > 0
    assert "collection_name" in data


@pytest.mark.asyncio
async def test_kb_category_crud(client: AsyncClient):
    """测试知识库分类 CRUD。"""
    # 创建
    resp = await client.post("/api/kb/categories", json={
        "name": "真实测试分类",
        "description": "用于真实测试",
    })
    assert resp.status_code == 201
    cat_id = resp.json()["id"]

    # 查询
    resp = await client.get("/api/kb/categories")
    assert resp.status_code == 200

    # 更新
    resp = await client.put(f"/api/kb/categories/{cat_id}", json={
        "name": "已更新分类",
    })
    assert resp.status_code == 200

    # 删除
    resp = await client.delete(f"/api/kb/categories/{cat_id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_kb_collections(client: AsyncClient):
    """测试知识库集合列表。"""
    resp = await client.get("/api/kb/collections")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
