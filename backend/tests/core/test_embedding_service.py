import numpy as np
import pytest


@pytest.mark.asyncio
async def test_local_embedding_uses_sentence_transformers(monkeypatch):
    """local provider 的 _embed_local 用 sentence-transformers 进程内模型批量编码。

    直接测 _embed_local：conftest autouse mock 接管了 get_embeddings 入口（见 conftest）。
    """
    from src.services.embeddings import embedding_service
    from src.config import settings
    import sentence_transformers

    encoded_batches: list[list[str]] = []

    class FakeModel:
        def __init__(self, name, device=None):
            self.name = name
            self.device = device

        def encode(self, batch, normalize_embeddings=False):
            encoded_batches.append(list(batch))
            return np.array([[float(len(t))] for t in batch])

    monkeypatch.setattr(settings, "embedding_local_model", "fake-model")
    monkeypatch.setattr(settings, "embedding_local_device", "cpu")
    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", FakeModel)
    embedding_service._local_model = None

    result = await embedding_service._embed_local(["abc", "abcd", "xy"])

    assert result == [[3.0], [4.0], [2.0]]
    assert encoded_batches == [["abc", "abcd", "xy"]]


def test_collection_suffix_follows_provider(monkeypatch):
    """provider=local 时 collection suffix 用本地模型名（换 provider 即换 collection/向量空间）。"""
    from src.services.embeddings import embedding_service
    from src.config import settings

    monkeypatch.setattr(settings, "embedding_provider", "local")
    monkeypatch.setattr(settings, "embedding_local_model", "Qwen/Qwen3-Embedding-0.6B")
    assert embedding_service.get_embedding_collection_suffix() == "_qwen_qwen3_embedding_0_6b"

    monkeypatch.setattr(settings, "embedding_provider", "api")
    monkeypatch.setattr(settings, "embedding_model", "Qwen3-Embedding-8B")
    assert embedding_service.get_embedding_collection_suffix() == "_qwen3_embedding_8b"
