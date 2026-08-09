"""文件预览路由测试。"""

import io
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from src.database.models import BlogPost, BlogPostRevision, Conversation, FileDocument, Message

from src.config import settings
from src.main import app
from src.services.workspace.file import file_service
from src.utils.auth import get_current_user, get_optional_user


@pytest.fixture(autouse=True)
def real_auth():
    """还原真实 token-based 认证依赖，避免 conftest 把所有请求都识别为 testuser。"""
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
    monkeypatch.setattr(file_service, "UPLOAD_DIR", upload_path)
    monkeypatch.setattr(settings, "upload_dir", str(upload_path))
    # 注册用户会触发 _seed_intro_article 写盘，必须隔离 blog_content_dir，否则污染真实数据。
    monkeypatch.setattr(settings, "blog_content_dir", str(tmp_path / "blog"))


async def _register_and_upload(client: AsyncClient, filename: str, content: bytes, content_type: str):
    reg = await client.post("/api/v1/auth/register", json={
        "username": "preview_user",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    token = reg.json()["access_token"]
    user_id = reg.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    files = {"file": (filename, io.BytesIO(content), content_type)}
    resp = await client.post("/api/v1/upload", headers=headers, files=files)
    assert resp.status_code == 200, resp.text
    return token, user_id, resp.json()["stored_name"]


@pytest.mark.asyncio
async def test_preview_requires_authentication(client: AsyncClient):
    resp = await client.get("/api/v1/preview/whatever.pdf")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_rejects_invalid_token(client: AsyncClient):
    resp = await client.get(
        "/api/v1/preview/file.pdf",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_pdf_returns_inline_file(client: AsyncClient):
    token, _user_id, stored = await _register_and_upload(
        client, "doc.pdf", b"%PDF-1.4 fake content", "application/pdf"
    )

    resp = await client.get(
        f"/api/v1/preview/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "inline" in resp.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_preview_rejects_soft_deleted_file_library_document(client: AsyncClient, db_session):
    token, user_id, stored = await _register_and_upload(
        client, "deleted.pdf", b"%PDF-1.4 deleted", "application/pdf"
    )
    db_session.add(FileDocument(
        collection_name=f"user_{user_id}_file",
        user_id=str(user_id),
        original_name="deleted.pdf",
        file_path=stored,
        chunk_content="1 chunks",
        deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    await db_session.commit()

    resp = await client.get(
        f"/api/v1/preview/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_preview_keeps_shared_chat_attachment_visible(client: AsyncClient, db_session):
    token, user_id, stored = await _register_and_upload(
        client, "shared.pdf", b"%PDF-1.4 shared", "application/pdf"
    )
    conversation = Conversation(title="共享附件", user_id=user_id)
    db_session.add(conversation)
    await db_session.flush()
    db_session.add_all([
        FileDocument(
            collection_name=f"user_{user_id}_file",
            user_id=str(user_id),
            original_name="shared.pdf",
            file_path=stored,
            chunk_content="1 chunks",
            deleted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
        Message(
            conversation_id=conversation.id,
            role="user",
            content="附件",
            file_url=f"/api/v1/uploads/{stored}",
            token_count=1,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
    ])
    await db_session.commit()

    resp = await client.get(
        f"/api/v1/preview/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_preview_token_via_query_param_works(client: AsyncClient):
    token, _user_id, stored = await _register_and_upload(
        client, "doc.pdf", b"%PDF-1.4 fake", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}

    # 前端先换一把 scoped 预览令牌，再以 ?token= 打开（PDF iframe 场景）
    issue = await client.get(
        "/api/v1/preview/token",
        headers=headers,
        params={"filename": stored},
    )
    assert issue.status_code == 200, issue.text
    assert issue.json()["expires_in"] > 0
    preview_token = issue.json()["token"]

    resp = await client.get(f"/api/v1/preview/{stored}?token={preview_token}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_preview_token_endpoint_requires_auth(client: AsyncClient):
    """签发端点本身需 access 认证。"""
    resp = await client.get("/api/v1/preview/token", params={"filename": "x.pdf"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_query_rejects_access_token(client: AsyncClient):
    """全局 access JWT 不再被 URL query 接受（仅 scoped preview token 可）。"""
    token, _user_id, stored = await _register_and_upload(
        client, "doc.pdf", b"%PDF-1.4 fake", "application/pdf"
    )
    resp = await client.get(f"/api/v1/preview/{stored}?token={token}")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_token_filename_mismatch_rejected(client: AsyncClient):
    """预览令牌绑定 filename：用它访问别的文件应被拒。"""
    token, _user_id, stored = await _register_and_upload(
        client, "doc.pdf", b"%PDF-1.4 fake", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}
    issue = await client.get(
        "/api/v1/preview/token",
        headers=headers,
        params={"filename": stored},
    )
    preview_token = issue.json()["token"]

    resp = await client.get(f"/api/v1/preview/other.pdf?token={preview_token}")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_preview_returns_404_for_missing_file(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={
        "username": "preview_missing",
        "password": "test1234",
        "invite_code": settings.registration_invite_code,
    })
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/v1/preview/non-existent.pdf", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_preview_rejects_unsupported_extension(client: AsyncClient):
    from src.services.workspace.file.file_service import get_user_upload_dir

    token, _user_id, _stored = await _register_and_upload(
        client, "real.pdf", b"%PDF-1.4 ok", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}

    me = await client.get("/api/v1/auth/me", headers=headers)
    user_id = me.json()["id"]
    user_dir = get_user_upload_dir(user_id)
    (user_dir / "notes.txt").write_bytes(b"plain text")

    resp = await client.get("/api/v1/preview/notes.txt", headers=headers)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_preview_path_traversal_blocked(client: AsyncClient):
    token, _user_id, _stored = await _register_and_upload(
        client, "real.pdf", b"%PDF-1.4 ok", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}

    # 尝试目录穿越访问其他用户文件
    resp = await client.get("/api/v1/preview/../2/secret.pdf", headers=headers)
    # 路径解析后超出 user_dir，应被拒绝（403/404，不能 200）
    assert resp.status_code in (403, 404, 400)


@pytest.mark.asyncio
async def test_preview_path_traversal_prefix_confusion_blocked(client: AsyncClient):
    """前缀混淆：受害者目录名是攻击者目录名前缀时，startswith 会误判放行；is_relative_to 必须拦。"""
    from src.services.workspace.file.file_service import get_user_upload_dir

    token, user_id, _stored = await _register_and_upload(
        client, "real.pdf", b"%PDF-1.4 ok", "application/pdf"
    )
    headers = {"Authorization": f"Bearer {token}"}

    # 攻击者目录（username 命名）；构造一个以其为前缀的"受害者"目录并放入文件
    attacker_dir = get_user_upload_dir(user_id)
    victim_name = f"{attacker_dir.name}_victim"
    victim_dir = attacker_dir.parent / victim_name
    victim_dir.mkdir(parents=True, exist_ok=True)
    (victim_dir / "secret.pdf").write_bytes(b"%PDF-stolen")

    resp = await client.get(f"/api/v1/preview/../{victim_name}/secret.pdf", headers=headers)
    # 不能 200：前缀混淆下旧 startswith 会放行，is_relative_to 必须拦
    assert resp.status_code in (403, 404)


# ---- 公开图片/封面：仅"被已发布文章引用"才可访问 ----


async def _upload_image(client: AsyncClient, name: str = "img.png") -> tuple[str, int, str]:
    """注册 preview_user 并上传一张 png，返回 (token, user_id, stored_name)。"""
    return await _register_and_upload(
        client, name, b"\x89PNG\r\n\x1a\n fakepng", "image/png"
    )


@pytest.mark.asyncio
async def test_public_image_hidden_when_not_referenced(client: AsyncClient):
    """未关联任何已发布文章的图片，公开接口应 404（防草稿/未关联图片泄露）。"""
    _token, _user_id, stored = await _upload_image(client)
    resp = await client.get(f"/api/v1/public/uploads/preview_user/{stored}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_image_visible_when_in_published_post(client: AsyncClient, db_session):
    """被已发布文章 published revision 引用的图片，公开接口应 200。"""
    _token, user_id, stored = await _upload_image(client)
    post = BlogPost(
        user_id=user_id,
        title="已发布",
        slug="pub-img",
        content="草稿工作副本",
        status="published",
        published_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(post)
    await db_session.flush()
    rev = BlogPostRevision(
        post_id=post.id,
        user_id=user_id,
        revision_number=1,
        kind="publish",
        title="已发布",
        slug="pub-img",
        content=f"<img src='/api/v1/public/uploads/preview_user/{stored}'>",
    )
    db_session.add(rev)
    await db_session.flush()
    post.published_revision_id = rev.id
    await db_session.commit()

    resp = await client.get(f"/api/v1/public/uploads/preview_user/{stored}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_public_image_hidden_when_only_draft(client: AsyncClient, db_session):
    """图片只出现在草稿工作副本（无 published revision），公开接口应 404。"""
    _token, user_id, stored = await _upload_image(client)
    post = BlogPost(
        user_id=user_id,
        title="草稿",
        slug="draft-img",
        content=f"<img src='/api/v1/public/uploads/preview_user/{stored}'>",
        status="draft",
    )
    db_session.add(post)
    await db_session.commit()

    resp = await client.get(f"/api/v1/public/uploads/preview_user/{stored}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_blog_cover_visible_when_in_published_revision(client: AsyncClient, db_session):
    """封面被已发布文章 revision 引用时，/blog/cover 可访问。"""
    _token, user_id, stored = await _upload_image(client, "cover.png")
    post = BlogPost(
        user_id=user_id,
        title="封面文",
        slug="pub-cover",
        content="x",
        status="published",
        published_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(post)
    await db_session.flush()
    rev = BlogPostRevision(
        post_id=post.id,
        user_id=user_id,
        revision_number=1,
        kind="publish",
        title="封面文",
        slug="pub-cover",
        content="x",
        cover_image=f"/api/v1/blog/cover/{stored}",
    )
    db_session.add(rev)
    await db_session.flush()
    post.published_revision_id = rev.id
    await db_session.commit()

    resp = await client.get(f"/api/v1/blog/cover/{stored}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_public_image_visible_for_owner(client: AsyncClient, db_session):
    """作者本人携带凭证访问自己的草稿图片应放行（编辑器渲染草稿正文的场景）。"""
    token, user_id, stored = await _upload_image(client)
    post = BlogPost(
        user_id=user_id,
        title="草稿",
        slug="owner-draft",
        content=f"<img src='/api/v1/public/uploads/preview_user/{stored}'>",
        status="draft",
    )
    db_session.add(post)
    await db_session.commit()

    resp = await client.get(
        f"/api/v1/public/uploads/preview_user/{stored}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_public_upload_does_not_create_dir_for_arbitrary_username(client: AsyncClient):
    """公共接口对未校验的 username 不应创建上传目录（防空目录滥用）。"""
    fake = "nonexistent_user_xyz"
    resp = await client.get(f"/api/v1/public/uploads/{fake}/img.png")
    assert resp.status_code == 404
    assert not (file_service.UPLOAD_DIR / fake).exists()
