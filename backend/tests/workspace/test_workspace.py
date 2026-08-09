"""工作区组织层服务测试：目录树 CRUD + 资源挂靠 + RAG 源状态机。"""

import hashlib
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.database.models import BlogPost, FileDocument, FileProcessingJob, WorkspaceNode
from src.services.workspace.file import file_processing_service
from src.services.workspace import node_service, rag_service, resource_service

TEST_USER_ID = 1
OTHER_USER_ID = 2


# ---- node_service: 目录树 ----


@pytest.mark.asyncio
async def test_create_folder_root(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="Agent Memory")
    assert folder.node_type == "folder"
    assert folder.parent_id is None
    assert folder.name == "Agent Memory"
    assert folder.slug == "agent-memory"
    assert folder.sort_order == 0


@pytest.mark.asyncio
async def test_create_folder_nested(db_session: AsyncSession):
    parent = await node_service.create_folder(db_session, TEST_USER_ID, name="项目")
    child = await node_service.create_folder(db_session, TEST_USER_ID, name="参考资料", parent_id=parent.id)
    assert child.parent_id == parent.id
    assert child.sort_order == 0


@pytest.mark.asyncio
async def test_create_folder_duplicate_slug(db_session: AsyncSession):
    await node_service.create_folder(db_session, TEST_USER_ID, name="草稿")
    dup = await node_service.create_folder(db_session, TEST_USER_ID, name="草稿")
    assert dup.slug == "草稿-2"


@pytest.mark.asyncio
async def test_create_folder_empty_name(db_session: AsyncSession):
    with pytest.raises(ValidationFailedError):
        await node_service.create_folder(db_session, TEST_USER_ID, name="   ")


@pytest.mark.asyncio
async def test_reorder_children_reorders_all(db_session: AsyncSession):
    """完整无重复列表：按新顺序写 sort_order，返回值与 list_children 均按新顺序。"""
    parent = await node_service.create_folder(db_session, TEST_USER_ID, name="P")
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A", parent_id=parent.id)
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B", parent_id=parent.id)
    c = await node_service.create_folder(db_session, TEST_USER_ID, name="C", parent_id=parent.id)
    a_id, b_id, c_id = a.id, b.id, c.id
    reordered = await node_service.reorder_children(
        db_session, TEST_USER_ID, parent.id, [c_id, a_id, b_id]
    )
    assert [n.id for n in reordered] == [c_id, a_id, b_id]
    fetched = await node_service.list_children(db_session, TEST_USER_ID, parent.id)
    assert [n.id for n in fetched] == [c_id, a_id, b_id]


@pytest.mark.asyncio
async def test_reorder_children_rejects_partial_list(db_session: AsyncSession):
    """缺节点：必须拒绝，避免污染 sort_order。"""
    parent = await node_service.create_folder(db_session, TEST_USER_ID, name="P2")
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A", parent_id=parent.id)
    await node_service.create_folder(db_session, TEST_USER_ID, name="B", parent_id=parent.id)
    with pytest.raises(ValidationFailedError):
        await node_service.reorder_children(db_session, TEST_USER_ID, parent.id, [a.id])


@pytest.mark.asyncio
async def test_reorder_children_rejects_duplicates(db_session: AsyncSession):
    """重复 id：必须拒绝。"""
    parent = await node_service.create_folder(db_session, TEST_USER_ID, name="P3")
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A", parent_id=parent.id)
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B", parent_id=parent.id)
    with pytest.raises(ValidationFailedError):
        await node_service.reorder_children(
            db_session, TEST_USER_ID, parent.id, [a.id, b.id, a.id]
        )


@pytest.mark.asyncio
async def test_rename_node(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="old")
    renamed = await node_service.rename_node(db_session, TEST_USER_ID, folder.id, "new name")
    assert renamed.name == "new name"
    assert renamed.slug == "new-name"


@pytest.mark.asyncio
async def test_move_node_prevents_cycle(db_session: AsyncSession):
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B", parent_id=a.id)
    with pytest.raises(ConflictError):
        await node_service.move_node(db_session, TEST_USER_ID, a.id, new_parent_id=b.id)


