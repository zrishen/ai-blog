"""跨用户隔离测试：确保一个用户的数据/文件不会被另一用户读写。"""

import io

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.config import settings
from src.database.models import BlogPost as BlogPostModel
from src.main import app
from src.services.workspace.file import file_service
from src.services.workspace.file.file_service import get_user_upload_dir
from src.utils.auth import get_current_user, get_optional_user


@pytest.fixture(autouse=True)
def real_auth():
    """conftest 把 get_current_user 永远替换成同一个 testuser，无法测多用户场景。

    这里临时还原为基于 token 的真实认证依赖。
    """
    saved_current = app.dependency_overrides.get(get_current_user)
    saved_optional = app.dependency_overrides.get(get_optional_user)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_optional_user, None)
    yield
    if saved_current is not None:
        app.dependency_overrides[get_current_user] = saved_current
    if saved_optional is not None:
        app.dependency_overrides[get_optional_user] = saved_optional


@pytest.fixture(autouse=True)
def isolated_dirs(tmp_path, monkeypatch):
    upload_path = tmp_path / "uploads"
    upload_path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))
    monkeypatch.setattr(settings, "upload_dir", str(upload_path))
    monkeypatch.setattr(file_service, "UPLOAD_DIR", upload_path)


async def _register(client: AsyncClient, username: str) -> tuple[str, int]:
    resp = await client.post("/api/v1/auth/register", json={
        "username": username,
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return data["access_token"], data["user"]["id"]


async def _login(client: AsyncClient, username: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={
        "username": username,
        "password": "test1234",
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


# ---- Blog: 草稿不泄漏给匿名/他人 ----

@pytest.mark.asyncio
async def test_draft_post_is_hidden_from_other_user(client: AsyncClient):
    owner_token, owner_id = await _register(client, "owner_user")
    headers = {"Authorization": f"Bearer {owner_token}"}

    create_resp = await client.post("/api/v1/blog/posts", headers=headers, json={
        "title": "私有草稿",
        "content": "不可见",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]

    # 他人注册并登录
    other_token, _ = await _register(client, "other_user")
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.get(f"/api/v1/blog/posts/{post_id}", headers=other_headers)
    assert resp.status_code == 404

    # 匿名访问同样不可见
    anon_resp = await client.get(f"/api/v1/blog/posts/{post_id}")
    assert anon_resp.status_code == 404


@pytest.mark.asyncio
async def test_other_user_cannot_update_or_delete_post(client: AsyncClient, db_session):
    owner_token, _ = await _register(client, "owner_user2")
    headers = {"Authorization": f"Bearer {owner_token}"}

    create_resp = await client.post("/api/v1/blog/posts", headers=headers, json={
        "title": "原标题",
        "content": "原内容",
    })
    post_id = create_resp.json()["id"]

    other_token, _ = await _register(client, "attacker_user")
    other_headers = {"Authorization": f"Bearer {other_token}"}

    # 尝试更新他人文章
    update_resp = await client.put(f"/api/v1/blog/posts/{post_id}", headers=other_headers, json={
        "title": "篡改标题",
    })
    assert update_resp.status_code == 404

    # 尝试删除他人文章
    delete_resp = await client.delete(f"/api/v1/blog/posts/{post_id}", headers=other_headers)
    assert delete_resp.status_code == 404

    # 数据未受影响
    post = await db_session.get(BlogPostModel, post_id)
    assert post is not None
    assert post.title == "原标题"


@pytest.mark.asyncio
async def test_other_user_cannot_publish_or_unpublish_post(client: AsyncClient):
    owner_token, _ = await _register(client, "owner_pub")
    headers = {"Authorization": f"Bearer {owner_token}"}

    create_resp = await client.post("/api/v1/blog/posts", headers=headers, json={
        "title": "待发布",
        "content": "内容",
        "status": "draft",
    })
    post_id = create_resp.json()["id"]

    other_token, _ = await _register(client, "other_pub")
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.put(
        f"/api/v1/blog/posts/{post_id}/publish",
        headers=other_headers,
        json={"publish": True},
    )
    assert resp.status_code == 404


# ---- Blog: 同名 slug 在不同用户间允许共存 ----

@pytest.mark.asyncio
async def test_same_slug_can_coexist_across_users(client: AsyncClient, db_session):
    token_a, user_id_a = await _register(client, "slug_owner_a")
    token_b, user_id_b = await _register(client, "slug_owner_b")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 两用户分别创建相同标题，slug 应一致
    resp_a = await client.post("/api/v1/blog/posts", headers=headers_a, json={
        "title": "重复标题",
        "content": "a",
    })
    resp_b = await client.post("/api/v1/blog/posts", headers=headers_b, json={
        "title": "重复标题",
        "content": "b",
    })
    assert resp_a.status_code == 201
    assert resp_b.status_code == 201
    assert resp_a.json()["slug"] == resp_b.json()["slug"]

    # DB 中应存在两条不同 user_id 的记录
    result = await db_session.execute(
        select(BlogPostModel).where(BlogPostModel.slug == resp_a.json()["slug"])
    )
    posts = result.scalars().all()
    user_ids = {p.user_id for p in posts}
    assert user_id_a in user_ids
    assert user_id_b in user_ids


# ---- Files: 上传文件按 user_id 隔离 ----

@pytest.mark.asyncio
async def test_uploaded_files_are_isolated_per_user(client: AsyncClient):
    token_a, user_id_a = await _register(client, "uploader_a")
    token_b, user_id_b = await _register(client, "uploader_b")

    files_a = {"file": ("a.pdf", io.BytesIO(b"%PDF-1.4 a"), "application/pdf")}
    resp_a = await client.post(
        "/api/v1/upload",
        headers={"Authorization": f"Bearer {token_a}"},
        files=files_a,
    )
    assert resp_a.status_code == 200
    stored_a = resp_a.json()["stored_name"]

    files_b = {"file": ("b.pdf", io.BytesIO(b"%PDF-1.4 b"), "application/pdf")}
    resp_b = await client.post(
        "/api/v1/upload",
        headers={"Authorization": f"Bearer {token_b}"},
        files=files_b,
    )
    stored_b = resp_b.json()["stored_name"]

    # 文件分别位于各自 user_id 目录
    dir_a = get_user_upload_dir(user_id_a)
    dir_b = get_user_upload_dir(user_id_b)
    assert (dir_a / stored_a).exists()
    assert (dir_b / stored_b).exists()
    assert not (dir_a / stored_b).exists()
    assert not (dir_b / stored_a).exists()

    # B 用户无法通过 /api/uploads/{filename} 访问 A 的文件
    leak_resp = await client.get(
        f"/api/v1/uploads/{stored_a}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert leak_resp.status_code == 404
