"""文件上传测试。"""

import io

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_upload_file(client: AsyncClient):
    # 创建一个假的 pdf 文件
    file_content = b"%PDF-1.4 fake test content"
    files = {"file": ("test.pdf", io.BytesIO(file_content), "application/pdf")}

    resp = await client.post("/api/upload", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert "stored_name" in data
    assert "original_name" in data
    assert "download_url" in data
    assert data["original_name"] == "test.pdf"


@pytest.mark.asyncio
async def test_get_uploaded_file_not_found(client: AsyncClient):
    resp = await client.get("/api/uploads/nonexistent.pdf")
    assert resp.status_code == 404
