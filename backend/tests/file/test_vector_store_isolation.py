"""vector_store 集合隔离测试。

conftest 把 src.services.rag.vector_store 的高层函数全部 mock 掉，
这里通过直接调用 chromadb 客户端来验证：不同集合之间的数据互不串扰，
delete_collection / delete_document_chunks 也只影响目标集合。

使用自定义的 ZeroEmbeddingFunction，避免 chroma 触发默认 sentence-transformers
模型下载（CI 环境可能没有网络）。
"""

from pathlib import Path
from typing import cast

import pytest
import chromadb
from chromadb.api.types import EmbeddingFunction, Embeddings

from src.services.rag.vector_store import SearchResult  # 仅作类型/字段断言


class _ZeroEmbeddingFunction(EmbeddingFunction):
    """始终返回零向量的 embedding 函数，仅用于隔离测试。

    不依赖任何外部模型，避免 CI 下载 sentence-transformers。
    """

    def __init__(self) -> None:
        pass

    def __call__(self, input):  # type: ignore[override]
        dim = 8
        return cast(Embeddings, [[0.0] * dim for _ in input])

    @staticmethod
    def name() -> str:
        return "zero"

    @staticmethod
    def build_from_config(config: dict) -> "_ZeroEmbeddingFunction":
        return _ZeroEmbeddingFunction()

    def get_config(self) -> dict:
        return {}


_zero_embedding_function = _ZeroEmbeddingFunction()


@pytest.fixture
def vector_client(tmp_path: Path):
    client = chromadb.PersistentClient(
        path=str(tmp_path / "chroma"),
        settings=chromadb.config.Settings(anonymized_telemetry=False),
    )
    yield client


def _seed(client: chromadb.PersistentClient, name: str, docs: list[str]):
    coll = client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
        embedding_function=_zero_embedding_function,
    )
    coll.upsert(
        documents=docs,
        ids=[f"{name}-{i}" for i in range(len(docs))],
        metadatas=[{"stored_name": f"{name}.md"} for _ in docs],
    )
    return coll


def test_two_collections_do_not_share_data(vector_client):
    _seed(vector_client, "user_a_kb", ["苹果是水果", "香蕉也是水果"])
    _seed(vector_client, "user_b_kb", ["Python 是一门编程语言", "TypeScript 也是"])

    a_coll = vector_client.get_collection(
        "user_a_kb", embedding_function=_zero_embedding_function
    )
    b_coll = vector_client.get_collection(
        "user_b_kb", embedding_function=_zero_embedding_function
    )

    # 计数互不影响
    assert a_coll.count() == 2
    assert b_coll.count() == 2

    # A 集合的全部文档只能是 A 的内容
    a_docs = a_coll.get(include=["documents"])["documents"]
    assert set(a_docs) == {"苹果是水果", "香蕉也是水果"}
    b_docs = b_coll.get(include=["documents"])["documents"]
    assert set(b_docs) == {"Python 是一门编程语言", "TypeScript 也是"}


def test_delete_collection_only_affects_target(vector_client):
    _seed(vector_client, "to_delete", ["待删除 1", "待删除 2"])
    _seed(vector_client, "to_keep", ["应保留 1"])

    vector_client.delete_collection(name="to_delete")

    with pytest.raises(Exception):
        vector_client.get_collection("to_delete")

    kept = vector_client.get_collection(
        "to_keep", embedding_function=_zero_embedding_function
    )
    assert kept.count() == 1


def test_delete_document_chunks_only_removes_matching_metadata(vector_client):
    coll = vector_client.get_or_create_collection(
        name="shared",
        metadata={"hnsw:space": "cosine"},
        embedding_function=_zero_embedding_function,
    )
    coll.upsert(
        documents=["doc-A", "doc-B", "doc-C"],
        ids=["a-1", "b-1", "c-1"],
        metadatas=[
            {"stored_name": "A.md"},
            {"stored_name": "B.md"},
            {"stored_name": "C.md"},
        ],
    )

    coll.delete(where={"stored_name": "B.md"})
    assert coll.count() == 2

    remaining = coll.get(include=["metadatas"])
    stored_names = {m["stored_name"] for m in remaining["metadatas"]}
    assert "A.md" in stored_names
    assert "C.md" in stored_names
    assert "B.md" not in stored_names


def test_search_result_dataclass_has_expected_fields():
    """锁定向调用方暴露的字段结构，避免上游结构变更导致 RAG 拼接失败。"""
    r = SearchResult(content="x", metadata={"source": "a"}, distance=0.1)
    assert r.content == "x"
    assert r.metadata == {"source": "a"}
    assert r.distance == 0.1

    r2 = SearchResult(content="y", metadata={})
    assert r2.distance is None
