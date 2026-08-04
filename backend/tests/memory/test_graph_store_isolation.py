import pytest
from redis.exceptions import ResponseError

from src.services.memory import graph_store
from src.services.memory.graph_store import recall as recall_impl
from src.services.memory.graph_store import search_documents as search_documents_impl


class _Result:
    def __init__(self, rows):
        self.result_set = rows


class _Graph:
    def __init__(self):
        self.cypher = ""
        self.params = {}

    def query(self, cypher, params):
        self.cypher = cypher
        self.params = params
        return _Result([["matching chunk", "active.pdf", "active.pdf", 0.91]])

    def create_node_vector_index(self, label, property_name, *, dim, similarity_function):
        self.index = (label, property_name, dim, similarity_function)


class _RecallGraph:
    def __init__(self):
        self.cypher = ""
        self.params = {}

    def query(self, cypher, params):
        self.cypher = cypher
        self.params = params
        return _Result([["remembered content", "memory.pdf", 0.93, ["Project Cortex"], "memory.pdf:0"]])


class _ExistingVectorIndexGraph:
    def __init__(self):
        self.create_calls = 0

    def query(self, cypher, params):
        assert "CALL db.indexes()" in cypher
        return _Result([[
            "Chunk",
            ["embedding_baai_bge_m3"],
            {"embedding_baai_bge_m3": ["VECTOR"]},
            {"embedding_baai_bge_m3": {"dimension": 1024, "similarityFunction": "cosine"}},
            "NODE",
            "OPERATIONAL",
        ]])

    def create_node_vector_index(self, *args, **kwargs):
        self.create_calls += 1


class _RacingVectorIndexGraph:
    def __init__(self):
        self.index_checks = 0
        self.create_calls = 0

    def query(self, cypher, params):
        assert "CALL db.indexes()" in cypher
        self.index_checks += 1
        if self.index_checks == 1:
            return _Result([])
        return _Result([[
            "Chunk",
            ["embedding_baai_bge_m3"],
            {"embedding_baai_bge_m3": ["VECTOR"]},
            {"embedding_baai_bge_m3": {"dimension": 1024, "similarityFunction": "cosine"}},
            "NODE",
            "OPERATIONAL",
        ]])

    def create_node_vector_index(self, *args, **kwargs):
        self.create_calls += 1
        raise ResponseError("Attribute 'embedding_baai_bge_m3' is already indexed")


async def _empty_read(cypher, params=None):
    """recall 演化标注的 SUPERSEDES 查询在 mock 隔离测试里无意义，返回空。"""
    return _Result([])


@pytest.mark.asyncio
async def test_ensure_vector_index_skips_existing_vector_index(monkeypatch):
    graph = _ExistingVectorIndexGraph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    await graph_store.ensure_vector_index("baai_bge_m3", 1024)

    assert graph.create_calls == 0


@pytest.mark.asyncio
async def test_ensure_vector_index_uses_kind_specific_label(monkeypatch):
    graph = _Graph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    await graph_store.ensure_vector_index("test_model", 2, kind="entity")

    assert graph.index == ("Entity", "embedding_test_model", 2, "cosine")


@pytest.mark.asyncio
async def test_list_vector_indexed_kinds_matches_label_and_slug(monkeypatch):
    class Graph:
        def query(self, cypher, params=None):
            return _Result([
                [
                    "Chunk", ["embedding_test_model"], {"embedding_test_model": ["VECTOR"]},
                    {"embedding_test_model": {"dimension": 2, "similarityFunction": "cosine"}},
                    "NODE", "OPERATIONAL",
                ],
                [
                    "Fact", ["embedding_test_model"], {"embedding_test_model": ["VECTOR"]},
                    {"embedding_test_model": {"dimension": 2, "similarityFunction": "cosine"}},
                    "NODE", "OPERATIONAL",
                ],
                [
                    "Episode", ["embedding_old_model"], {"embedding_old_model": ["VECTOR"]},
                    {"embedding_old_model": {"dimension": 2, "similarityFunction": "cosine"}},
                    "NODE", "OPERATIONAL",
                ],
            ])

    monkeypatch.setattr(graph_store, "_graph", lambda: Graph())

    assert await graph_store.list_vector_indexed_kinds("_test_model") == {"chunk", "fact"}