@pytest.mark.asyncio
async def test_move_node_into_self(db_session: AsyncSession):
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    with pytest.raises(ConflictError):
        await node_service.move_node(db_session, TEST_USER_ID, a.id, new_parent_id=a.id)


@pytest.mark.asyncio
async def test_move_node_ok(db_session: AsyncSession):
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B")
    moved = await node_service.move_node(db_session, TEST_USER_ID, b.id, new_parent_id=a.id)
    assert moved.parent_id == a.id


@pytest.mark.asyncio
async def test_delete_folder_soft_deletes(db_session: AsyncSession):
    parent = await node_service.create_folder(db_session, TEST_USER_ID, name="父")
    await node_service.create_folder(db_session, TEST_USER_ID, name="子", parent_id=parent.id)
    await node_service.delete_node(db_session, TEST_USER_ID, parent.id)
    roots = await node_service.list_children(db_session, TEST_USER_ID, None)
    assert all(nd.id != parent.id for nd in roots)
    with pytest.raises(NotFoundError):
        await node_service.get_owned_node(db_session, parent.id, TEST_USER_ID)


@pytest.mark.asyncio
async def test_reorder_children(db_session: AsyncSession):
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B")
    c = await node_service.create_folder(db_session, TEST_USER_ID, name="C")
    await node_service.reorder_children(db_session, TEST_USER_ID, None, [c.id, a.id, b.id])
    roots = await node_service.list_children(db_session, TEST_USER_ID, None)
    assert [nd.id for nd in roots] == [c.id, a.id, b.id]


@pytest.mark.asyncio
async def test_get_folder_path(db_session: AsyncSession):
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B", parent_id=a.id)
    path = await node_service.get_folder_path(db_session, TEST_USER_ID, b.id)
    assert [nd.name for nd in path] == ["A", "B"]


@pytest.mark.asyncio
async def test_ownership_isolation(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="mine")
    with pytest.raises(OwnershipError):
        await node_service.get_owned_node(db_session, folder.id, OTHER_USER_ID)


# ---- resource_service: 挂靠 ----


@pytest.mark.asyncio
async def test_attach_and_get_resource(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    node = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=10, parent_id=folder.id, name="我的草稿"
    )
    assert node.node_type == "resource"
    assert node.resource_type == "blog_post"
    assert node.resource_id == 10
    found = await resource_service.get_resource_node(db_session, TEST_USER_ID, "blog_post", 10)
    assert found is not None and found.id == node.id


@pytest.mark.asyncio
async def test_attach_duplicate_resource_conflict(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="file", resource_id=1, parent_id=folder.id
    )
    with pytest.raises(ConflictError):
        await resource_service.attach_resource(
            db_session, TEST_USER_ID, resource_type="file", resource_id=1, parent_id=folder.id
        )


@pytest.mark.asyncio
async def test_detach_resource(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=5, parent_id=folder.id
    )
    await resource_service.detach_resource(db_session, TEST_USER_ID, "blog_post", 5)
    assert await resource_service.get_resource_node(db_session, TEST_USER_ID, "blog_post", 5) is None


@pytest.mark.asyncio
async def test_move_resource(db_session: AsyncSession):
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B")
    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=7, parent_id=a.id
    )
    moved = await resource_service.move_resource(db_session, TEST_USER_ID, "blog_post", 7, new_parent_id=b.id)
    assert moved.parent_id == b.id


@pytest.mark.asyncio
async def test_delete_folder_soft_deletes_resource_nodes(db_session: AsyncSession):
    """删 folder 时 resource 挂靠点随 folder 软删（保留挂靠关系供回收站恢复）。"""
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    folder_id = folder.id
    attached = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=99, parent_id=folder_id
    )
    attached_id = attached.id
    await node_service.delete_node(db_session, TEST_USER_ID, folder_id)
    db_session.expire_all()
    folder_node = await db_session.get(WorkspaceNode, folder_id)
    res_node = await db_session.get(WorkspaceNode, attached_id)
    assert folder_node is not None and folder_node.deleted_at is not None
    assert res_node is not None and res_node.deleted_at is not None


