"""博客测试。"""
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost as BlogPostModel, User as UserModel
from src.services.blog.markdown_blog_service import read_post_by_slug
from src.tools.blog import (
    blog_create_post,
    blog_delete_post,
    blog_edit_post,
    blog_read_post,
    blog_search_posts,
    blog_write_post,
    current_user_id_cv,
)

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
    resp = await client.post("/api/v1/blog/posts", json={
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
async def test_ai_create_post_creates_empty_draft_then_write_fills_same_post(
    db_session: AsyncSession,
    monkeypatch,
):
    """AI 新建文章必须先创建有 ID 的空草稿，再由 write 工具写入正文。"""
    db_session.add(UserModel(id=TEST_USER_ID, username="testuser", password_hash="mock"))
    await db_session.commit()

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())

    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        created_result = await blog_create_post.ainvoke({
            "title": "AI 两阶段文章",
            "tags": "ai, streaming",
            "excerpt": "先建草稿再写正文",
        })
        result = await db_session.execute(
            select(BlogPostModel).where(BlogPostModel.title == "AI 两阶段文章")
        )
        post = result.scalar_one()

        assert f"id={post.id}" in created_result
        assert post.status == "draft"
        assert post.content == ""
        meta, body = _read_markdown(post.slug)
        assert meta["status"] == "draft"
        assert body == ""

        write_result = await blog_write_post.ainvoke({
            "post_id": post.id,
            "content": "## 正文\n\n这是后续写入的正文。",
        })
        await db_session.refresh(post)
    finally:
        current_user_id_cv.reset(token)

    assert f"id={post.id}" in write_result
    assert post.content == "## 正文\n\n这是后续写入的正文。"
    assert _read_markdown(post.slug)[1] == post.content
    assert "content" not in blog_create_post.args
    assert "status" not in blog_create_post.args


@pytest.mark.asyncio
async def test_list_blog_posts(client: AsyncClient):
    await client.post("/api/v1/blog/posts", json={
        "title": "文章1",
        "content": "内容1",
        "status": "published",
    })

    resp = await client.get("/api/v1/blog/posts")
    assert resp.status_code == 200
    data = resp.json()
    assert "posts" in data
    assert "total" in data
    assert "page" in data
    assert "per_page" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_get_blog_post(client: AsyncClient):
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "详情文章",
        "content": "详情内容。",
        "status": "published",
    })
    post_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/blog/posts/{post_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "详情文章"


@pytest.mark.asyncio
async def test_get_draft_blog_post_is_hidden_from_anonymous_viewer(client: AsyncClient):
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "草稿详情",
        "content": "草稿内容。",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/blog/posts/{post_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_nonexistent_blog_post(client: AsyncClient):
    resp = await client.get("/api/v1/blog/posts/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_blog_post(client: AsyncClient, db_session: AsyncSession):
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "待更新",
        "content": "原内容",
    })
    post_id = create_resp.json()["id"]
    old_slug = create_resp.json()["slug"]

    resp = await client.put(f"/api/v1/blog/posts/{post_id}", json={
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

    expected = (
        "## 背景\n\n这是重复文本第一次出现。\n\n"
        "## 总结\n\n这是唯一替换第二次出现。"
    )
    assert "已精准修改" in result
    assert "section=2" in result
    assert post.content == expected
    _meta, body = _read_markdown(post.slug)
    assert body == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(("content", "target_text", "replacement_text", "expected"), [
    ("目标文本在开头，后面保持不变。", "目标文本", "新文本", "新文本在开头，后面保持不变。"),
    ("前面的内容保持不变，末尾目标文本", "目标文本", "新文本", "前面的内容保持不变，末尾新文本"),
    ("## 标题\n\n**多行**\n原始片段\n\n结尾", "**多行**\n原始片段", "替换片段", "## 标题\n\n替换片段\n\n结尾"),
    ("删除前缀目标文本删除后缀", "目标文本", "", "删除前缀删除后缀"),
])
async def test_blog_edit_post_preserves_non_target_content(
    db_session: AsyncSession,
    monkeypatch,
    content: str,
    target_text: str,
    replacement_text: str,
    expected: str,
):
    post = BlogPostModel(
        title="精准替换边界",
        slug="precise-edit-boundary",
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
            "target_text": target_text,
            "replacement_text": replacement_text,
        })
        await db_session.refresh(post)
    finally:
        current_user_id_cv.reset(token)

    assert "已精准修改" in result
    assert post.content == expected
    _meta, body = _read_markdown(post.slug)
    assert body == expected


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
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "待删除",
        "content": "内容",
    })
    post_id = create_resp.json()["id"]
    slug = create_resp.json()["slug"]
    assert _post_file(slug).exists()

    resp = await client.delete(f"/api/v1/blog/posts/{post_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    # 软删除：md 文件保留以便恢复；DB 行保留但 deleted_at 已置位
    assert _post_file(slug).exists()
    row = await db_session.get(BlogPostModel, post_id)
    assert row is not None
    assert row.deleted_at is not None
    # 不再出现在文章列表中
    listing = await client.get("/api/v1/blog/posts")
    assert all(p["id"] != post_id for p in listing.json()["posts"])


@pytest.mark.asyncio
async def test_deleted_blog_post_is_rejected_by_all_api_boundaries(client: AsyncClient):
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "软删除边界",
        "content": "不可见内容",
        "status": "published",
    })
    post_id = create_resp.json()["id"]
    slug = create_resp.json()["slug"]

    assert (await client.delete(f"/api/v1/blog/posts/{post_id}")).status_code == 200

    responses = [
        await client.get(f"/api/v1/blog/posts/{post_id}"),
        await client.put(f"/api/v1/blog/posts/{post_id}", json={"title": "不应更新"}),
        await client.put(f"/api/v1/blog/posts/{post_id}/publish", json={"publish": True}),
        await client.delete(f"/api/v1/blog/posts/{post_id}"),
        await client.post(f"/api/v1/blog/posts/{post_id}/generate-cover"),
        await client.post(f"/api/v1/blog/posts/{post_id}/suggest-tags"),
        await client.get(f"/api/v1/public/users/testuser/posts/{slug}"),
    ]

    assert all(resp.status_code == 404 for resp in responses)
    owner_listing = await client.get("/api/v1/blog/posts")
    public_listing = await client.get("/api/v1/public/users/testuser/posts")
    assert all(post["id"] != post_id for post in owner_listing.json()["posts"])
    assert all(post["id"] != post_id for post in public_listing.json()["posts"])


