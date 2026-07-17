"""文件预览路由测试。"""

import io
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from src.database.models import Conversation, FileDocument, Message

from src.config import settings
from src.main import app
from src.services import file_service
from src.utils.auth import get_current_user, get_optional_user


@pytest.fixture(autouse=True)
def real_auth():
    """还原真实 token-based 认证依赖，避免 conftest 把所有请求都识别为 testuser。"""
    saved_current = app.dependency_overrides.get(get_current_user)
    saved_optional = app.dependency_overrides.get(get_optional_user)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_optional_user, None)
    yield
    if saved_current is not None:
        app.dependency_overrides[get_current_user] = saved_current
    if saved_optional is not None:
        app.dependency_overrides[get_optional_user] = saved_optional


@pytest.fixture(autouse=True)
def isolated_dirs(tmp_path, monkeypatch):
    upload_path = tmp_path / "uploads"
    upload_path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(file_service, "UPLOAD_DIR", upload_path)
    monkeypatch.setattr(settings, "upload_dir", str(upload_path))
    # 注册用户会触发 _seed_intro_article 写盘，必须隔离 blog_content_dir，否则污染真实数据。
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


async def _register_and_upload(client: AsyncClient, filename: str, content: bytes, content_type: str):
    reg = await client.post("/api/auth/register", json={
        "username": "preview_user",
        "password": "test1234",
    })
    token = reg.json()["access_token"]
    user_id = reg.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    files = {"file": (filename, io.BytesIO(content), content_type)}
    resp = await client.post("/api/upload", headers=headers, files=files)
    assert resp.status_code == 200, resp.text
    return token, user_id, resp.json()["stored_name"]


@pytest.mark.asyncio
async def test_preview_requires_authentication(client: AsyncClient):
    resp = await client.get("/api/preview/whatever.pdf")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_rejects_invalid_token(client: AsyncClient):
    resp = await client.get(
        "/api/preview/file.pdf",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_pdf_returns_inline_file(client: AsyncClient):
    token, _user_id, stored = await _register_and_upload(
        client, "doc.pdf", b"%PDF-1.4 fake content", "application/pdf"
    )

    resp = await client.get(
        f"/api/preview/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "inline" in resp.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_preview_rejects_soft_deleted_file_library_document(client: AsyncClient, db_session):
    token, user_id, stored = await _register_and_upload(
        client, "deleted.pdf", b"%PDF-1.4 deleted", "application/pdf"
    )
    db_session.add(FileDocument(
        collection_name=f"user_{user_id}_file",
        user_id=str(user_id),
        original_name="deleted.pdf",
        file_path=stored,
        chunk_content="1 chunks",
        deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    await db_session.commit()

    resp = await client.get(
        f"/api/preview/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_preview_keeps_shared_chat_attachment_visible(client: AsyncClient, db_session):
    token, user_id, stored = await _register_and_upload(
        client, "shared.pdf", b"%PDF-1.4 shared", "application/pdf"
    )
    conversation = Conversation(title="共享附件", user_id=user_id)
    db_session.add(conversation)
    await db_session.flush()
    db_session.add_all([
        FileDocument(
            collection_name=f"user_{user_id}_file",
            user_id=str(user_id),
            original_name="shared.pdf",
            file_path=stored,
            chunk_content="1 chunks",
            deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
        Message(
            conversation_id=conversation.id,
            role="user",
            content="附件",
            file_url=f"/api/uploads/{stored}",
            token_count=1,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
    ])
    await db_session.commit()

    resp = await client.get(
        f"/api/preview/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_preview_token_via_query_param_works(client: AsyncClient):
    token, _user_id, stored = await _register_and_upload(
        client, "doc.pdf", b"%PDF-1.4 fake", "application/pdf"
    )

    # 通过 ?token= 也能通过认证（前端预览窗口直接打开 URL）
    resp = await client.get(f"/api/preview/{stored}?token={token}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_preview_returns_404_for_missing_file(client: AsyncClient):
    reg = await client.post("/api/auth/register", json={
        "username": "preview_missing",
        "password": "test1234",
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/preview/non-existent.pdf", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_preview_rejects_unsupported_extension(client: AsyncClient):
    from src.services.file_service import get_user_upload_dir

    token, _user_id, _stored = await _register_and_upload(
        client, "real.pdf", b"%PDF-1.4 ok", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}

    me = await client.get("/api/auth/me", headers=headers)
    user_id = me.json()["id"]
    user_dir = get_user_upload_dir(user_id)
    (user_dir / "notes.txt").write_bytes(b"plain text")

    resp = await client.get("/api/preview/notes.txt", headers=headers)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_preview_path_traversal_blocked(client: AsyncClient):
    token, _user_id, _stored = await _register_and_upload(
        client, "real.pdf", b"%PDF-1.4 ok", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}

    # 尝试目录穿越访问其他用户文件
    resp = await client.get("/api/preview/../2/secret.pdf", headers=headers)
    # 路径解析后超出 user_dir，应被拒绝（403/404，不能 200）
    assert resp.status_code in (403, 404, 400)
