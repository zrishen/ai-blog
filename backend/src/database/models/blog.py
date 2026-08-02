"""博客域模型：分类 + 文章。"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, _utcnow


class BlogCategory(Base):
    __tablename__ = "blog_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_blog_categories_user_slug"),
        UniqueConstraint("user_id", "name", name="uq_blog_categories_user_name"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class BlogPost(Base):
    __tablename__ = "blog_posts"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_blog_posts_user_slug"),
        Index("ix_blog_posts_user_deleted", "user_id", "deleted_at"),
        Index("ix_blog_posts_published_revision", "published_revision_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(300), nullable=False)
    slug = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)
    excerpt = Column(String(500), nullable=True)
    cover_image = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="draft")  # draft / published / archived
    category_id = Column(Integer, ForeignKey("blog_categories.id"), nullable=True)
    tags = Column(String(500), nullable=True)
    author = Column(String(100), nullable=True)
    view_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    published_at = Column(DateTime, nullable=True)
    file_path = Column(String(500), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1)
    # AST 缓存(派生数据,可随时从 content 重建):文章正文的块结构数组,
    # 供 AI 章节定位(大纲/读单节)使用,避免读全文消耗 token。
    blocks_json = Column(JSONB, nullable=True)
    # The editable working copy lives on BlogPost. Public readers use this
    # immutable revision instead, so editing a published post is private until
    # the next explicit publish.
    published_revision_id = Column(Integer, nullable=True)
    deleted_at = Column(DateTime, nullable=True)


class BlogPostRevision(Base):
    """Immutable, user-created (or restore-safety) blog post snapshot."""

    __tablename__ = "blog_post_revisions"
    __table_args__ = (
        UniqueConstraint("post_id", "revision_number", name="uq_blog_post_revisions_number"),
        Index("ix_blog_post_revisions_post_created", "post_id", "created_at"),
        Index("ix_blog_post_revisions_user_post", "user_id", "post_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    post_id = Column(Integer, ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    revision_number = Column(Integer, nullable=False)
    kind = Column(String(20), nullable=False)  # commit / publish (pre_restore may exist in legacy data)
    title = Column(String(300), nullable=False)
    slug = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)
    excerpt = Column(String(500), nullable=True)
    cover_image = Column(String(500), nullable=True)
    category_id = Column(Integer, ForeignKey("blog_categories.id"), nullable=True)
    tags = Column(String(500), nullable=True)
    author = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
