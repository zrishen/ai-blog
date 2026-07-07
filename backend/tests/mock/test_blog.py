"""博客测试。"""
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost as BlogPostModel
from src.services.markdown_blog_service import read_post_by_slug

TEST_USER_ID = 1


@pytest.fixture(autouse=True)
def isolated_blog_content(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


def _content_dir() -> Path:
    return Path(settings.blog_content_dir)


def _post_file(slug: str, user_id: int = TEST_USER_ID) -> Path:
    return _content_dir() / str(user_id) / f"{slug}.md"


def _read_markdown(slug: str, user_id: int = TEST_USER_ID) -> tuple[dict, str]:
    data = read_post_by_slug(slug, user_id)
    assert data is not None
    return data["meta"], data["body"]


# ---- Blog Posts ----

@pytest.mark.asyncio
async def test_create_blog_post(client: AsyncClient, db_session: AsyncSession):
    resp = await client.post("/api/blog/posts", json={
        "title": "测试文章",
        "content": "这是测试内容。",
        "status": "draft",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "测试文章"
    assert data["status"] == "draft"
    assert "id" in data
    assert "slug" in data

    post = await db_session.get(BlogPostModel, data["id"])
    assert post is not None
    assert post.file_path
    assert post.user_id == TEST_USER_ID
    assert _post_file(data["slug"]).exists()
    meta, body = _read_markdown(data["slug"])
    assert meta["title"] == "测试文章"
    assert meta["slug"] == data["slug"]
    assert meta["status"] == "draft"
    assert body == "这是测试内容。"


@pytest.mark.asyncio
async def test_list_blog_posts(client: AsyncClient):
    await client.post("/api/blog/posts", json={
        "title": "文章1",
        "content": "内容1",
        "status": "published",
    })

    resp = await client.get("/api/blog/posts")
    assert resp.status_code == 200
    data = resp.json()
    assert "posts" in data
    assert "total" in data
    assert "page" in data
    assert "per_page" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_get_blog_post(client: AsyncClient):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "详情文章",
        "content": "详情内容。",
        "status": "published",
    })
    post_id = create_resp.json()["id"]

    resp = await client.get(f"/api/blog/posts/{post_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "详情文章"


@pytest.mark.asyncio
async def test_get_draft_blog_post_is_hidden_from_anonymous_viewer(client: AsyncClient):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "草稿详情",
        "content": "草稿内容。",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]

    resp = await client.get(f"/api/blog/posts/{post_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_nonexistent_blog_post(client: AsyncClient):
    resp = await client.get("/api/blog/posts/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_blog_post(client: AsyncClient, db_session: AsyncSession):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "待更新",
        "content": "原内容",
    })
    post_id = create_resp.json()["id"]
    old_slug = create_resp.json()["slug"]

    resp = await client.put(f"/api/blog/posts/{post_id}", json={
        "title": "已更新",
        "content": "新内容",
        "tags": "updated",
        "status": "published",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == post_id
    assert data["title"] == "已更新"
    assert data["content"] == "新内容"
    assert data["status"] == "published"
    assert data["published_at"] is not None
    assert data["slug"] != old_slug

    result = await db_session.execute(select(BlogPostModel))
    posts = result.scalars().all()
    assert len(posts) == 1
    assert posts[0].id == post_id
    assert posts[0].file_path
    assert not _post_file(old_slug).exists()
    assert _post_file(data["slug"]).exists()
    meta, body = _read_markdown(data["slug"])
    assert meta["title"] == "已更新"
    assert meta["status"] == "published"
    assert meta["tags"] == "updated"
    assert body == "新内容"


@pytest.mark.asyncio
async def test_delete_blog_post(client: AsyncClient, db_session: AsyncSession):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "待删除",
        "content": "内容",
    })
    post_id = create_resp.json()["id"]
    slug = create_resp.json()["slug"]
    assert _post_file(slug).exists()

    resp = await client.delete(f"/api/blog/posts/{post_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert not _post_file(slug).exists()
    assert await db_session.get(BlogPostModel, post_id) is None


@pytest.mark.asyncio
async def test_publish_blog_post(client: AsyncClient):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "待发布",
        "content": "内容",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]
    slug = create_resp.json()["slug"]

    resp = await client.put(f"/api/blog/posts/{post_id}/publish", json={
        "publish": True,
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "published"
    assert resp.json()["published_at"] is not None
    meta, _body = _read_markdown(slug)
    assert meta["status"] == "published"
    assert meta["published_at"] is not None

    unpublish_resp = await client.put(f"/api/blog/posts/{post_id}/publish", json={"publish": False})
    assert unpublish_resp.status_code == 200
    assert unpublish_resp.json()["status"] == "draft"
    assert unpublish_resp.json()["published_at"] is None
    meta, _body = _read_markdown(slug)
    assert meta["status"] == "draft"
    assert meta["published_at"] is None


@pytest.mark.asyncio
async def test_list_blog_posts_with_filter(client: AsyncClient):
    await client.post("/api/blog/posts", json={
        "title": "草稿",
        "content": "内容",
        "status": "draft",
    })
    await client.post("/api/blog/posts", json={
        "title": "已发布",
        "content": "内容",
        "status": "published",
    })

    resp = await client.get("/api/blog/posts", params={"status": "published"})
    assert resp.status_code == 200
    posts = resp.json()["posts"]
    assert posts
    assert all(p["status"] == "published" for p in posts)
