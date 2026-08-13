"""博客文章的 Pydantic 模型。"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

BlogStatus = Literal["draft", "published"]

# 长度上限与 database/models/blog.py 的列长对齐：超长在入口直接 422，
# 避免透传到 db.commit() 触发 StringDataRightTruncation → 500。
Title = Annotated[str, Field(max_length=300)]
Excerpt = Annotated[str, Field(max_length=500)]
CoverImage = Annotated[str, Field(max_length=500)]
Tags = Annotated[str, Field(max_length=500)]
Author = Annotated[str, Field(max_length=100)]


class BlogPostCreate(BaseModel):
    title: Title
    content: str
    excerpt: Excerpt | None = None
    cover_image: CoverImage | None = None
    status: BlogStatus | None = "draft"
    tags: Tags | None = None
    author: Author | None = None


class BlogPostUpdate(BaseModel):
    title: Title | None = None
    content: str | None = None
    excerpt: Excerpt | None = None
    cover_image: CoverImage | None = None
    status: BlogStatus | None = None
    tags: Tags | None = None


class BlogPostResponse(BaseModel):
    id: int
    title: str
    slug: str
    content: str
    excerpt: str | None = None
    cover_image: str | None = None
    status: str
    tags: str | None = None
    author: str | None = None
    view_count: int
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None

    model_config = {"from_attributes": True}


class BlogPostListItem(BaseModel):
    """博客列表项（不含完整 content）。"""

    id: int
    title: str
    slug: str
    excerpt: str | None = None
    cover_image: str | None = None
    status: str
    tags: str | None = None
    author: str | None = None
    view_count: int
    created_at: datetime
    published_at: datetime | None = None

    model_config = {"from_attributes": True}


class BlogPostListResponse(BaseModel):
    posts: list[BlogPostListItem]
    total: int
    page: int
    per_page: int


class BlogPublishRequest(BaseModel):
    publish: bool


class BlogPostRevisionSummary(BaseModel):
    id: int
    revision_number: int
    kind: str
    title: str
    created_at: datetime
    is_published: bool = False

    model_config = {"from_attributes": True}


class BlogPostRevisionResponse(BlogPostRevisionSummary):
    slug: str
    content: str
    excerpt: str | None = None
    cover_image: str | None = None
    category_id: int | None = None
    tags: str | None = None
    author: str | None = None


class BlogPostRevisionListResponse(BaseModel):
    revisions: list[BlogPostRevisionSummary]
