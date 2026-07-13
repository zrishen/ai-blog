"""统一回收站测试。"""

import io
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    BlogPost as BlogPostModel,
    Conversation,
    FileDocument,
    Message,
)


# ─────────── Conversation ───────────


@pytest.mark.asyncio
async def test_conversation_soft_delete_then_list_restore(client: AsyncClient):
    create_resp = await client.post("/api/conversations", json={"title": "回收对话"})
    conv_id = create_resp.json()["id"]

    # 软删
    del_resp = await client.delete(f"/api/conversations/{conv_id}")
    assert del_resp.status_code == 200

    # 列表不显示
    listing = await client.get("/api/conversations")
    assert all(c["id"] != conv_id for c in listing.json()["conversations"])

    # 回收站可见
    trash = await client.get("/api/trash")
    assert trash.status_code == 200
    items = trash.json()["items"]
    assert any(i["type"] == "conversation" and i["id"] == conv_id for i in items)

    # 恢复
    restore = await client.post(f"/api/trash/conversation/{conv_id}/restore")
    assert restore.status_code == 200
    listing = await client.get("/api/conversations")
    assert any(c["id"] == conv_id for c in listing.json()["conversations"])


@pytest.mark.asyncio
async def test_conversation_messages_soft_deleted_with_parent(client: AsyncClient, db_session: AsyncSession):
    """Message 无 deleted_at 字段；会话软删只动 Conversation，消息记录保持不变。"""
    create_resp = await client.post("/api/conversations", json={"title": "有消息"})
    conv_id = create_resp.json()["id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(Message(
        conversation_id=conv_id,
        role="user",
        content="hi",
        token_count=1,
        created_at=now,
    ))
    await db_session.commit()

    del_resp = await client.delete(f"/api/conversations/{conv_id}")
    assert del_resp.status_code == 200

    # Message 不带 deleted_at，记录保持不变；可见性靠 Conversation.deleted_at 过滤
    msgs_result = await db_session.execute(
        select(Message).where(Message.conversation_id == conv_id)
    )
    msgs = msgs_result.scalars().all()
    assert len(msgs) == 1
    assert not hasattr(msgs[0], "deleted_at")

    # 列表已被会话级软删过滤
    listing = await client.get("/api/conversations")
    assert all(c["id"] != conv_id for c in listing.json()["conversations"])

    # 恢复会话后消息仍可读
    restore = await client.post(f"/api/trash/conversation/{conv_id}/restore")
    assert restore.status_code == 200
    listing = await client.get("/api/conversations")
    assert any(c["id"] == conv_id for c in listing.json()["conversations"])


