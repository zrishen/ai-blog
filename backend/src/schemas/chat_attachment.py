"""AI chat attachment response schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from src.database.models import ChatAttachment


ChatAttachmentStatus = Literal["pending", "claimed", "attached"]
ChatAttachmentKind = Literal["image", "file"]


class ChatAttachmentResponse(BaseModel):
    id: str
    kind: ChatAttachmentKind
    original_name: str
    mime_type: str
    size_bytes: int
    status: ChatAttachmentStatus
    position: int | None = None
    download_url: str
    extraction_truncated: bool = False
    # 保留旧响应名，供滚动升级中的客户端兼容。
    media_type: str
    content_url: str
    draft_key: str | None = None
    message_id: int | None = None
    expires_at: datetime
    claimed_at: datetime | None = None
    attached_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_attachment(cls, attachment: ChatAttachment) -> "ChatAttachmentResponse":
        content_url = f"/api/v1/chat/attachments/{attachment.attachment_id}/content"
        return cls(
            id=attachment.attachment_id,
            kind="image" if attachment.media_type.startswith("image/") else "file",
            original_name=attachment.original_name,
            mime_type=attachment.media_type,
            size_bytes=attachment.size_bytes,
            status=attachment.status,
            position=attachment.position,
            download_url=content_url,
            extraction_truncated=attachment.extraction_truncated,
            media_type=attachment.media_type,
            content_url=content_url,
            draft_key=attachment.draft_key,
            message_id=attachment.message_id,
            expires_at=attachment.expires_at,
            claimed_at=attachment.claimed_at,
            attached_at=attachment.attached_at,
            created_at=attachment.created_at,
            updated_at=attachment.updated_at,
        )
