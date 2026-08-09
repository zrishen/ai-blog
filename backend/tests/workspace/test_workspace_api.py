"""工作区 API 测试：目录树 + 资源挂靠 + AI 知识（HTTP 层）。"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import BlogPost, FileDocument
from src.services.workspace.file import file_processing_service


@pytest.mark.asyncio
async def test_folder_lifecycle(client: AsyncClient):
    resp = await client.post("/api/v1/workspace/folders", json={"name": "Agent"})
    assert resp.status_code == 201
    folder = resp.json()
    assert folder["name"] == "Agent"
    assert folder["node_type"] == "folder"
    fid = folder["id"]

    resp = await client.post("/api/v1/workspace/folders", json={"name": "资料", "parent_id": fid})
    assert resp.status_code == 201
    assert resp.json()["parent_id"] == fid

    resp = await client.get("/api/v1/workspace/tree")
    assert resp.status_code == 200
    assert len(resp.json()["nodes"]) == 2

    resp = await client.patch(
        f"/api/v1/workspace/nodes/{fid}", json={"name": "Agent Memory"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Agent Memory"

    resp = await client.delete(f"/api/v1/workspace/nodes/{fid}")
    assert resp.status_code == 204
    assert len((await client.get("/api/v1/workspace/tree")).json()["nodes"]) == 0


@pytest.mark.asyncio
async def test_move_node_prevents_cycle(client: AsyncClient):
    a = (await client.post("/api/v1/workspace/folders", json={"name": "A"})).json()
    b = (await client.post("/api/v1/workspace/folders", json={"name": "B", "parent_id": a["id"]})).json()
    resp = await client.post(f"/api/v1/workspace/nodes/{a['id']}/move", json={"parent_id": b["id"]})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_attach_and_detach_resource(client: AsyncClient, db_session: AsyncSession):
    folder = (await client.post("/api/v1/workspace/folders", json={"name": "F"})).json()
    doc = FileDocument(
        collection_name="user_1", user_id="1", original_name="x.pdf",
        file_path="x.store", chunk_content="not indexed", meta="",
    )
    db_session.add(doc)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/workspace/resources/attach",
        json={"resource_type": "file", "resource_id": doc.id, "parent_id": folder["id"]},
    )
    assert resp.status_code == 201
    assert resp.json()["resource_type"] == "file"

    resp = await client.delete(f"/api/v1/workspace/resources/file/{doc.id}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_workspace_tree_includes_blog_publish_status(client: AsyncClient, db_session: AsyncSession):
    folder = (await client.post("/api/v1/workspace/folders", json={"name": "F"})).json()
    post = BlogPost(title="Published", slug="published", content="c", status="published", user_id=1)
    db_session.add(post)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/workspace/resources/attach",
        json={"resource_type": "blog_post", "resource_id": post.id, "parent_id": folder["id"]},
    )
    assert resp.status_code == 201

    tree = (await client.get("/api/v1/workspace/tree")).json()["nodes"]
    node = next(item for item in tree if item["resource_id"] == post.id)
    assert node["blog_status"] == "published"


@pytest.mark.asyncio
async def test_ai_knowledge_join_file_indexes(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    doc = FileDocument(
        collection_name="user_1", user_id="1", original_name="x.pdf",
        file_path="x.store", chunk_content="not indexed", meta="",
    )
    db_session.add(doc)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/workspace/ai-knowledge",
        json={"resource_type": "file", "resource_id": doc.id},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["rag_source"]["index_status"] == "pending"
    assert body["rag_source"]["collection_name"] == "user_1"
    assert body["job"]["job_type"] == "index"
    assert body["job"]["status"] == "queued"

    assert len((await client.get("/api/v1/workspace/ai-knowledge")).json()) == 1

    resp = await client.delete(f"/api/v1/workspace/ai-knowledge/file/{doc.id}")
    assert resp.status_code == 204
    assert len((await client.get("/api/v1/workspace/ai-knowledge")).json()) == 0


@pytest.mark.asyncio
async def test_ai_knowledge_join_blog_indexes(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    post = BlogPost(title="t", slug="blog-join", content="c", user_id=1)
    db_session.add(post)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/workspace/ai-knowledge",
        json={"resource_type": "blog_post", "resource_id": post.id},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["rag_source"]["index_status"] == "pending"
    assert body["rag_source"]["resource_type"] == "blog_post"
    assert body["job"]["job_type"] == "index"
    assert body["job"]["target_resource_type"] == "blog_post"
    assert body["job"]["target_resource_id"] == post.id
