"""博客文章的 Pydantic 模型。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class BlogPostCreate(BaseModel):
    title: str
    content: str
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    status: Optional[str] = "draft"
    tags: Optional[str] = None
    author: Optional[str] = None


class BlogPostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[str] = None


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
