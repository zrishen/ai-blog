"""HTTP tests for the filesystem-native workspace tree."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.workspace.blog.blog_service import create_post


@pytest.mark.asyncio
async def test_folder_lifecycle_uses_relative_paths(client: AsyncClient):
    created = await client.post("/api/v1/workspace/folders", json={"name": "Agent"})
    assert created.status_code == 201
    assert created.json() == {
        "path": "Agent",
        "name": "Agent",
        "kind": "folder",
        "resource_type": None,
        "resource_id": None,
        "blog_status": None,
    }

    nested = await client.post(
        "/api/v1/workspace/folders",
        json={"name": "Research", "parent_path": "Agent"},
    )
    assert nested.status_code == 201
    assert nested.json()["path"] == "Agent/Research"

    renamed = await client.patch(
        "/api/v1/workspace/entries",
        json={"path": "Agent/Research", "name": "Notes"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["path"] == "Agent/Notes"

    tree = await client.get("/api/v1/workspace/tree")
    assert {(entry["path"], entry["kind"]) for entry in tree.json()["entries"]} == {
        ("Agent", "folder"),
        ("Agent/Notes", "folder"),
    }

    assert (await client.request("DELETE", "/api/v1/workspace/folders", json={"path": "Agent/Notes"})).status_code == 204
    assert (await client.request("DELETE", "/api/v1/workspace/folders", json={"path": "Agent"})).status_code == 204


@pytest.mark.asyncio
async def test_move_entry_rejects_folder_cycle(client: AsyncClient):
    assert (await client.post("/api/v1/workspace/folders", json={"name": "A"})).status_code == 201
    assert (
        await client.post(
            "/api/v1/workspace/folders", json={"name": "B", "parent_path": "A"}
        )
    ).status_code == 201

    response = await client.post(
        "/api/v1/workspace/entries/move",
        json={"path": "A", "target_path": "A/B"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_tree_exposes_blog_at_its_real_workspace_path(
    client: AsyncClient, db_session: AsyncSession
):
    post = await create_post(
        db_session,
        {"title": "Published", "slug": "published", "content": "body", "status": "published"},
        1,
    )
    assert (await client.post("/api/v1/workspace/folders", json={"name": "Articles"})).status_code == 201
    moved = await client.post(
        "/api/v1/workspace/entries/move",
        json={"path": post.file_path, "target_path": "Articles"},
    )
    assert moved.status_code == 200
    assert moved.json()["resource_id"] == post.id
    assert moved.json()["blog_status"] == "published"
