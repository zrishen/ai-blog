from src.api import files as files_api
from src.database.models import BlogPost, User


async def test_blog_cover_can_be_loaded_from_its_public_url(client, db_session, tmp_path, monkeypatch):
    user = User(id=8, username="cover-owner", password_hash="hash")
    db_session.add(user)
    db_session.add(
        BlogPost(
            title="Cover post",
            slug="cover-post",
            content="Content",
            user_id=user.id,
            cover_image="/api/v1/blog/cover/generated-cover.webp",
        )
    )
    await db_session.commit()
    (tmp_path / "generated-cover.webp").write_bytes(b"cover-image")
    monkeypatch.setattr(files_api, "get_user_upload_dir", lambda _user_id: tmp_path)

    response = await client.get("/api/v1/blog/cover/generated-cover.webp")

    assert response.status_code == 200
    assert response.content == b"cover-image"
    assert response.headers["content-type"] == "image/webp"


async def test_blog_cover_requires_a_post_reference(client, tmp_path, monkeypatch):
    (tmp_path / "orphan-cover.webp").write_bytes(b"cover-image")
    monkeypatch.setattr(files_api, "get_user_upload_dir", lambda _user_id: tmp_path)

    response = await client.get("/api/v1/blog/cover/orphan-cover.webp")

    assert response.status_code == 404
