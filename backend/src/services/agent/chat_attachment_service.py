"""Storage and lifecycle operations for user-scoped AI chat attachments."""

import asyncio
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
from typing import Literal
import uuid
from zipfile import BadZipFile, ZipFile

from fastapi import UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core.exceptions import OwnershipError
from src.core.path_guard import attachment_stored_path
from src.database.models import ChatAttachment
from src.utils.file_parser import parse_path

logger = logging.getLogger(__name__)

_ALLOWED_MEDIA_TYPES: dict[str, set[str]] = {
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".webp": {"image/webp"},
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
}


class ChatAttachmentError(Exception):
    """Base attachment service error."""


class ChatAttachmentValidationError(ChatAttachmentError):
    pass


class ChatAttachmentTooLargeError(ChatAttachmentValidationError):
    pass


class ChatAttachmentNotFoundError(ChatAttachmentError):
    pass


class ChatAttachmentStateError(ChatAttachmentError):
    pass


@dataclass(frozen=True)
class PreparedChatAttachment:
    attachment: ChatAttachment
    position: int
    kind: Literal["image", "file"]
    image_base64: str | None = None
    document_text: str | None = None
    extraction_truncated: bool = False


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _validated_settings() -> tuple[int, int, int, int]:
    max_size = settings.chat_attachment_max_file_size_bytes
    chunk_size = settings.chat_attachment_upload_chunk_size_bytes
    ttl_seconds = settings.chat_attachment_pending_ttl_seconds
    cleanup_batch_size = settings.chat_attachment_cleanup_batch_size
    if min(max_size, chunk_size, ttl_seconds, cleanup_batch_size) <= 0:
        raise RuntimeError("Chat attachment size, chunk, TTL, and cleanup settings must be positive")
    return max_size, chunk_size, ttl_seconds, cleanup_batch_size


def _normalize_original_name(filename: str | None) -> tuple[str, str]:
    original_name = (filename or "").strip()
    if not original_name:
        raise ChatAttachmentValidationError("Attachment filename is required")
    safe_name = original_name.replace("\\", "/").rsplit("/", 1)[-1]
    if safe_name in {"", ".", ".."} or safe_name != original_name:
        raise ChatAttachmentValidationError("Attachment filename must not contain a path")
    if len(safe_name) > 300:
        raise ChatAttachmentValidationError("Attachment filename exceeds 300 characters")
    extension = Path(safe_name).suffix.lower()
    if extension not in _ALLOWED_MEDIA_TYPES:
        raise ChatAttachmentValidationError(f"Unsupported attachment type: {extension or 'missing extension'}")
    return safe_name, extension


def _normalize_media_type(content_type: str | None, extension: str) -> str:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in _ALLOWED_MEDIA_TYPES[extension]:
        raise ChatAttachmentValidationError(
            f"Content type {media_type or 'missing'} does not match {extension}"
        )
    return media_type


def _validate_zip_members(path: Path, required_member: str) -> None:
    try:
        with ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > 10_000 or sum(member.file_size for member in members) > 100 * 1024 * 1024:
                raise ChatAttachmentValidationError("Office attachment expands beyond its safe limit")
            names = {member.filename for member in members}
            if "[Content_Types].xml" not in names or required_member not in names:
                raise ChatAttachmentValidationError("Office attachment structure is invalid")
    except (BadZipFile, OSError) as exc:
        raise ChatAttachmentValidationError("Office attachment archive is invalid") from exc


def _validate_text_file(path: Path) -> None:
    try:
        content = path.read_bytes()
        text = content.decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise ChatAttachmentValidationError("Text attachments must be valid UTF-8") from exc
    if "\x00" in text:
        raise ChatAttachmentValidationError("Text attachment contains binary data")


