import pytest

from src.tools.file import _filter_and_dedupe_rag_results, _format_rag_context, _search_collections
from src.services.rag.vector_store import SearchResult


def test_rag_filter_dedupe_and_format():
    duplicate = "安装步骤：先运行 uv sync，再启动 uvicorn。"
    results = [
        ("doc_a", SearchResult(content=duplicate, metadata={"source": "a.pdf"}, distance=0.2)),
        ("doc_b", SearchResult(content=duplicate, metadata={"source": "b.pdf"}, distance=0.3)),
        ("doc_c", SearchResult(content="无关内容", metadata={"source": "c.pdf"}, distance=0.95)),
        ("doc_d", SearchResult(content="配置 MCP 工具需要填写 command 和 args。", metadata={"source": "d.pdf"}, distance=0.1)),
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
    assert "无关内容" not in context


def test_rag_empty_context_prevents_fabrication():
    context = _format_rag_context([])

    assert "没有找到与用户问题相关的文件库内容" in context
    assert "不要编造" in context


@pytest.mark.asyncio
async def test_search_collections_only_returns_active_stored_names(monkeypatch):
    async def fake_search(name, query, embedding, top_k):
        return [
            SearchResult(content="active", metadata={"stored_name": "active.pdf"}, distance=0.1),
            SearchResult(content="deleted", metadata={"stored_name": "deleted.pdf"}, distance=0.1),
            SearchResult(content="legacy", metadata={"source": "legacy.pdf"}, distance=0.1),
        ]

    monkeypatch.setattr("src.services.rag.vector_store.search", fake_search)

    results = await _search_collections(
        {"user_1_file": {"active.pdf"}},
        "query",
        [0.1],
    )

    assert [result.content for _, result in results] == ["active"]


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