@pytest.mark.asyncio
async def test_attach_invalid_resource_type(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    with pytest.raises(ValidationFailedError):
        await resource_service.attach_resource(
            db_session, TEST_USER_ID, resource_type="unknown", resource_id=1, parent_id=folder.id
        )


@pytest.mark.asyncio
async def test_restore_subtree_restores_folders_and_resources(db_session: AsyncSession):
    """恢复软删子树：多层目录 + 挂靠资源全部清 deleted_at、回到原层级。"""
    post = BlogPost(title="t", slug="restore-sub", content="c", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()
    post_id = post.id
    root = await node_service.create_folder(db_session, TEST_USER_ID, name="root")
    root_id = root.id
    child = await node_service.create_folder(db_session, TEST_USER_ID, name="child", parent_id=root_id)
    child_id = child.id
    res = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post_id, parent_id=child_id
    )
    res_id = res.id
    await node_service.delete_node(db_session, TEST_USER_ID, root_id)
    db_session.expire_all()
    root_node = await db_session.get(WorkspaceNode, root_id)
    await node_service.restore_subtree(db_session, TEST_USER_ID, root_node)
    db_session.expire_all()
    for nid in (root_id, child_id, res_id):
        node = await db_session.get(WorkspaceNode, nid)
        assert node is not None and node.deleted_at is None
    assert (await db_session.get(WorkspaceNode, child_id)).parent_id == root_id
    assert (await db_session.get(WorkspaceNode, res_id)).parent_id == child_id


@pytest.mark.asyncio
async def test_restore_subtree_slug_conflict_appends_suffix(db_session: AsyncSession):
    """恢复时同级已有同名目录：slug 追加后缀，name 不变。"""
    root = await node_service.create_folder(db_session, TEST_USER_ID, name="dup")
    root_id = root.id
    await node_service.delete_node(db_session, TEST_USER_ID, root_id)
    await node_service.create_folder(db_session, TEST_USER_ID, name="dup")  # 占用 slug=dup
    db_session.expire_all()
    root_node = await db_session.get(WorkspaceNode, root_id)
    await node_service.restore_subtree(db_session, TEST_USER_ID, root_node)
    db_session.expire_all()
    restored = await db_session.get(WorkspaceNode, root_id)
    assert restored is not None and restored.deleted_at is None
    assert restored.slug == "dup-2"
    assert restored.name == "dup"


@pytest.mark.asyncio
async def test_restore_subtree_drops_node_for_purged_resource(db_session: AsyncSession):
    """恢复时底层资源已不存在（视为 purge）：悬空挂靠点硬删，不残留幽灵节点。"""
    root = await node_service.create_folder(db_session, TEST_USER_ID, name="r")
    root_id = root.id
    res = await resource_service.attach_resource(  # resource_id=777 底层无对应 BlogPost
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=777, parent_id=root_id
    )
    res_id = res.id
    await node_service.delete_node(db_session, TEST_USER_ID, root_id)
    db_session.expire_all()
    root_node = await db_session.get(WorkspaceNode, root_id)
    await node_service.restore_subtree(db_session, TEST_USER_ID, root_node)
    db_session.expire_all()
    assert await db_session.get(WorkspaceNode, root_id) is not None
    assert await db_session.get(WorkspaceNode, res_id) is None


@pytest.mark.asyncio
async def test_purge_subtree_removes_all_nodes(db_session: AsyncSession):
    """永久删除子树：所有 WorkspaceNode 硬删。"""
    root = await node_service.create_folder(db_session, TEST_USER_ID, name="pr")
    root_id = root.id
    child = await node_service.create_folder(db_session, TEST_USER_ID, name="prc", parent_id=root_id)
    child_id = child.id
    res = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=888, parent_id=child_id
    )
    res_id = res.id
    await node_service.delete_node(db_session, TEST_USER_ID, root_id)
    await node_service.purge_subtree(db_session, root_id)
    db_session.expire_all()
    for nid in (root_id, child_id, res_id):
        assert await db_session.get(WorkspaceNode, nid) is None


