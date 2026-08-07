"""博客文章的 Pydantic 模型。"""

from datetime import datetime
from typing import Annotated, Literal, Optional

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
    excerpt: Optional[Excerpt] = None
    cover_image: Optional[CoverImage] = None
    status: Optional[BlogStatus] = "draft"
    tags: Optional[Tags] = None
    author: Optional[Author] = None


class BlogPostUpdate(BaseModel):
    title: Optional[Title] = None
    content: Optional[str] = None
    excerpt: Optional[Excerpt] = None
    cover_image: Optional[CoverImage] = None
    status: Optional[BlogStatus] = None
    tags: Optional[Tags] = None


class BlogPostResponse(BaseModel):
    id: int
    title: str
    slug: str
    content: str
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    status: str
    tags: Optional[str] = None
    author: Optional[str] = None
    view_count: int
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BlogPostListItem(BaseModel):
    """博客列表项（不含完整 content）。"""
    id: int
    title: str
    slug: str
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    status: str
    tags: Optional[str] = None
    author: Optional[str] = None
    view_count: int
    created_at: datetime
    published_at: Optional[datetime] = None

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
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    category_id: Optional[int] = None
    tags: Optional[str] = None
    author: Optional[str] = None


class BlogPostRevisionListResponse(BaseModel):
    revisions: list[BlogPostRevisionSummary]
