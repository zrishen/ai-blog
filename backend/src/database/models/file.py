"""文件库模型：文档 + 处理任务 + 分类。"""

from sqlalchemy import (
    Boolean,
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


class FileDocument(Base):
    __tablename__ = "file_documents"
    __table_args__ = (Index("ix_file_documents_user_deleted", "user_id", "deleted_at"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    collection_name = Column(String(200), nullable=False)
    user_id = Column(String(100), nullable=False, default="default_user")
    original_name = Column(String(300), nullable=False)
    file_path = Column(String(500), nullable=False)
    chunk_content = Column(Text, nullable=False)
    meta = Column("metadata", Text, nullable=True)
    category_id = Column(Integer, ForeignKey("file_categories.id"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    deleted_at = Column(DateTime, nullable=True)


class FileProcessingJob(Base):
    __tablename__ = "file_processing_jobs"
    __table_args__ = (
        UniqueConstraint("active_key", name="uq_file_processing_jobs_active_key"),
        UniqueConstraint("user_id", "client_request_id", name="uq_file_processing_jobs_user_request"),
        Index("ix_file_processing_jobs_user_status", "user_id", "status"),
        Index("ix_file_processing_jobs_heartbeat", "heartbeat_at"),
        Index("ix_file_processing_jobs_source_document", "source_document_id"),
    )

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_type = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, default="staging")
    current_stage = Column(String(40), nullable=False)
    progress_model_version = Column(String(30), nullable=False)
    progress_percent = Column(Integer, nullable=False, default=0)
    progress_json = Column(JSON, nullable=False, default=dict)
    client_request_id = Column(String(36), nullable=False)
    source_document_id = Column(Integer, ForeignKey("file_documents.id", ondelete="SET NULL"), nullable=True)
    result_document_id = Column(Integer, ForeignKey("file_documents.id", ondelete="SET NULL"), nullable=True)
    original_name = Column(String(300), nullable=False)
    stored_name = Column(String(300), nullable=True)
    collection_name = Column(String(200), nullable=False)
    category_id = Column(Integer, ForeignKey("file_categories.id", ondelete="SET NULL"), nullable=True)
    # index job 专属：被索引的目标资源（file / blog_post）；upload/restore 留空。
    # progress_json 会被 _normalize_progress 重建擦除，故目标资源走独立列。
    target_resource_type = Column(String(20), nullable=True)
    target_resource_id = Column(Integer, nullable=True)
    # 上传时是否自动索引（RAG）；默认 False——上传仅存文件+建元记录，索引由「加入 AI 知识」触发
    auto_index = Column(Boolean, nullable=False, default=False)
    staging_path = Column(String(500), nullable=True)
    active_key = Column(String(200), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    execution_token = Column(String(36), nullable=True)
    heartbeat_at = Column(DateTime, nullable=True)
    error_code = Column(String(80), nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)


class FileCategory(Base):
    __tablename__ = "file_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_file_categories_user_slug"),
        UniqueConstraint("user_id", "name", name="uq_file_categories_user_name"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("file_categories.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