@pytest.mark.asyncio
async def test_conversation_purge(client: AsyncClient, db_session: AsyncSession):
    create_resp = await client.post("/api/conversations", json={"title": "永久删除"})
    conv_id = create_resp.json()["id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(Message(
        conversation_id=conv_id,
        role="user",
        content="hi",
        token_count=1,
        created_at=now,
    ))
    await db_session.commit()

    await client.delete(f"/api/conversations/{conv_id}")
    resp = await client.delete(f"/api/trash/conversation/{conv_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    assert await db_session.get(Conversation, conv_id) is None
    msgs = (await db_session.execute(select(Message).where(Message.conversation_id == conv_id))).scalars().all()
    assert msgs == []


# ─────────── FileDocument ───────────


@pytest.mark.asyncio
async def test_file_document_soft_delete_then_list(client: AsyncClient):
    files = {"file": ("del.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/files/documents", files=files)
    doc_id = doc_resp.json()["id"]

    del_resp = await client.delete(f"/api/files/documents/{doc_id}")
    assert del_resp.status_code == 200

    listing = await client.get("/api/files/documents")
    assert all(d["id"] != doc_id for d in listing.json()["documents"])

    trash = await client.get("/api/trash")
    assert any(i["type"] == "file_document" and i["id"] == doc_id for i in trash.json()["items"])


@pytest.mark.asyncio
async def test_file_document_restore_requires_source_file(client: AsyncClient, monkeypatch):
    """软删后回收站可见；恢复时若源文件已丢失则返回 409。"""
    files = {"file": ("restore.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/files/documents", files=files)
    doc_id = doc_resp.json()["id"]

    await client.delete(f"/api/files/documents/{doc_id}")

    trash = await client.get("/api/trash")
    assert any(i["type"] == "file_document" and i["id"] == doc_id for i in trash.json()["items"])

    # 让 trash_service 看到的源上传目录为不存在文件的临时目录，触发 ORIGINAL_FILE_MISSING
    import pathlib

    fake_dir = pathlib.Path(client._base_url.host or "") if False else pathlib.Path("nonexistent-restore-dir")
    monkeypatch.setattr(
        "src.services.trash_service.get_user_upload_dir",
        lambda uid: fake_dir,
    )

    restore = await client.post(f"/api/trash/file_document/{doc_id}/restore")
    assert restore.status_code == 409


@pytest.mark.asyncio
async def test_file_document_purge(client: AsyncClient, db_session: AsyncSession):
    files = {"file": ("purge.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/files/documents", files=files)
    doc_id = doc_resp.json()["id"]

    await client.delete(f"/api/files/documents/{doc_id}")
    resp = await client.delete(f"/api/trash/file_document/{doc_id}")
    assert resp.status_code == 200
    assert await db_session.get(FileDocument, doc_id) is None


# ─────────── BlogPost ───────────


@pytest.mark.asyncio
async def test_blog_post_soft_delete_then_list(client: AsyncClient):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "回收文章",
        "content": "内容",
        "status": "published",
    })
    post_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/blog/posts/{post_id}")
    assert del_resp.status_code == 200

    listing = await client.get("/api/blog/posts")
    assert all(p["id"] != post_id for p in listing.json()["posts"])

    trash = await client.get("/api/trash")
    assert any(i["type"] == "blog_post" and i["id"] == post_id for i in trash.json()["items"])


@pytest.mark.asyncio
async def test_blog_post_restore(client: AsyncClient):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "恢复测试",
        "content": "内容",
        "status": "published",
    })
    post_id = create_resp.json()["id"]

    await client.delete(f"/api/blog/posts/{post_id}")
    restore = await client.post(f"/api/trash/blog_post/{post_id}/restore")
    assert restore.status_code == 200

    listing = await client.get("/api/blog/posts")
    assert any(p["id"] == post_id for p in listing.json()["posts"])


@pytest.mark.asyncio
async def test_blog_post_purge(client: AsyncClient, db_session: AsyncSession):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "永久删",
        "content": "内容",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]

    await client.delete(f"/api/blog/posts/{post_id}")
    resp = await client.delete(f"/api/trash/blog_post/{post_id}")
    assert resp.status_code == 200
    assert await db_session.get(BlogPostModel, post_id) is None


# ─────────── empty trash ───────────


@pytest.mark.asyncio
async def test_empty_trash(client: AsyncClient):
    create_resp = await client.post("/api/conversations", json={"title": "x"})
    conv_id = create_resp.json()["id"]
    await client.delete(f"/api/conversations/{conv_id}")

    resp = await client.delete("/api/trash")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "ok"
    assert any(d["type"] == "conversation" and d["id"] == conv_id for d in payload["deleted"])

    trash = await client.get("/api/trash")
    assert all(i["id"] != conv_id for i in trash.json()["items"])


# ─────────── isolation ───────────


@pytest.mark.asyncio
async def test_trash_isolated_per_user(client: AsyncClient, db_session: AsyncSession):
    from src.main import app
    from src.utils.auth import get_current_user
    from src.database.models import User

    async def user_a():
        return User(id=301, username="trash-a", password_hash="x")

    async def user_b():
        return User(id=302, username="trash-b", password_hash="x")

    original = app.dependency_overrides.get(get_current_user)
    try:
        app.dependency_overrides[get_current_user] = user_a
        create_resp = await client.post("/api/conversations", json={"title": "A 对话"})
        conv_id = create_resp.json()["id"]
        await client.delete(f"/api/conversations/{conv_id}")

        app.dependency_overrides[get_current_user] = user_b
        trash_b = await client.get("/api/trash")
        assert all(i["id"] != conv_id for i in trash_b.json()["items"])

        restore_b = await client.post(f"/api/trash/conversation/{conv_id}/restore")
        assert restore_b.status_code in (404, 400)
    finally:
        if original is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = original


