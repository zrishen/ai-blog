"""Embedding service using local ONNX MiniLM model."""

import asyncio
from typing import Any

import numpy as np

from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

_embedding_function = None


def _get_embedding_function():
    global _embedding_function
    if _embedding_function is None:
        _embedding_function = ONNXMiniLM_L6_V2()
    return _embedding_function


def _convert_embedding(emb: Any) -> list[float]:
    """Convert an embedding to plain list[float].

    ONNXMiniLM_L6_V2.embed_query returns a list like [numpy_array_384d].
    We take the first (and only) element and convert it.
    """
    # emb is [numpy_array] for a single query
    if isinstance(emb, list) and len(emb) > 0:
        inner = emb[0]
    else:
        inner = emb
    if isinstance(inner, np.ndarray):
        return [float(v) for v in inner.ravel()]
    return [float(x) for x in inner]


async def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Get embeddings for a list of texts using local ONNX MiniLM model.

    Args:
        texts: List of text strings to embed.

    Returns:
        List of embedding vectors (each a list of floats).
    """
    if not texts:
        return []

    ef = _get_embedding_function()

    def _embed_batch(text_list: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for t in text_list:
            emb = ef.embed_query(t)
            results.append(_convert_embedding(emb))
        return results

    return await asyncio.get_event_loop().run_in_executor(None, _embed_batch, texts)