@pytest.mark.asyncio
async def test_attach_revives_soft_deleted_node(db_session: AsyncSession):
    """删 folder 后同资源重新 attach：复活同一挂靠点（id 不变、parent 更新）。"""
    a = await node_service.create_folder(db_session, TEST_USER_ID, name="A")
    b = await node_service.create_folder(db_session, TEST_USER_ID, name="B")
    attached = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=123, parent_id=a.id
    )
    attached_id = attached.id
    await node_service.delete_node(db_session, TEST_USER_ID, a.id)
    revived = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=123, parent_id=b.id
    )
    assert revived.id == attached_id
    assert revived.parent_id == b.id
    assert revived.deleted_at is None


@pytest.mark.asyncio
async def test_list_trash_workspace_folder_deletion_roots(db_session: AsyncSession):
    """list_trash 只列删除根 folder，连带软删的子 folder 不重复出现。"""
    from src.services.workspace.trash.trash_service import list_trash

    root = await node_service.create_folder(db_session, TEST_USER_ID, name="root")
    await node_service.create_folder(db_session, TEST_USER_ID, name="child", parent_id=root.id)
    await node_service.delete_node(db_session, TEST_USER_ID, root.id)
    items = await list_trash(db_session, user_id=TEST_USER_ID)
    folder_items = [i for i in items if i.type == "workspace_folder"]
    assert len(folder_items) == 1
    assert folder_items[0].id == root.id


# ---- rag_service: AI 知识 ----


@pytest.mark.asyncio
async def test_add_to_ai_knowledge_idempotent(db_session: AsyncSession):
    s1 = await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=1
    )
    s2 = await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=1
    )
    assert s1.id == s2.id
    assert s1.index_status == "pending"
    assert s1.collection_name == "user_1"


@pytest.mark.asyncio
async def test_mark_indexed_and_stale(db_session: AsyncSession):
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=3
    )
    active = await rag_service.mark_indexed(db_session, TEST_USER_ID, "blog_post", 3, version="v1")
    assert active.index_status == "active"
    assert active.indexed_version == "v1"
    stale = await rag_service.mark_stale(db_session, TEST_USER_ID, "blog_post", 3)
    assert stale.index_status == "stale"


@pytest.mark.asyncio
async def test_blog_index_snapshot_mismatch_stays_stale(db_session: AsyncSession):
    post = BlogPost(title="snapshot", slug="snapshot", content="first", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id
    )

    snapshot_sha256 = hashlib.sha256(b"first").hexdigest()
    post.content = "second"
    await db_session.commit()

    source = await rag_service.mark_blog_post_indexed_if_current(
        db_session,
        TEST_USER_ID,
        post.id,
        body_sha256=snapshot_sha256,
    )
    assert source is not None
    assert source.index_status == "stale"
    assert source.indexed_version is None


@pytest.mark.asyncio
async def test_update_post_content_marks_ai_knowledge_stale(db_session: AsyncSession):
    """博客正文变更 → 已加入 AI 知识的资源标 stale（旧索引保留可用，用户手动刷新后重建）。"""
    from src.services.workspace.blog.blog_service import update_post

    post = BlogPost(title="原标", slug="stale-on-edit", content="原正文", user_id=TEST_USER_ID, status="draft")
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id
    )
    await rag_service.mark_indexed(db_session, TEST_USER_ID, "blog_post", post.id)

    await update_post(db_session, post.id, {"content": "改后的正文"}, TEST_USER_ID)

    source = await rag_service.get_rag_source(db_session, TEST_USER_ID, "blog_post", post.id)
    assert source is not None
    assert source.index_status == "stale"


@pytest.mark.asyncio
async def test_update_post_without_content_change_keeps_active(db_session: AsyncSession):
    """正文未实质变更 → 不标 stale，索引保持 active。"""
    from src.services.workspace.blog.blog_service import update_post

    post = BlogPost(title="原标", slug="active-on-edit", content="原正文", user_id=TEST_USER_ID, status="draft")
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id
    )
    await rag_service.mark_indexed(db_session, TEST_USER_ID, "blog_post", post.id)

    await update_post(db_session, post.id, {"content": "原正文"}, TEST_USER_ID)

    source = await rag_service.get_rag_source(db_session, TEST_USER_ID, "blog_post", post.id)
    assert source is not None
    assert source.index_status == "active"