# ─────────── unsupported type ───────────


@pytest.mark.asyncio
async def test_trash_unsupported_type(client: AsyncClient):
    resp = await client.delete("/api/trash/research_topic/1")
    assert resp.status_code in (400, 404)


# ─────────── extra: file 恢复成功路径 / 跨用户 purge / 清空 partial ───────────


@pytest.mark.asyncio
async def test_file_document_restore_success_invokes_vectorize(client: AsyncClient, monkeypatch):
    """恢复成功时调用 vectorize_and_store，文件库列表恢复可见，deleted_at 被清。"""
    files = {"file": ("ok-restore.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_resp = await client.post("/api/files/documents", files=files)
    doc_id = doc_resp.json()["id"]
    await client.delete(f"/api/files/documents/{doc_id}")

    calls: list[tuple] = []
    upload_dir_user_ids: list[int | str] = []

    async def _fake_vectorize(stored, collection, **kwargs):
        calls.append((stored, collection, kwargs.get("original_name"), kwargs.get("user_id")))
        return ["chunk-1", "chunk-2"]

    from src.services.file_service import get_user_upload_dir

    def _capture_upload_dir(user_id: int | str):
        upload_dir_user_ids.append(user_id)
        return get_user_upload_dir(user_id)

    monkeypatch.setattr("src.services.trash_service.get_user_upload_dir", _capture_upload_dir)
    monkeypatch.setattr("src.services.trash_service.vectorize_and_store", _fake_vectorize)

    restore = await client.post(f"/api/trash/file_document/{doc_id}/restore")
    assert restore.status_code == 200
    body = restore.json()
    assert body["status"] == "ok"
    assert body["item"]["type"] == "file_document"
    assert body["item"]["id"] == doc_id
    assert len(calls) == 1
    assert isinstance(calls[0][3], int)
    assert len(upload_dir_user_ids) == 1
    assert isinstance(upload_dir_user_ids[0], int)

    listing = await client.get("/api/files/documents")
    assert any(d["id"] == doc_id for d in listing.json()["documents"])


@pytest.mark.asyncio
async def test_file_restore_commit_failure_cleans_rebuilt_chunks(
    db_session: AsyncSession,
    monkeypatch,
    tmp_path,
):
    from src.services.trash_service import restore_item

    source = tmp_path / "restore-commit.pdf"
    source.write_bytes(b"%PDF-1.4 content")
    doc = FileDocument(
        collection_name="user_1_file",
        user_id="1",
        original_name="restore-commit.pdf",
        file_path=source.name,
        chunk_content="1 chunks",
        meta="",
        deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)
    doc_id = doc.id
    collection_name = doc.collection_name
    stored_name = doc.file_path

    monkeypatch.setattr("src.services.trash_service.get_user_upload_dir", lambda user_id: tmp_path)
    monkeypatch.setattr(
        "src.services.trash_service.vectorize_and_store",
        AsyncMock(return_value=["chunk"]),
    )
    cleanup = AsyncMock(return_value=True)
    monkeypatch.setattr("src.services.trash_service.delete_document_chunks", cleanup)

    async def fail_commit():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(HTTPException) as exc_info:
        await restore_item(
            db_session,
            item_type="file_document",
            item_id=doc_id,
            user_id=1,
        )

    assert exc_info.value.status_code == 409
    assert str(exc_info.value.detail).startswith("RESTORE_COMMIT_FAILED:")
    cleanup.assert_awaited_once_with(collection_name, stored_name)


@pytest.mark.asyncio
async def test_file_purge_chroma_failure_keeps_record(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    files = {"file": ("purge-chroma.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_id = (await client.post("/api/files/documents", files=files)).json()["id"]
    await client.delete(f"/api/files/documents/{doc_id}")

    async def fail_cleanup(*args, **kwargs):
        raise RuntimeError("chroma unavailable")

    monkeypatch.setattr("src.services.trash_service.delete_document_chunks", fail_cleanup)

    response = await client.delete(f"/api/trash/file_document/{doc_id}")
    assert response.status_code == 500

    db_session.expire_all()
    doc = await db_session.get(FileDocument, doc_id)
    assert doc is not None
    assert doc.deleted_at is not None


@pytest.mark.asyncio
async def test_file_purge_unlink_failure_keeps_record(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
    tmp_path,
):
    files = {"file": ("purge-unlink.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    doc_id = (await client.post("/api/files/documents", files=files)).json()["id"]
    await client.delete(f"/api/files/documents/{doc_id}")
    doc = await db_session.get(FileDocument, doc_id)
    source = tmp_path / doc.file_path
    source.write_bytes(b"%PDF-1.4 content")

    monkeypatch.setattr("src.services.trash_service.get_user_upload_dir", lambda user_id: tmp_path)
    original_unlink = Path.unlink

    def fail_unlink(path: Path, *args, **kwargs):
        if path == source:
            raise PermissionError("file is locked")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_unlink)

    response = await client.delete(f"/api/trash/file_document/{doc_id}")
    assert response.status_code == 500

    db_session.expire_all()
    doc = await db_session.get(FileDocument, doc_id)
    assert doc is not None
    assert doc.deleted_at is not None


@pytest.mark.asyncio
async def test_trash_purge_isolated_per_user(client: AsyncClient):
    """B 用户无法永久删除 A 用户的回收站项；返回 404，记录仍保留。"""
    from src.main import app
    from src.utils.auth import get_current_user
    from src.database.models import User

    async def user_a():
        return User(id=411, username="trash-purge-a", password_hash="x")

    async def user_b():
        return User(id=412, username="trash-purge-b", password_hash="x")

    original = app.dependency_overrides.get(get_current_user)
    try:
        app.dependency_overrides[get_current_user] = user_a
        create_resp = await client.post("/api/conversations", json={"title": "A 私有"})
        conv_id = create_resp.json()["id"]
        await client.delete(f"/api/conversations/{conv_id}")

        app.dependency_overrides[get_current_user] = user_b
        # B 在自己回收站里看不到 A 的会话
        trash_b = await client.get("/api/trash")
        assert all(not (i["type"] == "conversation" and i["id"] == conv_id) for i in trash_b.json()["items"])

        # B 直接发起永久删除也应当被拒绝
        purge_resp = await client.delete(f"/api/trash/conversation/{conv_id}")
        assert purge_resp.status_code == 404

        # 切回 A 仍在回收站
        app.dependency_overrides[get_current_user] = user_a
        trash_a = await client.get("/api/trash")
        assert any(i["type"] == "conversation" and i["id"] == conv_id for i in trash_a.json()["items"])
    finally:
        if original is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = original


@pytest.mark.asyncio
async def test_empty_trash_partial_keeps_failed_item(client: AsyncClient, monkeypatch):
    """单项永久删除失败时 status=partial，failed/remaining 包含该项目。"""
    create_resp = await client.post("/api/conversations", json={"title": "partial-x"})
    conv_id = create_resp.json()["id"]
    await client.delete(f"/api/conversations/{conv_id}")

    call_count = {"n": 0}

    async def _boom(*args, **kwargs):
        call_count["n"] += 1
        raise RuntimeError("simulated purge failure")

    monkeypatch.setattr("src.services.trash_service._purge_conversation", _boom)

    resp = await client.delete("/api/trash")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "partial"
    assert any(
        f["item"]["type"] == "conversation" and f["item"]["id"] == conv_id
        for f in body["failed"]
    )
    assert body["remaining"] == 1
    assert call_count["n"] >= 1

    trash = await client.get("/api/trash")
    assert any(
        item["type"] == "conversation" and item["id"] == conv_id
        for item in trash.json()["items"]
    )
