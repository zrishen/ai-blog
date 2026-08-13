"""聊天域模型：会话 + 消息 + 聊天附件。"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_user_deleted", "user_id", "deleted_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # compact 上下文摘要：更早的历史被压成 summary，summary_until_message_id 标记已摘要到的消息 id（增量）
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_until_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tool_calls: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reasoning_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    thinking_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_events: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    loop_steps: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    thinking_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    thinking_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)


class ChatAttachment(Base):
    __tablename__ = "chat_attachments"
    __table_args__ = (
        UniqueConstraint("user_id", "attachment_id", name="uq_chat_attachments_user_attachment"),
        UniqueConstraint("stored_path", name="uq_chat_attachments_stored_path"),
        UniqueConstraint("message_id", "position", name="uq_chat_attachments_message_position"),
        CheckConstraint(
            "status IN ('pending', 'claimed', 'attached')",
            name="ck_chat_attachments_status",
        ),
        Index("ix_chat_attachments_user_status", "user_id", "status"),
        Index("ix_chat_attachments_user_draft_status", "user_id", "draft_key", "status"),
        Index("ix_chat_attachments_user_claim", "user_id", "claim_token", "status"),
        Index("ix_chat_attachments_pending_expires", "status", "expires_at"),
        Index("ix_chat_attachments_user_message", "user_id", "message_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attachment_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    draft_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    media_type: Mapped[str] = mapped_column(String(150), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # 图片 base64 缓存：避免每次构建历史消息时重复读盘 + 重编码（派生数据，可随时重建）
    image_base64_cache: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    extraction_truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    claim_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attached_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
