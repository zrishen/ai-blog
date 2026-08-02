"""工作区组织层服务测试：目录树 CRUD + 资源挂靠 + RAG 源状态机。"""

from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.database.models import BlogPost, FileDocument, FileProcessingJob
from src.services.file import file_processing_service
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
async def test_delete_folder_hard_deletes_resource_nodes(db_session: AsyncSession):
    """删 folder 时 resource 挂靠点硬删，资源可重新挂靠（唯一约束无残留）。"""
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=99, parent_id=folder.id
    )
    await node_service.delete_node(db_session, TEST_USER_ID, folder.id)
    other = await node_service.create_folder(db_session, TEST_USER_ID, name="G")
    node = await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=99, parent_id=other.id
    )
    assert node.parent_id == other.id


@pytest.mark.asyncio
async def test_attach_invalid_resource_type(db_session: AsyncSession):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="F")
    with pytest.raises(ValidationFailedError):
        await resource_service.attach_resource(
            db_session, TEST_USER_ID, resource_type="unknown", resource_id=1, parent_id=folder.id
        )


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
async def test_index_file_job_runs_to_active(db_session: AsyncSession, monkeypatch):
    """index job(file) 在 worker 内跑完 → RagSource active + 回写 chunk 数。"""
    from src.services.file.file_processing_service import _run_job

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
    from src.services.file.file_processing_service import _run_job

    post = BlogPost(title="t", slug="blog-run", content="正文内容", user_id=TEST_USER_ID)
    db_session.add(post)
    await db_session.commit()

    async def fake_text_vectorize(*args, **kwargs):
        return ["c1"]

    monkeypatch.setattr(file_processing_service, "schedule_job", lambda job_id: None)
    monkeypatch.setattr(file_processing_service, "vectorize_text_and_store", fake_text_vectorize)

    post_id = post.id
    _, job = await rag_service.index_blog_post(db_session, TEST_USER_ID, post_id)
    job_id = job.id
    await _run_job(job_id)

    db_session.expire_all()
    source = await rag_service.get_rag_source(db_session, TEST_USER_ID, "blog_post", post_id)
    assert source is not None and source.index_status == "active"
    assert source.indexed_version == "1"
    succeeded = await db_session.get(FileProcessingJob, job_id)
    assert succeeded.status == "succeeded"


@pytest.mark.asyncio
async def test_index_file_job_failure_marks_rag_source_failed(
    db_session: AsyncSession, monkeypatch
):
    """index job 在 worker 内 vectorize 失败 → RagSource 标 failed。"""
    from src.services.file.file_processing_service import _run_job

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


# ---- resource_service: 目录 auto_index 触发 ----


@pytest.mark.asyncio
async def test_attach_to_auto_index_folder_triggers_indexing(db_session: AsyncSession, monkeypatch):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="AI", auto_index=True)
    doc = _make_file_document(chunk_content="not indexed")
    db_session.add(doc)
    await db_session.commit()

    called: list[int] = []

    async def fake_index(db, user_id, *, document_id):
        called.append(document_id)
        return None

    monkeypatch.setattr(rag_service, "index_file_document", fake_index)

    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="file", resource_id=doc.id, parent_id=folder.id
    )
    assert called == [doc.id]


@pytest.mark.asyncio
async def test_attach_to_plain_folder_does_not_index(db_session: AsyncSession, monkeypatch):
    folder = await node_service.create_folder(db_session, TEST_USER_ID, name="普通")
    doc = _make_file_document(chunk_content="not indexed")
    db_session.add(doc)
    await db_session.commit()

    called: list[int] = []

    async def fake_index(db, user_id, *, document_id):
        called.append(document_id)

    monkeypatch.setattr(rag_service, "index_file_document", fake_index)

    await resource_service.attach_resource(
        db_session, TEST_USER_ID, resource_type="file", resource_id=doc.id, parent_id=folder.id
    )
    assert called == []


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
