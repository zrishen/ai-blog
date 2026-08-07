"""AI chat attachment staging API tests."""

from datetime import datetime, timezone
import io
from pathlib import Path
import uuid

from fastapi import UploadFile
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import ChatAttachment, Conversation, Message, User
from src.main import app
from src.schemas.conversation import MessageRequest
from src.services.chat.chat_attachment_service import (
    ChatAttachmentNotFoundError,
    ChatAttachmentStateError,
    claim_attachments,
    create_or_reuse_attachment,
    get_owned_attachment,
    prepare_claimed_attachments,
    recover_stale_claimed_attachments,
    release_attachment_claim,
)
from src.utils.auth import get_current_user


@pytest.fixture(autouse=True)
def isolated_attachment_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "chat_attachment_dir", str(tmp_path / "chat-attachments"))
    monkeypatch.setattr(settings, "chat_attachment_max_file_size_bytes", 1024 * 1024)
    monkeypatch.setattr(settings, "chat_attachment_max_image_size_bytes", 1024 * 1024)
    monkeypatch.setattr(settings, "chat_attachment_max_document_size_bytes", 1024 * 1024)
    monkeypatch.setattr(settings, "chat_attachment_upload_chunk_size_bytes", 7)
    monkeypatch.setattr(settings, "chat_attachment_pending_ttl_seconds", 3600)
    monkeypatch.setattr(settings, "chat_attachment_claim_ttl_seconds", 1800)
    monkeypatch.setattr(settings, "chat_attachment_max_pending_count_per_user", 100)
    monkeypatch.setattr(settings, "chat_attachment_max_pending_size_bytes_per_user", 100 * 1024 * 1024)
    monkeypatch.setattr(settings, "chat_attachment_cleanup_batch_size", 5)


def _pdf_file(content: bytes = b"%PDF-1.4\nchat attachment"):
    return {"file": ("notes.pdf", io.BytesIO(content), "application/pdf")}


@pytest.mark.asyncio
async def test_upload_attachment_returns_complete_dto_and_stores_file(
    client: AsyncClient,
    db_session: AsyncSession,
):
    attachment_id = str(uuid.uuid4())

    response = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": attachment_id},
        data={"draft_key": "draft-1"},
        files={"file": ("notes.md", io.BytesIO(b"# Notes\nhello"), "text/markdown")},
    )

    assert response.status_code == 201
    data = response.json()
    content_url = f"/api/v1/chat/attachments/{attachment_id}/content"
    assert data == {
        "id": attachment_id,
        "kind": "file",
        "original_name": "notes.md",
        "mime_type": "text/markdown",
        "size_bytes": 13,
        "status": "pending",
        "position": None,
        "download_url": content_url,
        "extraction_truncated": False,
        "media_type": "text/markdown",
        "content_url": content_url,
        "draft_key": "draft-1",
        "message_id": None,
        "expires_at": data["expires_at"],
        "claimed_at": None,
        "attached_at": None,
        "created_at": data["created_at"],
        "updated_at": data["updated_at"],
    }
    attachment = (
        await db_session.execute(
            select(ChatAttachment).where(ChatAttachment.attachment_id == attachment_id)
        )
    ).scalar_one()
    assert attachment.user_id == 1
    assert attachment.status == "pending"
    stored_file = Path(settings.chat_attachment_dir) / attachment.stored_path
    assert stored_file.read_bytes() == b"# Notes\nhello"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "content_type", "content", "expected_status"),
    [
        ("script.exe", "application/octet-stream", b"MZ", 400),
        ("image.png", "image/jpeg", b"\x89PNG\r\n\x1a\nbody", 400),
        ("image.png", "image/png", b"not-a-png", 400),
    ],
)
async def test_upload_rejects_unsupported_or_mismatched_type(
    client: AsyncClient,
    filename: str,
    content_type: str,
    content: bytes,
    expected_status: int,
):
    response = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": str(uuid.uuid4())},
        files={"file": (filename, io.BytesIO(content), content_type)},
    )

    assert response.status_code == expected_status


@pytest.mark.asyncio
async def test_upload_enforces_streamed_size_limit(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "chat_attachment_max_file_size_bytes", 16)

    response = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": str(uuid.uuid4())},
        files=_pdf_file(b"%PDF-1.4\n" + b"x" * 20),
    )

    assert response.status_code == 413
    assert not list(Path(settings.chat_attachment_dir).rglob("*.pdf"))
    assert not list(Path(settings.chat_attachment_dir).rglob("*.part"))


