from datetime import datetime, timezone

from src.api import files as files_api
from src.database.models import BlogPost, BlogPostRevision, User


async def test_blog_cover_can_be_loaded_from_its_public_url(client, db_session, tmp_path, monkeypatch):
    user = User(id=8, username="cover-owner", password_hash="hash")
    db_session.add(user)
    # 已发布文章：封面引用挂在 published revision 上，外部可从公开 URL 加载
    post = BlogPost(
        title="Cover post",
        slug="cover-post",
        content="Content",
        user_id=user.id,
        cover_image="/api/v1/blog/cover/generated-cover.webp",
        status="published",
        published_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(post)
    await db_session.flush()
    rev = BlogPostRevision(
        post_id=post.id,
        user_id=user.id,
        revision_number=1,
        kind="publish",
        title="Cover post",
        slug="cover-post",
        content="Content",
        cover_image="/api/v1/blog/cover/generated-cover.webp",
    )
    db_session.add(rev)
    await db_session.flush()
    post.published_revision_id = rev.id
    await db_session.commit()
    (tmp_path / "generated-cover.webp").write_bytes(b"cover-image")
    # 1.1 起 get_blog_cover 用 ensure_within 解析路径（不再 get_user_upload_dir）；patch 使其落到 tmp_path
    monkeypatch.setattr(files_api, "ensure_within", lambda _uid, fn, **_kw: tmp_path / fn)

    response = await client.get("/api/v1/blog/cover/generated-cover.webp")

    assert response.status_code == 200
    assert response.content == b"cover-image"
    assert response.headers["content-type"] == "image/webp"


async def test_blog_cover_requires_a_post_reference(client, tmp_path, monkeypatch):
    (tmp_path / "orphan-cover.webp").write_bytes(b"cover-image")
    # 1.1 起 get_blog_cover 用 ensure_within 解析路径（不再 get_user_upload_dir）；patch 使其落到 tmp_path
    monkeypatch.setattr(files_api, "ensure_within", lambda _uid, fn, **_kw: tmp_path / fn)

    response = await client.get("/api/v1/blog/cover/orphan-cover.webp")

    assert response.status_code == 404
