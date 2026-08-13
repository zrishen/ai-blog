"""文件库模型：文档 + 处理任务。"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
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


class FileDocument(Base):
    __tablename__ = "file_documents"
    __table_args__ = (Index("ix_file_documents_user_deleted", "user_id", "deleted_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_name: Mapped[str] = mapped_column(String(200), nullable=False)
    user_id: Mapped[str] = mapped_column(String(100), nullable=False, default="default_user")
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    chunk_content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[str | None] = mapped_column("metadata", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FileProcessingJob(Base):
    __tablename__ = "file_processing_jobs"
    __table_args__ = (
        UniqueConstraint("active_key", name="uq_file_processing_jobs_active_key"),
        UniqueConstraint("user_id", "client_request_id", name="uq_file_processing_jobs_user_request"),
        Index("ix_file_processing_jobs_user_status", "user_id", "status"),
        Index("ix_file_processing_jobs_heartbeat", "heartbeat_at"),
        Index("ix_file_processing_jobs_source_document", "source_document_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="staging")
    current_stage: Mapped[str] = mapped_column(String(40), nullable=False)
    progress_model_version: Mapped[str] = mapped_column(String(30), nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_json: Mapped[Any] = mapped_column(JSONB, nullable=False, default=dict)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    source_document_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("file_documents.id", ondelete="SET NULL"), nullable=True
    )
    result_document_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("file_documents.id", ondelete="SET NULL"), nullable=True
    )
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    stored_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    collection_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # index job 专属：被索引的目标资源（file / blog_post）；upload/restore 留空。
    # progress_json 会被 _normalize_progress 重建擦除，故目标资源走独立列。
    target_resource_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 上传时是否自动索引（RAG）；默认 False——上传仅存文件+建元记录，索引由「加入 AI 知识」触发
    auto_index: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    staging_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    execution_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