@pytest.mark.asyncio
async def test_unindex_cancels_active_index_job(db_session: AsyncSession):
    """移除 AI 知识资源时，该资源进行中的 index job 被取消（标 cancelled），不再跑完浪费。"""
    import uuid

    post = BlogPost(title="t", slug="cancel-on-unindex", content="c", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    collection = rag_service.blog_collection_name(TEST_USER_ID)
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id, collection_name=collection
    )
    job = FileProcessingJob(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        job_type="index",
        target_resource_type="blog_post",
        target_resource_id=post.id,
        status="running",
        current_stage="embedding",
        progress_model_version="index_v1",
        progress_percent=40,
        progress_json={},
        client_request_id=str(uuid.uuid4()),
        original_name="t",
        stored_name=f"blog_post:{post.id}",
        collection_name=collection,
    )
    db_session.add(job)
    await db_session.commit()

    await rag_service.unindex_blog_post(db_session, TEST_USER_ID, post.id)

    refreshed = await db_session.get(FileProcessingJob, job.id)
    assert refreshed is not None
    assert refreshed.status == "cancelled"


@pytest.mark.asyncio
async def test_delete_post_cancels_active_index_job(db_session: AsyncSession):
    """博客进回收站（软删）即取消进行中的索引任务，不等到永久删除。"""
    import uuid

    from src.services.workspace.blog.blog_service import delete_post

    post = BlogPost(title="t", slug="cancel-on-soft-delete", content="c", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    collection = rag_service.blog_collection_name(TEST_USER_ID)
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id, collection_name=collection
    )
    job = FileProcessingJob(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        job_type="index",
        target_resource_type="blog_post",
        target_resource_id=post.id,
        status="running",
        current_stage="embedding",
        progress_model_version="index_v1",
        progress_percent=40,
        progress_json={},
        client_request_id=str(uuid.uuid4()),
        original_name="t",
        stored_name=f"blog_post:{post.id}",
        collection_name=collection,
    )
    db_session.add(job)
    await db_session.commit()

    await delete_post(db_session, post.id, TEST_USER_ID)

    refreshed = await db_session.get(FileProcessingJob, job.id)
    assert refreshed is not None
    assert refreshed.status == "cancelled"


@pytest.mark.asyncio
async def test_unindex_deletes_ai_brain_memory_immediately(db_session: AsyncSession, monkeypatch):
    """移出 AI 知识即时清 AI 大脑记忆（delete_resource_memory），不等维护周期。"""
    from src.services.memory import graph_store

    calls = []

    async def spy(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(graph_store, "delete_resource_memory", spy)

    post = BlogPost(title="t", slug="del-mem", content="c", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    collection = rag_service.blog_collection_name(TEST_USER_ID)
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id, collection_name=collection
    )

    await rag_service.unindex_blog_post(db_session, TEST_USER_ID, post.id)

    assert calls == [{"user_id": TEST_USER_ID, "resource_type": "blog_post", "resource_id": post.id}]


@pytest.mark.asyncio
async def test_mark_stale_not_in_knowledge_returns_none(db_session: AsyncSession):
    assert await rag_service.mark_stale(db_session, TEST_USER_ID, "file", 999) is None


@pytest.mark.asyncio
async def test_remove_from_ai_knowledge(db_session: AsyncSession):
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=2
    )
    removed = await rag_service.remove_from_ai_knowledge(db_session, TEST_USER_ID, "file", 2)
    assert removed.collection_name == "user_1"
    assert await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", 2) is None


@pytest.mark.asyncio
async def test_remove_not_in_knowledge_raises(db_session: AsyncSession):
    with pytest.raises(NotFoundError):
        await rag_service.remove_from_ai_knowledge(db_session, TEST_USER_ID, "file", 404)


@pytest.mark.asyncio
async def test_mark_failed(db_session: AsyncSession):
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=8
    )
    failed = await rag_service.mark_failed(
        db_session, TEST_USER_ID, "file", 8, error_message="解析失败"
    )
    assert failed.index_status == "failed"
    assert failed.error_message == "解析失败"


@pytest.mark.asyncio
async def test_list_ai_knowledge_by_status(db_session: AsyncSession):
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=11
    )
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=12
    )
    await rag_service.mark_indexed(db_session, TEST_USER_ID, "blog_post", 12)
    actives = await rag_service.list_ai_knowledge(db_session, TEST_USER_ID, status="active")
    pendings = await rag_service.list_ai_knowledge(db_session, TEST_USER_ID, status="pending")
    assert len(actives) == 1
    assert len(pendings) == 1


