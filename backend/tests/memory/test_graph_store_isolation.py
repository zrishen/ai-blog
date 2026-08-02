import pytest
from redis.exceptions import ResponseError

from src.services.memory import graph_store
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


class _ExistingVectorIndexGraph:
    def __init__(self):
        self.create_calls = 0

    def query(self, cypher, params):
        assert "CALL db.indexes()" in cypher
        return _Result([["Chunk", ["embedding_baai_bge_m3"], {"embedding_baai_bge_m3": ["VECTOR"]}, "NODE"]])

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
        return _Result([["Chunk", ["embedding_baai_bge_m3"], {"embedding_baai_bge_m3": ["VECTOR"]}, "NODE"]])

    def create_node_vector_index(self, *args, **kwargs):
        self.create_calls += 1
        raise ResponseError("Attribute 'embedding_baai_bge_m3' is already indexed")


@pytest.mark.asyncio
async def test_ensure_vector_index_skips_existing_vector_index(monkeypatch):
    graph = _ExistingVectorIndexGraph()
    monkeypatch.setattr(graph_store, "_graph", lambda: graph)

    await graph_store.ensure_vector_index("baai_bge_m3", 1024)

    assert graph.create_calls == 0


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
    assert graph.params["uid"] == 7
    assert graph.params["wl"] == ["active.pdf"]
    assert graph.index == ("Chunk", "embedding_test_model", 2, "cosine")
    assert hits[0].content == "matching chunk"
    assert hits[0].metadata == {"stored_name": "active.pdf", "source": "active.pdf"}
