"""Workspace-owned database indexes that remain after filesystem cutover."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow


class RagSource(Base):
    """An explicit AI-knowledge source and its indexing state machine."""

    __tablename__ = "rag_sources"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_rag_sources_resource"),
        Index("ix_rag_sources_user_status", "user_id", "index_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(30), nullable=False)
    resource_id: Mapped[int] = mapped_column(Integer, nullable=False)
    index_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    indexed_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    collection_name: Mapped[str] = mapped_column(String(200), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WorkspaceTrashEntry(Base):
    """Physical workspace item moved into a user's recoverable trash area."""

    __tablename__ = "workspace_trash_entries"
    __table_args__ = (
        Index("ix_workspace_trash_entries_user_deleted", "user_id", "deleted_at"),
        Index("ix_workspace_trash_entries_blog", "blog_post_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(30), nullable=False)  # workspace_file / blog_post
    blog_post_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_path: Mapped[str] = mapped_column(String(500), nullable=False)
    trashed_path: Mapped[str] = mapped_column(String(600), nullable=False, unique=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
