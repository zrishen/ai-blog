from types import SimpleNamespace

import pytest

from src.services.memory import graph_store
from src.services.memory.graph_store import MemoryHit


@pytest.mark.asyncio
async def test_base_recall_memory_touches_hits_after_recall(monkeypatch):
    """base_recall_memory 在 recall 有命中后调 touch_memories，驱动衰减闭环。"""
    from src.services.embeddings import embedding_service
    from src.tools import memory as memory_tool

    touched: list = []

    async def fake_recall(**kwargs):
        return [MemoryHit(content="x", kind="fact", score=0.1, metadata={"id": "f1"})]

    async def fake_touch(*, user_id, hits):
        touched.append((user_id, len(hits)))

    async def fake_embeddings(texts):
        return [[0.1, 0.2]]

    monkeypatch.setattr("src.core.context.current_user_id_cv", SimpleNamespace(get=lambda: 7))
    monkeypatch.setattr(embedding_service, "get_embeddings", fake_embeddings)
    monkeypatch.setattr(embedding_service, "get_embedding_collection_suffix", lambda: "_test")
    monkeypatch.setattr(graph_store, "recall", fake_recall)
    monkeypatch.setattr(graph_store, "touch_memories", fake_touch)

    await memory_tool.base_recall_memory.ainvoke("query")
    assert touched == [(7, 1)]


@pytest.mark.asyncio
async def test_base_recall_memory_skips_touch_when_no_hits(monkeypatch):
    """recall 无命中时不调 touch_memories。"""
    from src.services.embeddings import embedding_service
    from src.tools import memory as memory_tool

    touched: list = []

    async def fake_recall(**kwargs):
        return []

    async def fake_touch(*, user_id, hits):
        touched.append(hits)

    async def fake_embeddings(texts):
        return [[0.1]]

    monkeypatch.setattr("src.core.context.current_user_id_cv", SimpleNamespace(get=lambda: 7))
    monkeypatch.setattr(embedding_service, "get_embeddings", fake_embeddings)
    monkeypatch.setattr(embedding_service, "get_embedding_collection_suffix", lambda: "_test")
    monkeypatch.setattr(graph_store, "recall", fake_recall)
    monkeypatch.setattr(graph_store, "touch_memories", fake_touch)

    result = await memory_tool.base_recall_memory.ainvoke("query")
    assert touched == []
    assert "没有找到" in result or "[大脑记忆结果]" in result


@pytest.mark.asyncio
async def test_base_recall_memory_tolerates_touch_failure(monkeypatch):
    """touch 失败不影响 recall 结果返回（衰减降级，对话不受影响）。"""
    from src.services.embeddings import embedding_service
    from src.tools import memory as memory_tool

    async def fake_recall(**kwargs):
        return [MemoryHit(content="hit", kind="fact", score=0.1, metadata={"id": "f1"})]

    async def boom_touch(*, user_id, hits):
        raise RuntimeError("falkordb down")

    async def fake_embeddings(texts):
        return [[0.1]]

    monkeypatch.setattr("src.core.context.current_user_id_cv", SimpleNamespace(get=lambda: 7))
    monkeypatch.setattr(embedding_service, "get_embeddings", fake_embeddings)
    monkeypatch.setattr(embedding_service, "get_embedding_collection_suffix", lambda: "_test")
    monkeypatch.setattr(graph_store, "recall", fake_recall)
    monkeypatch.setattr(graph_store, "touch_memories", boom_touch)

    result = await memory_tool.base_recall_memory.ainvoke("query")
    assert "回忆到的大脑记忆" in result


@pytest.mark.asyncio
async def test_base_recall_memory_rejects_unauthenticated(monkeypatch):
    """未认证用户（无 user_id）直接返回提示，不触发 recall/touch。"""
    from src.tools import memory as memory_tool

    recalled: list = []

    async def fake_recall(**kwargs):
        recalled.append(kwargs)
        return []

    monkeypatch.setattr("src.core.context.current_user_id_cv", SimpleNamespace(get=lambda: None))
    monkeypatch.setattr(graph_store, "recall", fake_recall)

    result = await memory_tool.base_recall_memory.ainvoke("query")
    assert "未认证" in result
    assert recalled == []


@pytest.mark.asyncio
async def test_base_recall_memory_handles_embedding_failure(monkeypatch):
    """查询嵌入失败时返回提示，不触发 recall/touch。"""
    from src.services.embeddings import embedding_service
    from src.tools import memory as memory_tool

    recalled: list = []

    async def fake_recall(**kwargs):
        recalled.append(kwargs)
        return []

    async def boom_embeddings(texts):
        raise RuntimeError("embedding service down")

    monkeypatch.setattr("src.core.context.current_user_id_cv", SimpleNamespace(get=lambda: 7))
    monkeypatch.setattr(embedding_service, "get_embeddings", boom_embeddings)
    monkeypatch.setattr(embedding_service, "get_embedding_collection_suffix", lambda: "_test")
    monkeypatch.setattr(graph_store, "recall", fake_recall)

    result = await memory_tool.base_recall_memory.ainvoke("query")
    assert "无法生成查询嵌入" in result
    assert recalled == []


def test_format_memory_context_renders_fact_evolution():
    """_format_memory_context：fact 带 replaced 时渲染'演化（取代旧值）'，
    非 fact 或无 replaced 的 fact 不渲染该行。"""
    from src.tools.memory import _format_memory_context

    evolved = MemoryHit(
        content="张三在谷歌工作",
        kind="fact",
        score=0.1,
        metadata={"id": "f2", "replaced": ["苹果"]},
    )
    plain = MemoryHit(
        content="用户偏好简短回答",
        kind="preference",
        score=0.2,
        metadata={"id": "p1"},
    )
    no_replace = MemoryHit(
        content="某独立事实",
        kind="fact",
        score=0.3,
        metadata={"id": "f3"},
    )

    out = _format_memory_context([evolved, plain, no_replace])
    assert "演化（取代旧值）：苹果" in out
    # 只有 evolved 命中 replaced，演化行全局仅出现一次
    assert out.count("演化（取代旧值）") == 1
