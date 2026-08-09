"""Workspace-owned database indexes that remain after filesystem cutover."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from .base import Base, _utcnow


class RagSource(Base):
    """An explicit AI-knowledge source and its indexing state machine."""

    __tablename__ = "rag_sources"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_rag_sources_resource"),
        Index("ix_rag_sources_user_status", "user_id", "index_status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    resource_type = Column(String(30), nullable=False)
    resource_id = Column(Integer, nullable=False)
    index_status = Column(String(20), nullable=False, default="pending")
    indexed_version = Column(String(64), nullable=True)
    collection_name = Column(String(200), nullable=False)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    indexed_at = Column(DateTime, nullable=True)
