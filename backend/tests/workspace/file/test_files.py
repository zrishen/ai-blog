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

    resp = await client.post("/api/v1/upload", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert "stored_name" in data
    assert "original_name" in data
    assert "download_url" in data
    assert data["original_name"] == "test.pdf"


@pytest.mark.asyncio
async def test_get_uploaded_file_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/uploads/nonexistent.pdf")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_soft_deleted_library_file_stays_downloadable_when_chat_references_it(
    client: AsyncClient,
    db_session: AsyncSession,
):
    uploaded = await client.post(
        "/api/v1/upload",
        files={"file": ("shared.pdf", io.BytesIO(b"%PDF-1.4 shared"), "application/pdf")},
    )
    stored_name = uploaded.json()["stored_name"]
    conversation = (await client.post("/api/v1/conversations", json={"title": "共享附件"})).json()
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
            file_url=f"/api/v1/uploads/{stored_name}",
            token_count=1,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
    ])
    await db_session.commit()

    response = await client.get(f"/api/v1/uploads/{stored_name}")

    assert response.status_code == 200


def test_get_user_upload_dir_does_not_create_directory(tmp_path, monkeypatch):
    """get_user_upload_dir 纯取路径，无建目录副作用（根治空目录滥用）。"""
    from src.config import settings
    from src.services.workspace.file import file_service

    workspace_root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(workspace_root))
    target = workspace_root / "users" / "7" / "uploads"
    assert file_service.get_user_upload_dir(7) == target
    assert not target.exists()


@pytest.mark.asyncio
async def test_upload_rejects_svg(client: AsyncClient):
    """SVG 不再允许上传（防内嵌脚本导致的存储型 XSS）。"""
    files = {"file": ("evil.svg", io.BytesIO(b"<svg onload='alert(1)'></svg>"), "image/svg+xml")}
    resp = await client.post("/api/v1/upload", files=files)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_upload_rejects_magic_mismatch(client: AsyncClient):
    """扩展名与真实文件头不符（魔数校验）应拒绝，防扩展名欺骗。"""
    files = {"file": ("evil.png", io.BytesIO(b"<?php system($_GET['c']); ?>"), "image/png")}
    resp = await client.post("/api/v1/upload", files=files)
    assert resp.status_code == 400