@pytest.mark.asyncio
async def test_vector_index_validation_rejects_wrong_property_type_and_dimension():
    mixed_row = (
        "Fact",
        ["embedding_test_model", "other"],
        {"embedding_test_model": ["RANGE"], "other": ["VECTOR"]},
        {"other": {"dimension": 2, "similarityFunction": "cosine"}},
        "NODE",
        "OPERATIONAL",
    )
    assert graph_store._vector_index_details(
        mixed_row, label="Fact", prop="embedding_test_model"
    ) is None

    wrong_dim = (
        "Fact",
        ["embedding_test_model"],
        {"embedding_test_model": ["VECTOR"]},
        {"embedding_test_model": {"dimension": 384, "similarityFunction": "cosine"}},
        "NODE",
        "OPERATIONAL",
    )
    with pytest.raises(RuntimeError, match="dimension mismatch"):
        graph_store._validate_vector_index(
            wrong_dim, label="Fact", prop="embedding_test_model", dim=1024
        )


@pytest.mark.asyncio
async def test_list_vector_indexed_kinds_skips_under_construction(monkeypatch):
    class Graph:
        def query(self, cypher, params=None):
            return _Result([[
                "Fact",
                ["embedding_test_model"],
                {"embedding_test_model": ["VECTOR"]},
                {"embedding_test_model": {"dimension": 2, "similarityFunction": "cosine"}},
                "NODE",
                "[Indexing] 1/2: UNDER CONSTRUCTION",
            ]])

    monkeypatch.setattr(graph_store, "_graph", lambda: Graph())
    assert await graph_store.list_vector_indexed_kinds("_test_model") == set()


@pytest.mark.asyncio
async def test_ensure_vector_index_accepts_duplicate_created_by_another_worker(monkeypatch):
    graph = _RacingVectorIndexGraph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    await graph_store.ensure_vector_index("baai_bge_m3", 1024)

    assert graph.create_calls == 1
    assert graph.index_checks == 2


@pytest.mark.asyncio
async def test_document_search_scopes_user_collection_and_whitelist(monkeypatch):
    graph = _Graph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    await graph_store.ensure_vector_index("test_model", 2)
    hits = await search_documents_impl(
        user_id=7,
        collection_name="user_7_kb",
        query_embedding=[0.1, 0.2],
        embedding_model="test_model",
        top_k=3,
        whitelist_stored_names={"active.pdf"},
    )

    assert "node.user_id=$uid" in graph.cypher
    assert "node.stored_name IN $wl" in graph.cypher
    assert "node.collection_name=$collection" in graph.cypher
    assert graph.params["uid"] == 7
    assert graph.params["collection"] == "user_7_kb"
    assert graph.params["wl"] == ["active.pdf"]
    assert graph.index == ("Chunk", "embedding_test_model", 2, "cosine")
    assert hits[0].content == "matching chunk"
    assert hits[0].metadata == {"stored_name": "active.pdf", "source": "active.pdf"}


@pytest.mark.asyncio
async def test_recall_normalizes_slug_and_scopes_chunk_and_entities_by_user(monkeypatch):
    graph = _RecallGraph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    async def indexed_kinds(_embedding_model):
        return {"chunk"}

    monkeypatch.setattr(graph_store, "list_vector_indexed_kinds", indexed_kinds)

    hits = await recall_impl(
        user_id=7,
        query_embedding=[0.1, 0.2],
        embedding_model="_test_model",
        top_k=3,
        whitelist_stored_names={"memory.pdf"},
        hops=0,
    )

    assert "'embedding_test_model'" in graph.cypher
    assert "vecf32($vec)" in graph.cypher
    assert "embedding__test_model" not in graph.cypher
    assert "node.user_id=$uid" in graph.cypher
    assert "node.stored_name IN $wl" in graph.cypher
    assert "(e:Entity {user_id:$uid})" in graph.cypher
    assert "ORDER BY score ASC" in graph.cypher
    assert graph.params["uid"] == 7
    assert graph.params["wl"] == ["memory.pdf"]
    assert hits[0].content == "remembered content\n关联实体: Project Cortex"
    assert hits[0].metadata["id"] == "memory.pdf:0"
    assert hits[0].metadata["source"] == "memory.pdf"
    assert hits[0].metadata["entities"] == ["Project Cortex"]
    assert 0 <= hits[0].metadata["rank_score"] <= 1