def _validate_file_signature(path: Path, extension: str) -> None:
    try:
        with path.open("rb") as handle:
            prefix = handle.read(16)
    except OSError as exc:
        raise ChatAttachmentError("Attachment could not be read after upload") from exc

    valid = True
    if extension == ".png":
        valid = prefix.startswith(b"\x89PNG\r\n\x1a\n")
    elif extension in {".jpg", ".jpeg"}:
        valid = prefix.startswith(b"\xff\xd8\xff")
    elif extension == ".webp":
        valid = len(prefix) >= 12 and prefix[:4] == b"RIFF" and prefix[8:12] == b"WEBP"
    elif extension == ".pdf":
        valid = prefix.startswith(b"%PDF-")
    elif extension == ".docx":
        _validate_zip_members(path, "word/document.xml")
    elif extension == ".xlsx":
        _validate_zip_members(path, "xl/workbook.xml")
    elif extension in {".txt", ".md"}:
        _validate_text_file(path)

    if not valid:
        raise ChatAttachmentValidationError(f"Attachment content does not match {extension}")


async def _safe_unlink(path: Path) -> None:
    try:
        await asyncio.to_thread(path.unlink, missing_ok=True)
    except OSError:
        logger.exception("Failed to remove chat attachment file: %s", path)


async def recover_stale_claimed_attachments(
    db: AsyncSession,
    *,
    user_id: int | None = None,
    limit: int | None = None,
) -> int:
    _, _, _, configured_limit = _validated_settings()
    batch_limit = configured_limit if limit is None else limit
    claim_ttl = settings.chat_attachment_claim_ttl_seconds
    if batch_limit <= 0 or claim_ttl <= 0:
        return 0
    cutoff = utcnow() - timedelta(seconds=claim_ttl)
    conditions = [
        ChatAttachment.status == "claimed",
        ChatAttachment.claimed_at.is_not(None),
        ChatAttachment.claimed_at <= cutoff,
    ]
    if user_id is not None:
        conditions.append(ChatAttachment.user_id == user_id)
    stale = list(
        (
            await db.execute(
                select(
                    ChatAttachment.id,
                    ChatAttachment.claim_token,
                    ChatAttachment.claimed_at,
                )
                .where(*conditions)
                .order_by(ChatAttachment.claimed_at, ChatAttachment.id)
                .limit(batch_limit)
            )
        ).all()
    )
    if not stale:
        return 0
    now = utcnow()
    recovered = 0
    for attachment_id, claim_token, claimed_at in stale:
        result = await db.execute(
            update(ChatAttachment)
            .where(
                ChatAttachment.id == attachment_id,
                ChatAttachment.status == "claimed",
                ChatAttachment.claim_token == claim_token,
                ChatAttachment.claimed_at == claimed_at,
                ChatAttachment.claimed_at <= cutoff,
            )
            .values(status="pending", claim_token=None, claimed_at=None, updated_at=now)
        )
        recovered += result.rowcount or 0
    await db.commit()
    return recovered


async def cleanup_expired_pending_attachments(
    db: AsyncSession,
    *,
    limit: int | None = None,
) -> int:
    """Delete a bounded batch of expired pending rows and their files."""
    _, _, _, configured_limit = _validated_settings()
    batch_limit = configured_limit if limit is None else limit
    if batch_limit <= 0:
        return 0

    cutoff = utcnow()
    expired = list(
        (
            await db.execute(
                select(ChatAttachment.id, ChatAttachment.user_id, ChatAttachment.stored_path)
                .where(
                    ChatAttachment.status == "pending",
                    ChatAttachment.expires_at <= cutoff,
                )
                .order_by(ChatAttachment.expires_at, ChatAttachment.id)
                .limit(batch_limit)
            )
        ).all()
    )
    if not expired:
        return 0

    deleted_paths: list[tuple[int, str]] = []
    for attachment_id, _, _ in expired:
        result = await db.execute(
            delete(ChatAttachment)
            .where(
                ChatAttachment.id == attachment_id,
                ChatAttachment.status == "pending",
                ChatAttachment.expires_at <= cutoff,
            )
            .returning(ChatAttachment.user_id, ChatAttachment.stored_path)
        )
        deleted_path = result.one_or_none()
        if deleted_path is not None:
            deleted_paths.append((deleted_path.user_id, deleted_path.stored_path))
    await db.commit()

    for user_id, stored_path in deleted_paths:
        try:
            await _safe_unlink(attachment_stored_path(user_id, stored_path))
        except OwnershipError:
            logger.exception("Invalid stored path while cleaning attachment")
    return len(deleted_paths)