@pytest.mark.asyncio
async def test_deleted_blog_post_is_rejected_by_ai_tools(db_session: AsyncSession, monkeypatch):
    post = BlogPostModel(
        title="AI 软删除边界",
        slug="ai-deleted-boundary",
        content="不可读取内容",
        status="published",
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
        deleted = await blog_delete_post.ainvoke({"post_id": post.id})
        write_result = await blog_write_post.ainvoke({"post_id": post.id, "title": "不应更新"})
        edit_result = await blog_edit_post.ainvoke({
            "post_id": post.id,
            "target_text": "不可读取",
            "replacement_text": "不应替换",
        })
        search_result = await blog_search_posts.ainvoke({"query": "不可读取", "post_id": post.id})
        read_result = await blog_read_post.ainvoke({"post_id": post.id})
        delete_again = await blog_delete_post.ainvoke({"post_id": post.id})
        listing = await blog_search_posts.ainvoke({})
    finally:
        current_user_id_cv.reset(token)

    assert "已移入回收站" in deleted
    assert all("文章不存在" in result for result in (
        write_result,
        edit_result,
        search_result,
        read_result,
        delete_again,
    ))
    assert "AI 软删除边界" not in listing


@pytest.mark.asyncio
async def test_publish_blog_post(client: AsyncClient):
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "待发布",
        "content": "内容",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]
    slug = create_resp.json()["slug"]

    resp = await client.put(f"/api/v1/blog/posts/{post_id}/publish", json={
        "publish": True,
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "published"
    assert resp.json()["published_at"] is not None
    meta, _body = _read_markdown(slug)
    assert meta["status"] == "published"
    assert meta["published_at"] is not None

    unpublish_resp = await client.put(f"/api/v1/blog/posts/{post_id}/publish", json={"publish": False})
    assert unpublish_resp.status_code == 200
    assert unpublish_resp.json()["status"] == "draft"
    assert unpublish_resp.json()["published_at"] is None
    meta, _body = _read_markdown(slug)
    assert meta["status"] == "draft"
    assert meta["published_at"] is None


@pytest.mark.asyncio
async def test_list_blog_posts_with_filter(client: AsyncClient):
    await client.post("/api/v1/blog/posts", json={
        "title": "草稿",
        "content": "内容",
        "status": "draft",
    })
    await client.post("/api/v1/blog/posts", json={
        "title": "已发布",
        "content": "内容",
        "status": "published",
    })

    resp = await client.get("/api/v1/blog/posts", params={"status": "published"})
    assert resp.status_code == 200
    posts = resp.json()["posts"]
    assert posts
    assert all(p["status"] == "published" for p in posts)


@pytest.mark.asyncio
async def test_recreate_after_soft_delete_keeps_trash_and_derivates_slug(client: AsyncClient):
    """软删后用同标题重建：保留回收站原记录，新文章派生 -1 后缀，不撞 uq_blog_posts_user_slug。"""
    create_resp = await client.post("/api/v1/blog/posts", json={
        "title": "同标题文章",
        "content": "原文",
        "status": "draft",
    })
    assert create_resp.status_code in (200, 201)
    original = create_resp.json()
    original_id = original["id"]
    slug = original["slug"]

    # 软删
    del_resp = await client.delete(f"/api/v1/blog/posts/{original_id}")
    assert del_resp.status_code == 200
    trash_after_delete = await client.get("/api/v1/trash")
    assert any(
        i["type"] == "blog_post" and i["id"] == original_id
        for i in trash_after_delete.json()["items"]
    )

    # 同标题重建 —— slug 被回收站记录占用，派生 -1 后缀
    recreate_resp = await client.post("/api/v1/blog/posts", json={
        "title": "同标题文章",
        "content": "新文",
        "status": "published",
    })
    assert recreate_resp.status_code in (200, 201)
    recreated = recreate_resp.json()
    assert recreated["slug"] == f"{slug}-1"
    assert recreated["id"] != original_id

    # 回收站里旧软删记录仍保留（未被物理清除、未被复活）
    trash_final = await client.get("/api/v1/trash")
    assert any(
        i["type"] == "blog_post" and i["id"] == original_id
        for i in trash_final.json()["items"]
    ), "回收站原记录应保留"

    # active 列表只看到新行
    listing = await client.get("/api/v1/blog/posts")
    assert all(p["id"] != original_id for p in listing.json()["posts"])
    detail = await client.get(f"/api/v1/blog/posts/{recreated['id']}")
    assert detail.status_code == 200
    assert detail.json()["content"] == "新文"


@pytest.mark.asyncio
async def test_ensure_intro_post_does_not_revive_or_collide_when_soft_deleted(
    client: AsyncClient, db_session: AsyncSession
):
    """用户软删 ai-blog-intro 后，ensure_intro_post 不复活、不创建、不抛唯一键错误。"""
    from src.services.blog.blog_service import delete_post, ensure_intro_post

    intro_data = {
        "title": "官方介绍",
        "slug": "ai-blog-intro",
        "tags": "intro",
        "excerpt": "摘要",
        "content": "内容",
        "status": "published",
    }
    first = await ensure_intro_post(db_session, intro_data, TEST_USER_ID)
    assert first is not None
    assert first.slug == "ai-blog-intro"
    first_id = first.id

    await delete_post(db_session, first_id, TEST_USER_ID)

    second = await ensure_intro_post(db_session, intro_data, TEST_USER_ID)
    assert second is not None
    assert second.id == first_id
    assert second.deleted_at is not None  # 仍在回收站，未被复活

    # 回收站可见，active 列表不可见
    trash = await client.get("/api/v1/trash")
    assert any(i["type"] == "blog_post" and i["id"] == first_id for i in trash.json()["items"])
    listing = await client.get("/api/v1/blog/posts")
    assert all(p["id"] != first_id for p in listing.json()["posts"])