@pytest.mark.asyncio
async def test_recall_kinds_and_only_valid_control_queries(monkeypatch):
    class Graph:
        def __init__(self):
            self.calls = []

        def query(self, cypher, params):
            self.calls.append((cypher, params))
            if "queryNodes('Fact'" in cypher:
                return _Result([[
                    "subject: Cortex\npredicate: uses\nobject: FalkorDB",
                    0.98,
                    "fact-1",
                    "entity-1",
                    "uses",
                    "2026-08-01T00:00:00",
                    None,
                    0.9,
                    "document-1",
                ]])
            return _Result([[
                "kind: chat\nsummary: discussed FalkorDB",
                0.91,
                "episode-1",
                "chat",
                "2026-08-02T00:00:00",
                3,
                4,
            ]])

    graph = Graph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    async def indexed_kinds(_embedding_model):
        return {"fact", "episode"}

    monkeypatch.setattr(graph_store, "list_vector_indexed_kinds", indexed_kinds)
    monkeypatch.setattr(graph_store, "_read", _empty_read)

    hits = await recall_impl(
        user_id=7,
        query_embedding=[0.1, 0.2],
        embedding_model="_test_model",
        top_k=3,
        kinds=["episode", "fact", "fact"],
        only_valid=True,
        hops=0,
    )

    assert [hit.kind for hit in hits] == ["episode", "fact"]
    assert any("node.valid_to IS NULL" in cypher for cypher, _ in graph.calls)
    assert all("node.user_id=$uid" in cypher for cypher, _ in graph.calls)
    assert all("ORDER BY score ASC" in cypher for cypher, _ in graph.calls)
    assert next(hit for hit in hits if hit.kind == "fact").metadata["valid_to"] is None


@pytest.mark.asyncio
async def test_recall_expands_user_scoped_graph_and_reranks(monkeypatch):
    class Graph:
        def __init__(self):
            self.calls = []

        def query(self, cypher, params):
            self.calls.append((cypher, params))
            if "queryNodes('Entity'" in cypher:
                return _Result([[
                    "name: Cortex", 0.2, "entity-1", "Cortex", "concept", 0.8,
                ]])
            if "MATCH (seed:Entity" in cypher:
                return _Result([[
                    ["Fact"],
                    {
                        "fact_id": "fact-1",
                        "user_id": 7,
                        "subject_id": "entity-1",
                        "predicate": "uses",
                        "object_text": "FalkorDB",
                        "confidence": 0.95,
                        "valid_from": "2026-08-03T00:00:00",
                        "valid_to": None,
                    },
                    "SUBJECT",
                    False,
                ]])
            return _Result([])

    graph = Graph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    async def indexed_kinds(_embedding_model):
        return {"entity"}

    monkeypatch.setattr(graph_store, "list_vector_indexed_kinds", indexed_kinds)
    monkeypatch.setattr(graph_store, "_read", _empty_read)

    hits = await recall_impl(
        user_id=7,
        query_embedding=[0.1, 0.2],
        embedding_model="_test_model",
        top_k=4,
        kinds=["entity"],
        hops=1,
    )

    assert {hit.kind for hit in hits} == {"entity", "fact"}
    fact = next(hit for hit in hits if hit.kind == "fact")
    assert fact.metadata["graph_distance"] == 1
    assert fact.metadata["path"][0]["relation"] == "SUBJECT"
    expansion_query, params = next(
        call for call in graph.calls if "MATCH (seed:Entity" in call[0]
    )
    assert "seed:Entity {user_id:$uid" in expansion_query
    assert "node.user_id=$uid" in expansion_query
    assert params["uid"] == 7


@pytest.mark.asyncio
async def test_recall_empty_kinds_returns_without_graph_access(monkeypatch):
    async def fail(_embedding_model):
        raise AssertionError("index discovery should not run")

    monkeypatch.setattr(graph_store, "list_vector_indexed_kinds", fail)

    assert await recall_impl(
        user_id=7,
        query_embedding=[0.1, 0.2],
        embedding_model="_test_model",
        kinds=[],
    ) == []


@pytest.mark.asyncio
async def test_recall_rejects_unknown_kind():
    with pytest.raises(ValueError, match="Unsupported memory vector kind"):
        await recall_impl(
            user_id=7,
            query_embedding=[0.1, 0.2],
            embedding_model="_test_model",
            kinds=["unknown"],
        )


def test_rerank_score_gives_expanded_nodes_semantic_proxy():
    """图扩展节点（score=None, graph_distance>0）用图距离作 semantic 代理，
    不再恒 0，使其能在 Top-K 与直接命中竞争；近的代理更强。"""
    from datetime import datetime
    now = datetime(2026, 8, 4)
    MemoryHit = graph_store.MemoryHit

    depth1 = MemoryHit(
        content="x", kind="fact", score=None,
        metadata={"id": "f1", "graph_distance": 1, "confidence": 0.9},
    )
    depth2 = MemoryHit(
        content="x", kind="fact", score=None,
        metadata={"id": "f2", "graph_distance": 2, "confidence": 0.9},
    )
    score1 = graph_store._rerank_score(depth1, now=now)
    score2 = graph_store._rerank_score(depth2, now=now)
    assert score1 > score2  # 近的扩展节点语义代理更强
    assert score1 > 0.3  # 不再恒 0：有竞争力（直接命中低相似度 ~0.5-0.6）
