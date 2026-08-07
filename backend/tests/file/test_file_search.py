import pytest

from src.services.memory.graph_store import MemoryHit
from src.tools.file import _filter_and_dedupe_rag_results, _format_rag_context, _search_collections


def test_rag_filter_dedupe_and_format():
    duplicate = "安装步骤：先运行 uv sync，再启动 uvicorn。"
    results = [
        ("doc_a", MemoryHit(content=duplicate, kind="chunk", metadata={"source": "a.pdf"}, score=0.2)),
        ("doc_b", MemoryHit(content=duplicate, kind="chunk", metadata={"source": "b.pdf"}, score=0.3)),
        ("doc_c", MemoryHit(content="无关内容", kind="chunk", metadata={"source": "c.pdf"}, score=0.95)),
        ("doc_d", MemoryHit(content="配置 MCP 工具需要填写 command 和 args。", kind="chunk", metadata={"source": "d.pdf"}, score=0.1)),
    ]

    filtered = _filter_and_dedupe_rag_results(results)
    context = _format_rag_context(filtered)

    assert len(filtered) == 2
    assert filtered[0][0] == "doc_d"
    assert "[检索到的参考内容]" in context
    assert "[来源 1]" in context
    assert "文件库：doc_d" in context
    assert "来源：d.pdf" in context
    assert context.count(duplicate) == 1
    assert filtered[1][1].metadata["source"] == "a.pdf"
    assert "无关内容" not in context


def test_rag_empty_context_prevents_fabrication():
    context = _format_rag_context([])

    assert "没有找到与用户问题相关的文件库内容" in context
    assert "不要编造" in context


@pytest.mark.asyncio
async def test_search_collections_only_returns_active_stored_names(monkeypatch):
    captured = {}

    async def fake_search(**kwargs):
        captured.update(kwargs)
        return [
            MemoryHit(content="active", kind="chunk", metadata={"stored_name": "active.pdf"}, score=0.1),
            MemoryHit(content="deleted", kind="chunk", metadata={"stored_name": "deleted.pdf"}, score=0.1),
            MemoryHit(content="legacy", kind="chunk", metadata={"source": "legacy.pdf"}, score=0.1),
        ]

    monkeypatch.setattr("src.services.memory.graph_store.search_documents", fake_search)

    results = await _search_collections(
        {"user_1_file": {"active.pdf"}},
        "query",
        [0.1],
        user_id=1,
    )

    assert [result.content for _, result in results] == ["active"]
    assert captured["embedding_model"].startswith("_")


@pytest.mark.asyncio
async def test_whitelist_only_includes_active_rag_sources(db_session, monkeypatch):
    """检索白名单只含 RagSource(active) 的文件；仅上传未加入 AI 知识的不在内。"""
    import contextlib

    from src.database.models import FileDocument
    from src.services.workspace import rag_service
    from src.tools.file import _get_active_file_whitelist

    @contextlib.asynccontextmanager
    async def _factory():
        yield db_session

    monkeypatch.setattr("src.database.session.async_session", _factory)

    plain = FileDocument(
        collection_name="user_1", user_id="1", original_name="plain.pdf",
        file_path="plain.store", chunk_content="not indexed", meta="",
    )
    indexed = FileDocument(
        collection_name="user_1", user_id="1", original_name="indexed.pdf",
        file_path="indexed.store", chunk_content="3 chunks", meta="",
    )
    db_session.add_all([plain, indexed])
    await db_session.commit()
    await rag_service.add_to_ai_knowledge(db_session, 1, resource_type="file", resource_id=indexed.id)
    await rag_service.mark_indexed(db_session, 1, "file", indexed.id)

    whitelist = await _get_active_file_whitelist(user_id=1)
    assert whitelist == {"user_1": {"indexed.store"}}


@pytest.mark.asyncio
async def test_whitelist_includes_active_blog_posts(db_session, monkeypatch):
    """检索白名单含 RagSource(blog_post, active)；collection 取自 RagSource，stored_name = blog_post:{id}。"""
    import contextlib

    from src.database.models import BlogPost
    from src.services.workspace import rag_service
    from src.tools.file import _get_active_file_whitelist

    @contextlib.asynccontextmanager
    async def _factory():
        yield db_session

    monkeypatch.setattr("src.database.session.async_session", _factory)

    post = BlogPost(title="t", slug="blog-wl", content="c", user_id=1)
    db_session.add(post)
    await db_session.commit()

    collection = rag_service.blog_collection_name(1)
    await rag_service.add_to_ai_knowledge(
        db_session, 1, resource_type="blog_post", resource_id=post.id, collection_name=collection
    )
    await rag_service.mark_indexed(db_session, 1, "blog_post", post.id)

    whitelist = await _get_active_file_whitelist(user_id=1)
    assert whitelist == {collection: {f"blog_post:{post.id}"}}


@pytest.mark.asyncio
async def test_whitelist_includes_stale_rag_sources(db_session, monkeypatch):
    """内容变更后标 stale 的资源仍参与检索（沿用旧索引），直到用户手动刷新重建。"""
    import contextlib

    from src.database.models import FileDocument
    from src.services.workspace import rag_service
    from src.tools.file import _get_active_file_whitelist

    @contextlib.asynccontextmanager
    async def _factory():
        yield db_session

    monkeypatch.setattr("src.database.session.async_session", _factory)

    stale = FileDocument(
        collection_name="user_1", user_id="1", original_name="stale.pdf",
        file_path="stale.store", chunk_content="3 chunks", meta="",
    )
    db_session.add(stale)
    await db_session.commit()
    await rag_service.add_to_ai_knowledge(db_session, 1, resource_type="file", resource_id=stale.id)
    await rag_service.mark_indexed(db_session, 1, "file", stale.id)
    await rag_service.mark_stale(db_session, 1, "file", stale.id)

    whitelist = await _get_active_file_whitelist(user_id=1)
    assert whitelist == {"user_1": {"stale.store"}}
