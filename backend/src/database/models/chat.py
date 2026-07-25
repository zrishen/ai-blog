"""聊天域模型：会话 + 消息 + 聊天附件。"""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, _utcnow


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_user_deleted", "user_id", "deleted_at"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True)
    # compact 上下文摘要：更早的历史被压成 summary，summary_until_message_id 标记已摘要到的消息 id（增量）
    summary = Column(Text, nullable=True)
    summary_until_message_id = Column(Integer, nullable=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    image_url = Column(Text, nullable=True)
    file_url = Column(Text, nullable=True)
    token_count = Column(Integer, default=0)
    tool_calls = Column(JSON, nullable=True)
    tool_call_id = Column(String(100), nullable=True)
    reasoning_content = Column(Text, nullable=True)
    thinking_content = Column(Text, nullable=True)
    tool_events = Column(JSON, nullable=True)
    loop_steps = Column(JSON, nullable=True)
    thinking_duration_ms = Column(Integer, nullable=True)
    thinking_mode = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=_utcnow)


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

    id = Column(Integer, primary_key=True, autoincrement=True)
    attachment_id = Column(String(36), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    draft_key = Column(String(120), nullable=True)
    original_name = Column(String(300), nullable=False)
    stored_path = Column(String(500), nullable=False)
    media_type = Column(String(150), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    position = Column(Integer, nullable=True)
    extracted_text = Column(Text, nullable=True)
    extraction_truncated = Column(Boolean, nullable=False, default=False)
    status = Column(String(20), nullable=False, default="pending")
    claim_token = Column(String(36), nullable=True)
    claimed_at = Column(DateTime, nullable=True)
    attached_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