@pytest.mark.asyncio
async def test_upload_is_idempotent_per_user(
    client: AsyncClient,
    db_session: AsyncSession,
):
    attachment_id = str(uuid.uuid4())
    first = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": attachment_id},
        files=_pdf_file(),
    )
    second = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": attachment_id},
        data={"draft_key": "ignored-on-replay"},
        files={"file": ("ignored.txt", io.BytesIO(b"different"), "text/plain")},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()
    count = await db_session.scalar(
        select(func.count(ChatAttachment.id)).where(ChatAttachment.attachment_id == attachment_id)
    )
    assert count == 1
    assert len(list(Path(settings.chat_attachment_dir).rglob("*.pdf"))) == 1


@pytest.mark.asyncio
async def test_read_and_delete_pending_attachment(client: AsyncClient, db_session: AsyncSession):
    attachment_id = str(uuid.uuid4())
    uploaded = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": attachment_id},
        files=_pdf_file(),
    )
    assert uploaded.status_code == 201

    content = await client.get(f"/api/v1/chat/attachments/{attachment_id}/content")
    assert content.status_code == 200
    assert content.content == b"%PDF-1.4\nchat attachment"
    assert content.headers["content-type"].startswith("application/pdf")

    deleted = await client.delete(f"/api/v1/chat/attachments/{attachment_id}")
    assert deleted.status_code == 204
    assert await db_session.scalar(
        select(func.count(ChatAttachment.id)).where(ChatAttachment.attachment_id == attachment_id)
    ) == 0
    assert (await client.get(f"/api/v1/chat/attachments/{attachment_id}/content")).status_code == 404


@pytest.mark.asyncio
async def test_attachment_content_and_delete_are_user_scoped(
    client: AsyncClient,
    db_session: AsyncSession,
):
    attachment_id = str(uuid.uuid4())
    uploaded = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": attachment_id},
        files=_pdf_file(),
    )
    assert uploaded.status_code == 201

    other_user = User(username="other-user", password_hash="mock")
    db_session.add(other_user)
    await db_session.commit()
    await db_session.refresh(other_user)

    original_override = app.dependency_overrides[get_current_user]

    async def override_other_user():
        return other_user

    app.dependency_overrides[get_current_user] = override_other_user
    try:
        assert (await client.get(f"/api/v1/chat/attachments/{attachment_id}/content")).status_code == 404
        assert (await client.delete(f"/api/v1/chat/attachments/{attachment_id}")).status_code == 404
        other_upload = await client.post(
            "/api/v1/chat/attachments",
            headers={"X-Attachment-Id": attachment_id},
            files={"file": ("other.txt", io.BytesIO(b"other user"), "text/plain")},
        )
        assert other_upload.status_code == 201
        assert other_upload.json()["id"] == attachment_id
    finally:
        app.dependency_overrides[get_current_user] = original_override

    rows = (
        await db_session.execute(
            select(ChatAttachment).where(ChatAttachment.attachment_id == attachment_id)
        )
    ).scalars().all()
    assert {row.user_id for row in rows} == {1, other_user.id}


@pytest.mark.asyncio
async def test_attached_attachment_cannot_be_deleted(
    client: AsyncClient,
    db_session: AsyncSession,
):
    attachment_id = str(uuid.uuid4())
    uploaded = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": attachment_id},
        files=_pdf_file(),
    )
    assert uploaded.status_code == 201

    conversation = Conversation(title="attachment", user_id=1)
    db_session.add(conversation)
    await db_session.flush()
    message = Message(conversation_id=conversation.id, role="user", content="see attachment")
    db_session.add(message)
    await db_session.flush()
    attachment = (
        await db_session.execute(
            select(ChatAttachment).where(ChatAttachment.attachment_id == attachment_id)
        )
    ).scalar_one()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    attachment.status = "attached"
    attachment.claim_token = str(uuid.uuid4())
    attachment.claimed_at = now
    attachment.message_id = message.id
    attachment.attached_at = now
    await db_session.commit()

    response = await client.delete(f"/api/v1/chat/attachments/{attachment_id}")

    assert response.status_code == 409
    assert (await client.get(f"/api/v1/chat/attachments/{attachment_id}/content")).status_code == 200


@pytest.mark.asyncio
async def test_upload_runs_bounded_expired_pending_cleanup(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "chat_attachment_pending_ttl_seconds", 1)
    expired_id = str(uuid.uuid4())
    expired = await create_or_reuse_attachment(
        db_session,
        upload=UploadFile(filename="old.txt", file=io.BytesIO(b"old"), headers={"content-type": "text/plain"}),
        attachment_id=expired_id,
        user_id=1,
    )
    expired.expires_at = datetime(2000, 1, 1)
    expired_path = Path(settings.chat_attachment_dir) / expired.stored_path
    await db_session.commit()

    response = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": str(uuid.uuid4())},
        files={"file": ("new.txt", io.BytesIO(b"new"), "text/plain")},
    )

    assert response.status_code == 201
    assert await db_session.scalar(
        select(func.count(ChatAttachment.id)).where(ChatAttachment.attachment_id == expired_id)
    ) == 0
    assert not expired_path.exists()