async def best_effort_cleanup_expired_pending_attachments(
    db: AsyncSession,
    *,
    user_id: int | None = None,
) -> None:
    try:
        await recover_stale_claimed_attachments(db, user_id=user_id)
        await cleanup_expired_pending_attachments(db)
    except Exception:
        await db.rollback()
        logger.exception("Expired chat attachment cleanup failed (best-effort)")


async def get_owned_attachment(
    db: AsyncSession,
    *,
    attachment_id: str,
    user_id: int,
) -> ChatAttachment | None:
    return (
        await db.execute(
            select(ChatAttachment).where(
                ChatAttachment.attachment_id == attachment_id,
                ChatAttachment.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def create_or_reuse_attachment(
    db: AsyncSession,
    *,
    upload: UploadFile,
    attachment_id: str,
    user_id: int,
    draft_key: str | None = None,
) -> ChatAttachment:
    """Store one validated attachment, keyed idempotently within the current user."""
    try:
        normalized_id = str(uuid.UUID(attachment_id))
    except ValueError as exc:
        raise ChatAttachmentValidationError("X-Attachment-Id must be a UUID") from exc

    normalized_draft_key = draft_key.strip() if draft_key else None
    if normalized_draft_key and len(normalized_draft_key) > 120:
        raise ChatAttachmentValidationError("draft_key exceeds 120 characters")

    await best_effort_cleanup_expired_pending_attachments(db, user_id=user_id)
    existing = await get_owned_attachment(db, attachment_id=normalized_id, user_id=user_id)
    if existing is not None:
        return existing

    max_pending_count = settings.chat_attachment_max_pending_count_per_user
    max_pending_size = settings.chat_attachment_max_pending_size_bytes_per_user
    if min(max_pending_count, max_pending_size) <= 0:
        raise RuntimeError("Chat attachment pending limits must be positive")
    pending_count, pending_size = (
        await db.execute(
            select(func.count(ChatAttachment.id), func.coalesce(func.sum(ChatAttachment.size_bytes), 0))
            .where(
                ChatAttachment.user_id == user_id,
                ChatAttachment.status.in_(["pending", "claimed"]),
            )
        )
    ).one()
    pending_count = int(pending_count or 0)
    pending_size = int(pending_size or 0)
    if pending_count >= max_pending_count:
        raise ChatAttachmentTooLargeError("Too many pending chat attachments")
    if pending_size >= max_pending_size:
        raise ChatAttachmentTooLargeError("Pending chat attachments exceed the user storage limit")

    original_name, extension = _normalize_original_name(upload.filename)
    media_type = _normalize_media_type(upload.content_type, extension)
    configured_max_size, chunk_size, ttl_seconds, _ = _validated_settings()
    type_max_size = (
        settings.chat_attachment_max_image_size_bytes
        if media_type.startswith("image/")
        else settings.chat_attachment_max_document_size_bytes
    )
    max_size = min(configured_max_size, type_max_size)
    if max_size <= 0:
        raise RuntimeError("Chat attachment type size limits must be positive")
    if upload.size is not None and upload.size > max_size:
        raise ChatAttachmentTooLargeError(f"Attachment exceeds {max_size} byte limit")

    user_relative_dir = Path(str(user_id))
    user_dir = attachment_stored_path(user_id, user_relative_dir)
    await asyncio.to_thread(user_dir.mkdir, parents=True, exist_ok=True)
    storage_name = f"{uuid.uuid4().hex}{extension}"
    stored_path = (user_relative_dir / storage_name).as_posix()
    final_path = attachment_stored_path(user_id, stored_path)
    temporary_path = user_dir / f".{storage_name}.{uuid.uuid4().hex}.part"

    total = 0
    output = None
    moved_to_final = False
    try:
        output = await asyncio.to_thread(temporary_path.open, "xb")
        while True:
            chunk = await upload.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_size:
                raise ChatAttachmentTooLargeError(f"Attachment exceeds {max_size} byte limit")
            await asyncio.to_thread(output.write, chunk)
        if total == 0:
            raise ChatAttachmentValidationError("Uploaded attachment is empty")
        if pending_size + total > max_pending_size:
            raise ChatAttachmentTooLargeError("Pending chat attachments exceed the user storage limit")
        await asyncio.to_thread(output.flush)
        await asyncio.to_thread(os.fsync, output.fileno())
        await asyncio.to_thread(output.close)
        output = None
        await asyncio.to_thread(_validate_file_signature, temporary_path, extension)
        await asyncio.to_thread(os.replace, temporary_path, final_path)
        moved_to_final = True

        now = utcnow()
        attachment = ChatAttachment(
            attachment_id=normalized_id,
            user_id=user_id,
            draft_key=normalized_draft_key,
            original_name=original_name,
            stored_path=stored_path,
            media_type=media_type,
            size_bytes=total,
            status="pending",
            expires_at=now + timedelta(seconds=ttl_seconds),
            created_at=now,
            updated_at=now,
        )
        db.add(attachment)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            await _safe_unlink(final_path)
            existing = await get_owned_attachment(db, attachment_id=normalized_id, user_id=user_id)
            if existing is not None:
                return existing
            raise
        await db.refresh(attachment)
        return attachment
    except asyncio.CancelledError:
        if output is not None:
            await asyncio.to_thread(output.close)
        await _safe_unlink(temporary_path)
        if moved_to_final:
            await _safe_unlink(final_path)
        raise
    except Exception:
        if output is not None:
            await asyncio.to_thread(output.close)
        await _safe_unlink(temporary_path)
        if moved_to_final:
            await _safe_unlink(final_path)
        await db.rollback()
        raise


def _validated_message_limits() -> tuple[int, int, int, int, int, int]:
    values = (
        settings.chat_attachment_max_count_per_message,
        settings.chat_attachment_max_total_size_bytes,
        settings.chat_attachment_max_image_size_bytes,
        settings.chat_attachment_max_document_size_bytes,
        settings.chat_attachment_max_document_chars,
        settings.chat_attachment_max_total_document_chars,
    )
    if min(values) <= 0:
        raise RuntimeError("Chat attachment message limits must be positive")
    return values


def _normalize_attachment_ids(attachment_ids: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for attachment_id in attachment_ids:
        try:
            item = str(uuid.UUID(attachment_id))
        except ValueError as exc:
            raise ChatAttachmentValidationError("Attachment id must be a UUID") from exc
        if item in seen:
            raise ChatAttachmentValidationError("The same attachment cannot be sent twice")
        seen.add(item)
        normalized.append(item)
    return normalized


async def claim_attachments(
    db: AsyncSession,
    *,
    attachment_ids: list[str],
    user_id: int,
    claim_token: str | None = None,
) -> tuple[str | None, list[ChatAttachment]]:
    """Atomically claim the current user's pending attachments in request order."""
    normalized = _normalize_attachment_ids(attachment_ids)
    if not normalized:
        return None, []

    max_count, max_total_size, max_image_size, max_document_size, _, _ = (
        _validated_message_limits()
    )
    if len(normalized) > max_count:
        raise ChatAttachmentValidationError(
            f"A message may contain at most {max_count} attachments"
        )

    rows = list(
        (
            await db.execute(
                select(ChatAttachment).where(
                    ChatAttachment.user_id == user_id,
                    ChatAttachment.attachment_id.in_(normalized),
                )
            )
        ).scalars().all()
    )
    by_id = {row.attachment_id: row for row in rows}
    if len(by_id) != len(normalized):
        raise ChatAttachmentNotFoundError("Attachment not found")

    ordered = [by_id[item] for item in normalized]
    total_size = 0
    for attachment in ordered:
        if attachment.status != "pending":
            raise ChatAttachmentStateError("Attachment is already being used")
        if attachment.expires_at <= utcnow():
            raise ChatAttachmentStateError("Attachment has expired; upload it again")
        per_file_limit = (
            max_image_size
            if attachment.media_type.startswith("image/")
            else max_document_size
        )
        if attachment.size_bytes > per_file_limit:
            raise ChatAttachmentTooLargeError(
                f"Attachment {attachment.original_name} exceeds its size limit"
            )
        total_size += attachment.size_bytes
    if total_size > max_total_size:
        raise ChatAttachmentTooLargeError(
            f"Attachments exceed {max_total_size} byte total limit"
        )

    if claim_token is None:
        claim_token = str(uuid.uuid4())
    else:
        try:
            claim_token = str(uuid.UUID(claim_token))
        except ValueError as exc:
            raise ChatAttachmentValidationError("Claim token must be a UUID") from exc
    now = utcnow()
    result = await db.execute(
        update(ChatAttachment)
        .where(
            ChatAttachment.user_id == user_id,
            ChatAttachment.attachment_id.in_(normalized),
            ChatAttachment.status == "pending",
            ChatAttachment.expires_at > now,
        )
        .values(status="claimed", claim_token=claim_token, claimed_at=now, updated_at=now)
    )
    if result.rowcount != len(normalized):
        await db.rollback()
        raise ChatAttachmentStateError("One or more attachments are already being used")
    await db.commit()

    claimed = list(
        (
            await db.execute(
                select(ChatAttachment).where(
                    ChatAttachment.user_id == user_id,
                    ChatAttachment.claim_token == claim_token,
                    ChatAttachment.status == "claimed",
                )
            )
        ).scalars().all()
    )
    claimed_by_id = {row.attachment_id: row for row in claimed}
    return claim_token, [claimed_by_id[item] for item in normalized]


async def refresh_attachment_claim(
    db: AsyncSession,
    *,
    claim_token: str | None,
    user_id: int,
) -> int:
    if not claim_token:
        return 0
    now = utcnow()
    result = await db.execute(
        update(ChatAttachment)
        .where(
            ChatAttachment.user_id == user_id,
            ChatAttachment.claim_token == claim_token,
            ChatAttachment.status == "claimed",
        )
        .values(claimed_at=now, updated_at=now)
    )
    await db.commit()
    return result.rowcount or 0


async def release_attachment_claim(
    db: AsyncSession,
    *,
    claim_token: str | None,
    user_id: int,
) -> int:
    if not claim_token:
        return 0
    now = utcnow()
    result = await db.execute(
        update(ChatAttachment)
        .where(
            ChatAttachment.user_id == user_id,
            ChatAttachment.claim_token == claim_token,
            ChatAttachment.status == "claimed",
        )
        .values(status="pending", claim_token=None, claimed_at=None, updated_at=now)
    )
    await db.commit()
    return result.rowcount or 0


def _read_text_attachment(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise ChatAttachmentValidationError("Text attachment could not be read") from exc


def _parse_document_attachment(path: Path) -> str:
    if path.suffix.lower() in {".txt", ".md"}:
        return _read_text_attachment(path)
    try:
        return parse_path(path)
    except Exception as exc:
        raise ChatAttachmentValidationError(
            f"Document attachment could not be parsed: {path.suffix.lower()}"
        ) from exc


async def prepare_claimed_attachments(
    attachments: list[ChatAttachment],
) -> list[PreparedChatAttachment]:
    """Read only already claimed, server-stored files and preserve request order."""
    _, _, _, _, max_document_chars, max_total_document_chars = _validated_message_limits()
    remaining_document_chars = max_total_document_chars
    prepared: list[PreparedChatAttachment] = []

    for position, attachment in enumerate(attachments):
        if attachment.status != "claimed" or not attachment.claim_token:
            raise ChatAttachmentStateError("Attachment is not claimed for this message")
        path = attachment_stored_path(attachment.user_id, attachment.stored_path)
        if not await asyncio.to_thread(path.is_file):
            raise ChatAttachmentNotFoundError(
                f"Attachment content not found: {attachment.original_name}"
            )

        if attachment.media_type.startswith("image/"):
            try:
                content = await asyncio.to_thread(path.read_bytes)
            except OSError as exc:
                raise ChatAttachmentNotFoundError(
                    f"Attachment content not found: {attachment.original_name}"
                ) from exc
            prepared.append(
                PreparedChatAttachment(
                    attachment=attachment,
                    position=position,
                    kind="image",
                    image_base64=base64.b64encode(content).decode("ascii"),
                )
            )
            continue

        if attachment.extracted_text is None:
            full_text = await asyncio.to_thread(_parse_document_attachment, path)
        else:
            full_text = attachment.extracted_text
        full_text = full_text.strip()
        per_file_text = full_text[:max_document_chars]
        text = per_file_text[:remaining_document_chars]
        truncated = len(full_text) > len(text)
        remaining_document_chars = max(0, remaining_document_chars - len(text))
        attachment.extracted_text = per_file_text
        attachment.extraction_truncated = truncated
        prepared.append(
            PreparedChatAttachment(
                attachment=attachment,
                position=position,
                kind="file",
                document_text=text,
                extraction_truncated=truncated,
            )
        )

    return prepared


async def prepare_history_attachments(
    db: AsyncSession,
    *,
    message_ids: list[int],
    user_id: int,
) -> dict[int, list[PreparedChatAttachment]]:
    if not message_ids:
        return {}
    attachments = list(
        (
            await db.execute(
                select(ChatAttachment)
                .where(
                    ChatAttachment.user_id == user_id,
                    ChatAttachment.message_id.in_(message_ids),
                    ChatAttachment.status == "attached",
                )
                .order_by(ChatAttachment.message_id, ChatAttachment.position)
            )
        ).scalars().all()
    )
    prepared_by_message: dict[int, list[PreparedChatAttachment]] = {}
    for attachment in attachments:
        if attachment.message_id is None:
            continue
        path = attachment_stored_path(attachment.user_id, attachment.stored_path)
        if not await asyncio.to_thread(path.is_file):
            logger.warning("历史聊天附件内容缺失: attachment_id=%s", attachment.attachment_id)
            continue
        position = attachment.position or 0
        if attachment.media_type.startswith("image/"):
            image_base64 = attachment.image_base64_cache
            if not image_base64:
                try:
                    content = await asyncio.to_thread(path.read_bytes)
                except OSError:
                    logger.warning("历史图片附件读取失败: attachment_id=%s", attachment.attachment_id)
                    continue
                image_base64 = base64.b64encode(content).decode("ascii")
                attachment.image_base64_cache = image_base64
            item = PreparedChatAttachment(
                attachment=attachment,
                position=position,
                kind="image",
                image_base64=image_base64,
            )
        else:
            text = attachment.extracted_text
            if text is None:
                try:
                    text = await asyncio.to_thread(_parse_document_attachment, path)
                except ChatAttachmentValidationError:
                    logger.warning("历史文档附件解析失败: attachment_id=%s", attachment.attachment_id)
                    continue
                text = text[: settings.chat_attachment_max_document_chars]
                attachment.extracted_text = text
            item = PreparedChatAttachment(
                attachment=attachment,
                position=position,
                kind="file",
                document_text=text,
                extraction_truncated=attachment.extraction_truncated,
            )
        prepared_by_message.setdefault(attachment.message_id, []).append(item)
    return prepared_by_message


async def get_attachment_content(
    db: AsyncSession,
    *,
    attachment_id: str,
    user_id: int,
) -> tuple[ChatAttachment, Path]:
    attachment = await get_owned_attachment(db, attachment_id=attachment_id, user_id=user_id)
    if attachment is None:
        raise ChatAttachmentNotFoundError("Attachment not found")
    path = attachment_stored_path(attachment.user_id, attachment.stored_path)
    if not await asyncio.to_thread(path.is_file):
        raise ChatAttachmentNotFoundError("Attachment content not found")
    return attachment, path


async def delete_pending_attachment(
    db: AsyncSession,
    *,
    attachment_id: str,
    user_id: int,
) -> None:
    result = await db.execute(
        delete(ChatAttachment)
        .where(
            ChatAttachment.attachment_id == attachment_id,
            ChatAttachment.user_id == user_id,
            ChatAttachment.status == "pending",
        )
        .returning(ChatAttachment.user_id, ChatAttachment.stored_path)
    )
    deleted_path = result.one_or_none()
    if deleted_path is None:
        attachment = await get_owned_attachment(
            db,
            attachment_id=attachment_id,
            user_id=user_id,
        )
        if attachment is None:
            await db.rollback()
            raise ChatAttachmentNotFoundError("Attachment not found")
        attachment_status = attachment.status
        await db.rollback()
        raise ChatAttachmentStateError(
            f"{attachment_status.capitalize()} attachment cannot be deleted"
        )

    await db.commit()
    try:
        await _safe_unlink(attachment_stored_path(deleted_path.user_id, deleted_path.stored_path))
    except OwnershipError:
        logger.exception("Invalid stored path while deleting attachment")
