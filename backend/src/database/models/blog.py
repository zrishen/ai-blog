"""博客域模型：分类 + 文章。"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
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


class BlogCategory(Base):
    __tablename__ = "blog_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_blog_categories_user_slug"),
        UniqueConstraint("user_id", "name", name="uq_blog_categories_user_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)


class BlogPost(Base):
    __tablename__ = "blog_posts"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_blog_posts_user_slug"),
        CheckConstraint(
            "content_storage_state IN ('legacy', 'verified', 'error')",
            name="ck_blog_posts_content_storage_state",
        ),
        Index("ix_blog_posts_user_deleted", "user_id", "deleted_at"),
        Index("ix_blog_posts_published_revision", "published_revision_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")  # draft / published
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("blog_categories.id"), nullable=True)
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)
    author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Phase 2 file-content migration state.  The legacy DB body remains the
    # source of truth until a future verified backfill changes this state.
    content_storage_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="legacy", server_default="legacy"
    )
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_migrated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_storage_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, default=1)
    # AST 缓存(派生数据,可随时从 content 重建):文章正文的块结构数组,
    # 供 AI 章节定位(大纲/读单节)使用,避免读全文消耗 token。
    blocks_json: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    # The editable working copy lives on BlogPost. Public readers use this
    # immutable revision instead, so editing a published post is private until
    # the next explicit publish.
    published_revision_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BlogPostRevision(Base):
    """Immutable, user-created (or restore-safety) blog post snapshot."""

    __tablename__ = "blog_post_revisions"
    __table_args__ = (
        UniqueConstraint("post_id", "revision_number", name="uq_blog_post_revisions_number"),
        Index("ix_blog_post_revisions_post_created", "post_id", "created_at"),
        Index("ix_blog_post_revisions_user_post", "user_id", "post_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(Integer, ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # commit / publish (pre_restore may exist in legacy data)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("blog_categories.id"), nullable=True)
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)
    author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
