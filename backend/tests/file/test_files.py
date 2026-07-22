"""文件上传测试。"""

import io
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import FileDocument, Message


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


@pytest.mark.asyncio
async def test_soft_deleted_library_file_stays_downloadable_when_chat_references_it(
    client: AsyncClient,
    db_session: AsyncSession,
):
    uploaded = await client.post(
        "/api/upload",
        files={"file": ("shared.pdf", io.BytesIO(b"%PDF-1.4 shared"), "application/pdf")},
    )
    stored_name = uploaded.json()["stored_name"]
    conversation = (await client.post("/api/conversations", json={"title": "共享附件"})).json()
    db_session.add_all([
        FileDocument(
            collection_name="user_1_file",
            user_id="1",
            original_name="shared.pdf",
            file_path=stored_name,
            chunk_content="1 chunks",
            deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
        Message(
            conversation_id=conversation["id"],
            role="user",
            content="附件",
            file_url=f"/api/uploads/{stored_name}",
            token_count=1,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
    ])
    await db_session.commit()

    response = await client.get(f"/api/uploads/{stored_name}")

    assert response.status_code == 200
