from types import SimpleNamespace

import pytest

from src.core.context import current_user_id_cv
from src.tools import knowledge


@pytest.mark.asyncio
async def test_knowledge_graph_query_reads_entity_and_fact_graph(monkeypatch):
    token = current_user_id_cv.set(7)
    captured = {}

    async def fake_embeddings(values):
        assert values == ["Where is Project Aurora?"]
        return [[0.1, 0.2]]

    async def fake_recall(**kwargs):
        captured.update(kwargs)
        return [
            SimpleNamespace(
                kind="fact",
                score=0.12,
                content="Project Aurora is stored in the workspace.",
                metadata={"source_doc_id": "notes/aurora.md"},
            )
        ]

    monkeypatch.setattr("src.services.infra.embeddings.embedding_service.get_embeddings", fake_embeddings)
    monkeypatch.setattr("src.services.memory.graph_store.recall", fake_recall)
    try:
        result = await knowledge.knowledge_query_graph.ainvoke({"query": "Where is Project Aurora?"})
    finally:
        current_user_id_cv.reset(token)

    assert captured["user_id"] == 7
    assert captured["kinds"] == ["entity", "fact"]
    assert "[来源 1]" in result
    assert "来源：notes/aurora.md" in result


@pytest.mark.asyncio
async def test_knowledge_graph_query_requires_current_user():
    token = current_user_id_cv.set(None)
    try:
        result = await knowledge.knowledge_query_graph.ainvoke({"query": "anything"})
    finally:
        current_user_id_cv.reset(token)

    assert "未认证用户" in result