@pytest.mark.asyncio
async def test_claim_prepare_and_release_preserve_order_and_mark_truncation(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "chat_attachment_max_document_chars", 5)
    monkeypatch.setattr(settings, "chat_attachment_max_total_document_chars", 7)
    first_id = str(uuid.uuid4())
    second_id = str(uuid.uuid4())
    for attachment_id, name, content in (
        (first_id, "first.txt", b"abcdefgh"),
        (second_id, "second.md", b"123456"),
    ):
        await create_or_reuse_attachment(
            db_session,
            upload=UploadFile(
                filename=name,
                file=io.BytesIO(content),
                headers={"content-type": "text/plain"},
            ),
            attachment_id=attachment_id,
            user_id=1,
        )

    claim_token, claimed = await claim_attachments(
        db_session,
        attachment_ids=[second_id, first_id],
        user_id=1,
    )
    prepared = await prepare_claimed_attachments(claimed)
    await db_session.commit()

    assert claim_token
    assert [item.attachment.attachment_id for item in prepared] == [second_id, first_id]
    assert [item.document_text for item in prepared] == ["12345", "ab"]
    assert [item.extraction_truncated for item in prepared] == [True, True]

    released = await release_attachment_claim(
        db_session,
        claim_token=claim_token,
        user_id=1,
    )
    assert released == 2
    db_session.expire_all()
    released_rows = list(
        (
            await db_session.execute(
                select(ChatAttachment).where(
                    ChatAttachment.attachment_id.in_([first_id, second_id])
                )
            )
        ).scalars().all()
    )
    assert all(item.status == "pending" for item in released_rows)


@pytest.mark.asyncio
async def test_stale_claim_is_recovered_to_pending(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    attachment_id = str(uuid.uuid4())
    await create_or_reuse_attachment(
        db_session,
        upload=UploadFile(
            filename="stale.txt",
            file=io.BytesIO(b"stale"),
            headers={"content-type": "text/plain"},
        ),
        attachment_id=attachment_id,
        user_id=1,
    )
    _, claimed = await claim_attachments(
        db_session,
        attachment_ids=[attachment_id],
        user_id=1,
    )
    claimed[0].claimed_at = datetime(2000, 1, 1)
    await db_session.commit()
    monkeypatch.setattr(settings, "chat_attachment_claim_ttl_seconds", 1)

    assert await recover_stale_claimed_attachments(db_session) == 1
    db_session.expire_all()
    recovered = await get_owned_attachment(
        db_session,
        attachment_id=attachment_id,
        user_id=1,
    )
    assert recovered is not None
    assert recovered.status == "pending"
    assert recovered.claim_token is None


@pytest.mark.asyncio
async def test_upload_enforces_per_user_pending_quota(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "chat_attachment_max_pending_count_per_user", 1)
    first = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": str(uuid.uuid4())},
        files={"file": ("first.txt", io.BytesIO(b"first"), "text/plain")},
    )
    second = await client.post(
        "/api/v1/chat/attachments",
        headers={"X-Attachment-Id": str(uuid.uuid4())},
        files={"file": ("second.txt", io.BytesIO(b"second"), "text/plain")},
    )
    assert first.status_code == 201
    assert second.status_code == 413


@pytest.mark.asyncio
async def test_claim_is_user_scoped_and_rejects_concurrent_reuse(
    db_session: AsyncSession,
):
    attachment_id = str(uuid.uuid4())
    await create_or_reuse_attachment(
        db_session,
        upload=UploadFile(
            filename="notes.txt",
            file=io.BytesIO(b"notes"),
            headers={"content-type": "text/plain"},
        ),
        attachment_id=attachment_id,
        user_id=1,
    )

    with pytest.raises(ChatAttachmentNotFoundError):
        await claim_attachments(
            db_session,
            attachment_ids=[attachment_id],
            user_id=999,
        )

    await claim_attachments(
        db_session,
        attachment_ids=[attachment_id],
        user_id=1,
    )
    with pytest.raises(ChatAttachmentStateError):
        await claim_attachments(
            db_session,
            attachment_ids=[attachment_id],
            user_id=1,
        )
