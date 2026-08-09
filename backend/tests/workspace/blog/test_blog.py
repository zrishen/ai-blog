"""Blog working-copy and immutable revision integration tests."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost, BlogPostRevision, User
from src.services.workspace.blog.blog_service import (
    commit_revision,
    create_post,
    delete_post,
    get_published_post_by_id,
    list_revisions,
)
from src.services.workspace.trash.trash_service import purge_item


async def create_post_request(client: AsyncClient, *, title: str = "Article", content: str = "Initial body", status: str = "draft") -> dict:
    response = await client.post("/api/v1/blog/posts", json={"title": title, "content": content, "status": status})
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_working_copy_autosave_updates_db_without_a_revision(client: AsyncClient, db_session: AsyncSession):
    created = await create_post_request(client)
    response = await client.put(
        f"/api/v1/blog/posts/{created['id']}",
        json={"content": "Autosaved working copy", "tags": "autosave"},
    )
    assert response.status_code == 200
    post = await db_session.get(BlogPost, created["id"])
    assert post is not None
    assert post.content == "Autosaved working copy"
    assert post.file_path is None
    assert post.blocks_json is not None
    revisions = await client.get(f"/api/v1/blog/posts/{post.id}/revisions")
    assert revisions.status_code == 200
    assert revisions.json()["revisions"] == []


@pytest.mark.asyncio
async def test_public_content_stays_at_published_revision_when_working_copy_changes(client: AsyncClient):
    created = await create_post_request(client, content="Published body", status="published")
    post_id = created["id"]
    assert (await client.put(f"/api/v1/blog/posts/{post_id}", json={"content": "Private next body"})).status_code == 200

    public = await client.get(f"/api/v1/blog/posts/{post_id}")
    assert public.status_code == 200
    assert public.json()["content"] == "Published body"

    owner = await client.get(f"/api/v1/blog/posts/{post_id}", headers={"Authorization": "Bearer ignored"})
    # The test override provides the owner independently of the token.
    assert owner.status_code == 200

    assert (await client.put(f"/api/v1/blog/posts/{post_id}/publish", json={"publish": True})).status_code == 200
    public_after_publish = await client.get(f"/api/v1/blog/posts/{post_id}")
    assert public_after_publish.json()["content"] == "Private next body"


@pytest.mark.asyncio
async def test_commit_revision_detail_and_public_delete_protection(client: AsyncClient):
    created = await create_post_request(client, status="published")
    post_id = created["id"]
    commit = await client.post(f"/api/v1/blog/posts/{post_id}/revisions")
    assert commit.status_code == 201
    assert commit.json()["kind"] == "commit"

    revisions = (await client.get(f"/api/v1/blog/posts/{post_id}/revisions")).json()["revisions"]
    assert len(revisions) == 2
    published = next(item for item in revisions if item["is_published"])
    detail = await client.get(f"/api/v1/blog/posts/{post_id}/revisions/{commit.json()['id']}")
    assert detail.status_code == 200
    assert detail.json()["content"] == "Initial body"
    assert (await client.delete(f"/api/v1/blog/posts/{post_id}/revisions/{published['id']}")).status_code == 409
    assert (await client.delete(f"/api/v1/blog/posts/{post_id}/revisions/{commit.json()['id']}")).status_code == 200


@pytest.mark.asyncio
async def test_restore_replaces_working_copy_without_creating_a_revision_or_publishing(client: AsyncClient):
    created = await create_post_request(client, content="Version one", status="published")
    post_id = created["id"]
    assert (await client.put(f"/api/v1/blog/posts/{post_id}", json={"content": "Version two"})).status_code == 200
    commit = await client.post(f"/api/v1/blog/posts/{post_id}/revisions")
    assert commit.status_code == 201
    assert (await client.put(f"/api/v1/blog/posts/{post_id}", json={"content": "Version three"})).status_code == 200

    restored = await client.post(f"/api/v1/blog/posts/{post_id}/revisions/{commit.json()['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["content"] == "Version two"
    public = await client.get(f"/api/v1/blog/posts/{post_id}")
    assert public.json()["content"] == "Version one"
    revisions = (await client.get(f"/api/v1/blog/posts/{post_id}/revisions")).json()["revisions"]
    assert [revision["kind"] for revision in revisions] == ["commit", "publish"]


@pytest.mark.asyncio
async def test_revision_retention_keeps_published_revision_within_limit(client: AsyncClient, db_session: AsyncSession):
    created = await create_post_request(client, status="published")
    post_id = created["id"]
    for index in range(11):
        assert (await client.put(f"/api/v1/blog/posts/{post_id}", json={"content": f"Working {index}"})).status_code == 200
        assert (await client.post(f"/api/v1/blog/posts/{post_id}/revisions")).status_code == 201

    post = await db_session.get(BlogPost, post_id)
    revisions = await list_revisions(db_session, post_id, post.user_id)
    assert len(revisions) == 10
    assert post.published_revision_id in {revision.id for revision in revisions}


@pytest.mark.asyncio
async def test_revisions_are_user_scoped(db_session: AsyncSession):
    db_session.add_all([
        User(id=1, username="owner-one", password_hash="hash"),
        User(id=2, username="owner-two", password_hash="hash"),
    ])
    await db_session.commit()
    post = await create_post(db_session, {"title": "Owned", "content": "Body"}, 1)
    revision = await commit_revision(db_session, post.id, 1)
    with pytest.raises(ValueError, match="Post not found"):
        await list_revisions(db_session, post.id, 2)
    assert revision.user_id == 1


@pytest.mark.asyncio
async def test_permanent_delete_cascades_revisions(db_session: AsyncSession):
    db_session.add(User(id=1, username="testuser", password_hash="hash"))
    await db_session.commit()
    post = await create_post(db_session, {"title": "Delete", "content": "Body"}, 1)
    await commit_revision(db_session, post.id, 1)
    await delete_post(db_session, post.id, 1)
    await purge_item(db_session, item_type="blog_post", item_id=post.id, user_id=1)
    assert await db_session.get(BlogPost, post.id) is None
    rows = await db_session.execute(select(BlogPostRevision).where(BlogPostRevision.post_id == post.id))
    assert rows.scalars().all() == []


@pytest.mark.asyncio
async def test_public_projection_requires_a_published_revision(db_session: AsyncSession):
    db_session.add(User(id=1, username="testuser", password_hash="hash"))
    draft = BlogPost(title="Legacy", slug="legacy", content="Old data", user_id=1, status="published")
    db_session.add(draft)
    await db_session.commit()
    assert await get_published_post_by_id(db_session, draft.id) is None


@pytest.mark.asyncio
async def test_invalid_status_rejected(client: AsyncClient):
    """非法 status（如 archived）应在创建/更新时被 422 拒绝，而非静默变草稿/不生效。"""
    resp = await client.post(
        "/api/v1/blog/posts",
        json={"title": "Bad", "content": "Body", "status": "archived"},
    )
    assert resp.status_code == 422

    created = await create_post_request(client, title="Valid", content="Body", status="published")
    post_id = created["id"]
    resp = await client.put(f"/api/v1/blog/posts/{post_id}", json={"status": "archived"})
    assert resp.status_code == 422