# ---- rag_service: file 资源真实索引 + 迁移 ----


def _make_file_document(*, chunk_content: str, original_name: str = "doc.pdf") -> FileDocument:
    return FileDocument(
        collection_name=f"user_{TEST_USER_ID}",
        user_id=str(TEST_USER_ID),
        original_name=original_name,
        file_path=f"{original_name}.stored",
        chunk_content=chunk_content,
        meta="",
    )


@pytest.mark.asyncio
async def test_index_file_document_creates_pending_and_schedules_job(
    db_session: AsyncSession, monkeypatch
):
    """异步入口：建 RagSource(pending) + index job(queued) 并调度，向量由 worker 处理。"""
    doc = _make_file_document(chunk_content="not indexed")
    db_session.add(doc)
    await db_session.commit()

    scheduled: list[str] = []
    monkeypatch.setattr(file_processing_service, "schedule_job", scheduled.append)

    source, job = await rag_service.index_file_document(db_session, TEST_USER_ID, doc.id)
    assert source.index_status == "pending"
    assert source.collection_name == doc.collection_name
    assert job.job_type == "index"
    assert job.status == "queued"
    assert job.target_resource_type == "file"
    assert job.target_resource_id == doc.id
    assert job.stored_name == doc.file_path
    assert scheduled == [job.id]
    assert await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", doc.id) is not None


