"""博客测试。"""
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost as BlogPostModel
from src.services.markdown_blog_service import read_post_by_slug
from src.tools.blog import blog_edit_post, blog_search_posts, current_user_id_cv

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
async def test_blog_edit_post_rejects_repeated_target_text(db_session: AsyncSession, monkeypatch):
    content = "第一处重复文本\n\n第二处重复文本"
    post = BlogPostModel(
        title="重复片段",
        slug="repeated-target",
        content=content,
        status="draft",
        user_id=TEST_USER_ID,
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result = await blog_edit_post.ainvoke({
            "post_id": post.id,
            "target_text": "重复文本",
            "replacement_text": "替换文本",
        })
    finally:
        current_user_id_cv.reset(token)

    assert "出现 2 次" in result
    assert "无法确定要修改哪一处" in result
    assert post.content == content


@pytest.mark.asyncio
async def test_blog_edit_post_replaces_within_section_only(db_session: AsyncSession, monkeypatch, tmp_path):
    """section_index 限定后，章节内重复片段可替换；其他章节的同名片段保持不变。"""
    from src.config import settings

    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))
    content = (
        "## 背景\n\n这是重复文本第一次出现。\n\n"
        "## 总结\n\n这是重复文本第二次出现。"
    )
    post = BlogPostModel(
        title="按章节限定",
        slug="section-scoped",
        content=content,
        status="draft",
        user_id=TEST_USER_ID,
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result = await blog_edit_post.ainvoke({
            "post_id": post.id,
            "target_text": "重复文本",
            "replacement_text": "唯一替换",
            "section_index": 2,
        })
        await db_session.refresh(post)
    finally:
        current_user_id_cv.reset(token)

    assert "已精准修改" in result
    assert "重复文本" in post.content  # 第 1 节保留
    assert "唯一替换" in post.content  # 第 2 节被替换


@pytest.mark.asyncio
async def test_blog_edit_post_section_index_target_not_in_section(db_session: AsyncSession, monkeypatch):
    """target_text 不在指定章节时给出明确错误。"""
    content = "## 背景\n\n本节有原始文字。\n\n## 总结\n\n这里是总结。"
    post = BlogPostModel(
        title="章节限定未命中",
        slug="section-miss",
        content=content,
        status="draft",
        user_id=TEST_USER_ID,
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result = await blog_edit_post.ainvoke({
            "post_id": post.id,
            "target_text": "总结",
            "replacement_text": "结论",
            "section_index": 1,
        })
    finally:
        current_user_id_cv.reset(token)

    assert "未找到目标文本" in result
    assert "第 1 节" in result
    assert post.content == content


@pytest.mark.asyncio
async def test_blog_search_posts_lists_posts_when_query_empty(db_session: AsyncSession, monkeypatch):
    post = BlogPostModel(
        title="全部文章测试",
        slug="list-all-test",
        content="正文内容",
        status="draft",
        user_id=TEST_USER_ID,
    )
    db_session.add(post)
    await db_session.commit()

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result = await blog_search_posts.ainvoke({})
    finally:
        current_user_id_cv.reset(token)

    assert "博客文章列表" in result
    assert "全部文章测试" in result


@pytest.mark.asyncio
async def test_blog_search_posts_finds_posts_by_title(db_session: AsyncSession, monkeypatch):
    post = BlogPostModel(
        title="AI 搜索测试",
        slug="ai-search-test",
        content="正文内容",
        status="draft",
        user_id=TEST_USER_ID,
    )
    db_session.add(post)
    await db_session.commit()

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result = await blog_search_posts.ainvoke({"query": "AI 搜索"})
    finally:
        current_user_id_cv.reset(token)

    assert "博客搜索结果" in result
    assert "AI 搜索测试" in result


@pytest.mark.asyncio
async def test_blog_search_posts_finds_text_inside_post(db_session: AsyncSession, monkeypatch):
    content = "## 背景\n\n这里有目标词。\n\n## 总结\n\n这里也有目标词。"
    post = BlogPostModel(
        title="正文搜索测试",
        slug="content-search-test",
        content=content,
        status="draft",
        user_id=TEST_USER_ID,
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result = await blog_search_posts.ainvoke({"query": "目标词", "post_id": post.id})
    finally:
        current_user_id_cv.reset(token)

    assert "找到 2 处" in result
    assert "第 1 节 ## 背景" in result
    assert "第 2 节 ## 总结" in result
    assert "上下文" in result


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
