"""博客测试。"""

from pathlib import Path

import pytest
import yaml
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogCategory as BlogCategoryModel
from src.database.models import BlogPost as BlogPostModel
from src.services.markdown_blog_service import read_post_by_slug, sync_db_posts_to_files


@pytest.fixture(autouse=True)
def isolated_blog_content(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


def _content_dir() -> Path:
    return Path(settings.blog_content_dir)


def _post_file(slug: str) -> Path:
    return _content_dir() / f"{slug}.md"


def _read_markdown(slug: str) -> tuple[dict, str]:
    data = read_post_by_slug(slug)
    assert data is not None
    return data["meta"], data["body"]


# ---- Blog Categories ----

@pytest.mark.asyncio
async def test_create_blog_category(client: AsyncClient):
    resp = await client.post("/api/blog/categories", json={
        "name": "技术",
        "description": "技术文章",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "技术"
    assert "id" in data
    assert "slug" in data


@pytest.mark.asyncio
async def test_list_blog_categories(client: AsyncClient):
    await client.post("/api/blog/categories", json={"name": "分类1"})
    await client.post("/api/blog/categories", json={"name": "分类2"})

    resp = await client.get("/api/blog/categories")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2


@pytest.mark.asyncio
async def test_update_blog_category(client: AsyncClient):
    create_resp = await client.post("/api/blog/categories", json={"name": "原名"})
    cat_id = create_resp.json()["id"]

    resp = await client.put(f"/api/blog/categories/{cat_id}", json={
        "name": "新名",
        "description": "新描述",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名"


@pytest.mark.asyncio
async def test_delete_blog_category(client: AsyncClient):
    create_resp = await client.post("/api/blog/categories", json={"name": "待删除"})
    cat_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/blog/categories/{cat_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


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
    assert _post_file(data["slug"]).exists()
    meta, body = _read_markdown(data["slug"])
    assert meta["title"] == "测试文章"
    assert meta["slug"] == data["slug"]
    assert meta["status"] == "draft"
    assert body == "这是测试内容。"


@pytest.mark.asyncio
async def test_create_blog_post_writes_category_name_to_markdown(client: AsyncClient, db_session: AsyncSession):
    cat_resp = await client.post("/api/blog/categories", json={"name": "技术"})
    category_id = cat_resp.json()["id"]

    resp = await client.post("/api/blog/posts", json={
        "title": "分类文章",
        "content": "分类内容。",
        "category_id": category_id,
        "tags": "ai,blog",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["category_id"] == category_id

    post = await db_session.get(BlogPostModel, data["id"])
    assert post is not None
    assert post.category_id == category_id
    meta, _body = _read_markdown(data["slug"])
    assert meta["category"] == "技术"
    assert meta["tags"] == "ai,blog"


@pytest.mark.asyncio
async def test_create_blog_post_rejects_invalid_category(client: AsyncClient):
    resp = await client.post("/api/blog/posts", json={
        "title": "无效分类",
        "content": "内容",
        "category_id": 99999,
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_blog_posts(client: AsyncClient):
    await client.post("/api/blog/posts", json={
        "title": "文章1",
        "content": "内容1",
    })

    resp = await client.get("/api/blog/posts")
    assert resp.status_code == 200
    data = resp.json()
    assert "posts" in data
    assert "total" in data
    assert "page" in data
    assert "per_page" in data


@pytest.mark.asyncio
async def test_get_blog_post(client: AsyncClient):
    create_resp = await client.post("/api/blog/posts", json={
        "title": "详情文章",
        "content": "详情内容。",
    })
    post_id = create_resp.json()["id"]

    resp = await client.get(f"/api/blog/posts/{post_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "详情文章"


@pytest.mark.asyncio
async def test_get_nonexistent_blog_post(client: AsyncClient):
    resp = await client.get("/api/blog/posts/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_blog_post(client: AsyncClient, db_session: AsyncSession):
    cat_resp = await client.post("/api/blog/categories", json={"name": "新分类"})
    category_id = cat_resp.json()["id"]
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
        "category_id": category_id,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == post_id
    assert data["title"] == "已更新"
    assert data["content"] == "新内容"
    assert data["category_id"] == category_id
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
    assert meta["category"] == "新分类"
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

    resp = await client.get("/api/blog/posts", params={"status": "draft"})
    assert resp.status_code == 200
    posts = resp.json()["posts"]
    assert all(p["status"] == "draft" for p in posts)


@pytest.mark.asyncio
async def test_sync_db_posts_to_files_migrates_existing_db_only_posts(db_session: AsyncSession):
    category = BlogCategoryModel(name="历史分类", slug="history")
    db_session.add(category)
    await db_session.flush()
    post = BlogPostModel(
        title="历史文章",
        slug="history-post",
        content="历史内容",
        status="published",
        category_id=category.id,
        tags="legacy",
        author="tester",
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    migrated = await sync_db_posts_to_files(db_session)
    assert migrated == 1
    await db_session.refresh(post)
    assert post.file_path
    assert _post_file("history-post").exists()
    meta, body = _read_markdown("history-post")
    assert meta["title"] == "历史文章"
    assert meta["slug"] == "history-post"
    assert meta["category"] == "历史分类"
    assert meta["tags"] == "legacy"
    assert body == "历史内容"

    migrated_again = await sync_db_posts_to_files(db_session)
    assert migrated_again == 0
    result = await db_session.execute(select(BlogPostModel))
    posts = result.scalars().all()
    assert len(posts) == 1
    assert posts[0].id == post.id