@pytest.mark.asyncio
async def test_index_blog_post_creates_pending_and_schedules_job(
    db_session: AsyncSession, monkeypatch
):
    post = BlogPost(title="t", slug="blog-idx", content="c", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()

    scheduled: list[str] = []
    monkeypatch.setattr(file_processing_service, "schedule_job", scheduled.append)

    source, job = await rag_service.index_blog_post(db_session, TEST_USER_ID, post.id)
    assert source.index_status == "pending"
    assert source.resource_type == "blog_post"
    assert source.collection_name == rag_service.blog_collection_name(TEST_USER_ID)
    assert job.job_type == "index"
    assert job.target_resource_type == "blog_post"
    assert job.target_resource_id == post.id
    assert job.stored_name == f"blog_post:{post.id}"
    assert scheduled == [job.id]


@pytest.mark.asyncio
async def test_schedule_reindex_for_source_dispatches_supported_resource_types(monkeypatch):
    file_job = object()
    blog_job = object()
    calls: list[tuple[str, int, int]] = []

    async def index_file(db, user_id: int, resource_id: int):
        calls.append(("file", user_id, resource_id))
        return object(), file_job

    async def index_blog(db, user_id: int, resource_id: int):
        calls.append(("blog_post", user_id, resource_id))
        return object(), blog_job

    monkeypatch.setattr(rag_service, "index_file_document", index_file)
    monkeypatch.setattr(rag_service, "index_blog_post", index_blog)

    assert await rag_service.schedule_reindex_for_source(
        object(), user_id=1, resource_type="file", resource_id=2
    ) is file_job
    assert await rag_service.schedule_reindex_for_source(
        object(), user_id=1, resource_type="blog_post", resource_id=3
    ) is blog_job
    assert await rag_service.schedule_reindex_for_source(
        object(), user_id=1, resource_type="note", resource_id=4
    ) is None
    assert calls == [("file", 1, 2), ("blog_post", 1, 3)]


@pytest.mark.asyncio
async def test_index_file_job_runs_to_active(db_session: AsyncSession, monkeypatch):
    """index job(file) 在 worker 内跑完 → RagSource active + 回写 chunk 数。"""
    from src.services.workspace.file.file_processing_service import _run_job

    doc = _make_file_document(chunk_content="not indexed")
    db_session.add(doc)
    await db_session.commit()

    async def fake_vectorize(*args, **kwargs):
        return ["chunk-1", "chunk-2"]

    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    monkeypatch.setattr(file_processing_service, "vectorize_and_store", fake_vectorize)

    doc_id = doc.id
    _, job = await rag_service.index_file_document(db_session, TEST_USER_ID, doc_id)
    job_id = job.id
    await _run_job(job_id)

    db_session.expire_all()
    source = await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", doc_id)
    assert source is not None and source.index_status == "active"
    assert source.indexed_version == "2"
    refreshed_doc = await db_session.get(FileDocument, doc_id)
    assert refreshed_doc.chunk_content == "2 chunks"
    succeeded = await db_session.get(FileProcessingJob, job_id)
    assert succeeded.status == "succeeded"


@pytest.mark.asyncio
async def test_index_blog_job_runs_to_active(db_session: AsyncSession, monkeypatch):
    """index job(blog_post) 在 worker 内跑完 → RagSource active。"""
    from src.services.workspace.file.file_processing_service import _run_job

    post = BlogPost(title="t", slug="blog-run", content="正文内容", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()

    async def fake_text_vectorize(*args, **kwargs):
        return ["c1"]

    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    monkeypatch.setattr(file_processing_service, "vectorize_text_and_store", fake_text_vectorize)

    post_id = post.id
    expected_sha256 = hashlib.sha256(post.content.encode("utf-8")).hexdigest()
    _, job = await rag_service.index_blog_post(db_session, TEST_USER_ID, post_id)
    job_id = job.id
    await _run_job(job_id)

    db_session.expire_all()
    source = await rag_service.get_rag_source(db_session, TEST_USER_ID, "blog_post", post_id)
    assert source is not None and source.index_status == "active"
    assert source.indexed_version == expected_sha256
    succeeded = await db_session.get(FileProcessingJob, job_id)
    assert succeeded.status == "succeeded"


@pytest.mark.asyncio
async def test_blog_body_snapshot_failure_keeps_existing_vectors(db_session: AsyncSession, monkeypatch):
    from src.services.workspace.file.file_processing_service import _run_job

    post = BlogPost(title="keep-vectors", slug="keep-vectors", content="body", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id
    )
    await rag_service.mark_indexed(db_session, TEST_USER_ID, "blog_post", post.id)

    async def broken_body(_post):
        raise RuntimeError("body validation failed")

    deleted_sources: list[tuple[str, str]] = []

    async def record_chunk_delete(collection_name: str, stored_name: str):
        deleted_sources.append((collection_name, stored_name))

    monkeypatch.setattr(file_processing_service, "get_post_body", broken_body)
    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    monkeypatch.setattr(file_processing_service.graph_store, "delete_document_chunks", record_chunk_delete)

    _, job = await rag_service.index_blog_post(db_session, TEST_USER_ID, post.id)
    job_id = job.id
    await _run_job(job_id)

    assert deleted_sources == []
    db_session.expire_all()
    failed_job = await db_session.get(FileProcessingJob, job_id)
    assert failed_job is not None and failed_job.status == "failed"


@pytest.mark.asyncio
async def test_index_file_job_failure_marks_rag_source_failed(
    db_session: AsyncSession, monkeypatch
):
    """index job 在 worker 内 vectorize 失败 → RagSource 标 failed。"""
    from src.services.workspace.file.file_processing_service import _run_job

    doc = _make_file_document(chunk_content="not indexed")
    db_session.add(doc)
    await db_session.commit()

    async def boom(*args, **kwargs):
        raise RuntimeError("embedding unavailable")

    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    monkeypatch.setattr(file_processing_service, "vectorize_and_store", boom)

    doc_id = doc.id
    _, job = await rag_service.index_file_document(db_session, TEST_USER_ID, doc_id)
    job_id = job.id
    await _run_job(job_id)

    db_session.expire_all()
    source = await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", doc_id)
    assert source is not None
    assert source.index_status == "failed"
    assert "embedding unavailable" in (source.error_message or "")
    failed_job = await db_session.get(FileProcessingJob, job_id)
    assert failed_job.status == "failed"


@pytest.mark.asyncio
async def test_unindex_file_document(db_session: AsyncSession):
    doc = _make_file_document(chunk_content="3 chunks")
    db_session.add(doc)
    await db_session.commit()
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=doc.id
    )
    await rag_service.mark_indexed(db_session, TEST_USER_ID, "file", doc.id)

    await rag_service.unindex_file_document(db_session, TEST_USER_ID, doc.id)

    assert await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", doc.id) is None
    await db_session.refresh(doc)
    assert doc.chunk_content == "not indexed"


@pytest.mark.asyncio
async def test_unindex_not_in_knowledge_raises(db_session: AsyncSession):
    doc = _make_file_document(chunk_content="not indexed")
    db_session.add(doc)
    await db_session.commit()
    with pytest.raises(NotFoundError):
        await rag_service.unindex_file_document(db_session, TEST_USER_ID, doc.id)


@pytest.mark.asyncio
async def test_backfill_rag_sources_from_files(db_session: AsyncSession):
    indexed = _make_file_document(chunk_content="5 chunks", original_name="a.pdf")
    not_indexed = _make_file_document(chunk_content="not indexed", original_name="b.pdf")
    db_session.add_all([indexed, not_indexed])
    await db_session.commit()

    assert await rag_service.backfill_rag_sources_from_files(db_session) == 1
    src = await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", indexed.id)
    assert src is not None and src.index_status == "active"
    assert await rag_service.get_rag_source(db_session, TEST_USER_ID, "file", not_indexed.id) is None
    # 幂等：再次迁移不再产生新记录
    assert await rag_service.backfill_rag_sources_from_files(db_session) == 0


# ---- 软删（回收站）联动：工作区/ AI 知识不得显示底层已软删的资源 ----


def _soft_delete(obj) -> None:
    obj.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.mark.asyncio
async def test_list_all_hides_resource_whose_file_is_soft_deleted(db_session: AsyncSession):
    """底层文件进回收站后，其工作区挂靠点从目录树隐藏；恢复后自动重现，不丢归档位置。"""
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    other_folder = await node_service.create_folder(db_session, TEST_USER_ID, name="G")
    doc = _make_file_document(chunk_content="not indexed", original_name="a.pdf")
    db_session.add(doc)
    await db_session.commit()

    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="file", resource_id=doc.id, parent_id=folder.id
    )

    def has_file(nodes):
        return any(nd.resource_type == "file" and nd.resource_id == doc.id for nd in nodes)

    assert has_file(await node_service.list_all(db_session, TEST_USER_ID))

    _soft_delete(doc)
    await db_session.commit()
    hidden = await node_service.list_all(db_session, TEST_USER_ID)
    assert not has_file(hidden)
    # folder 与无关节点不受影响
    assert any(nd.id == folder.id for nd in hidden)
    assert any(nd.id == other_folder.id for nd in hidden)

    # 恢复 → 重新出现
    doc.deleted_at = None
    await db_session.commit()
    assert has_file(await node_service.list_all(db_session, TEST_USER_ID))


@pytest.mark.asyncio
async def test_list_all_hides_resource_whose_blog_is_soft_deleted(db_session: AsyncSession):
    """文章同样过滤：blog_post 进回收站后挂靠点隐藏；file 软删不波及 blog。"""
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    post = BlogPost(title="t", slug="s-1", content="c", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()

    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id, parent_id=folder.id
    )
    assert any(
        nd.resource_type == "blog_post" and nd.resource_id == post.id
        for nd in await node_service.list_all(db_session, TEST_USER_ID)
    )

    _soft_delete(post)
    await db_session.commit()
    assert not any(
        nd.resource_type == "blog_post" and nd.resource_id == post.id
        for nd in await node_service.list_all(db_session, TEST_USER_ID)
    )


@pytest.mark.asyncio
async def test_list_ai_knowledge_hides_soft_deleted_file(db_session: AsyncSession):
    """AI 知识列表过滤底层已软删的文件；恢复后自动重现。"""
    doc = _make_file_document(chunk_content="not indexed", original_name="b.pdf")
    db_session.add(doc)
    await db_session.commit()
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=doc.id
    )

    assert len(await rag_service.list_ai_knowledge(db_session, TEST_USER_ID)) == 1

    _soft_delete(doc)
    await db_session.commit()
    assert len(await rag_service.list_ai_knowledge(db_session, TEST_USER_ID)) == 0

    doc.deleted_at = None
    await db_session.commit()
    assert len(await rag_service.list_ai_knowledge(db_session, TEST_USER_ID)) == 1
