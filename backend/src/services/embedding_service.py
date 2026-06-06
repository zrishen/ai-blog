"""Embedding service with selectable local ONNX or OpenAI-compatible providers."""

import asyncio
import logging
import re
from typing import Any, Literal

import numpy as np
from openai import AsyncOpenAI

from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

from src.config import settings

logger = logging.getLogger(__name__)

ProviderName = Literal["onnx", "openai"]

_onnx_embedding_function = None
_openai_client: AsyncOpenAI | None = None


def _get_provider() -> ProviderName:
    provider = settings.embedding_provider.strip().lower()
    if provider in {"local", "onnx", "minilm"}:
        return "onnx"
    if provider in {"openai", "openai-compatible", "qwen", "qwen3"}:
        return "openai"
    raise ValueError("Unsupported EMBEDDING_PROVIDER. Use 'onnx' or 'openai'.")


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:48] or "default"


def get_embedding_collection_suffix() -> str:
    provider = _get_provider()
    if provider == "onnx":
        return ""
    return f"_{provider}_{_slug(settings.embedding_model)}"


def _get_onnx_embedding_function():
    global _onnx_embedding_function
    if _onnx_embedding_function is None:
        logger.info("Initializing ONNX MiniLM embedding function")
        try:
            _onnx_embedding_function = ONNXMiniLM_L6_V2()
        except Exception:
            logger.exception("Failed to initialize ONNX MiniLM embedding function")
            raise
        logger.info("ONNX MiniLM embedding function initialized")
    return _onnx_embedding_function


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = settings.embedding_api_key or settings.openai_api_key
        if not api_key:
            raise ValueError("EMBEDDING_API_KEY or OPENAI_API_KEY is required for external embeddings")
        logger.info(
            "Initializing OpenAI-compatible embedding client: model=%s base_url=%s",
            settings.embedding_model,
            settings.embedding_base_url,
        )
        _openai_client = AsyncOpenAI(api_key=api_key, base_url=settings.embedding_base_url)
    return _openai_client


def _convert_embedding(emb: Any) -> list[float]:
    if isinstance(emb, list) and len(emb) > 0:
        inner = emb[0]
    else:
        inner = emb
    if isinstance(inner, np.ndarray):
        return [float(v) for v in inner.ravel()]
    return [float(x) for x in inner]


async def _get_onnx_embeddings(texts: list[str]) -> list[list[float]]:
    ef = _get_onnx_embedding_function()

    def _embed_batch(text_list: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for index, text in enumerate(text_list):
            try:
                emb = ef.embed_query(text)
                results.append(_convert_embedding(emb))
            except Exception:
                logger.exception("Failed to embed chunk with ONNX: index=%s text_length=%s", index, len(text))
                raise
        return results

    return await asyncio.get_event_loop().run_in_executor(None, _embed_batch, texts)


async def _get_openai_embeddings(texts: list[str]) -> list[list[float]]:
    client = _get_openai_client()
    batch_size = max(1, min(settings.embedding_batch_size, 32))
    embeddings: list[list[float]] = []

    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        batch_number = start // batch_size + 1
        total_batches = (len(texts) + batch_size - 1) // batch_size
        try:
            logger.info(
                "Embedding provider request started: model=%s batch=%s/%s batch_size=%s",
                settings.embedding_model,
                batch_number,
                total_batches,
                len(batch),
            )
            response = await client.embeddings.create(model=settings.embedding_model, input=batch)
        except Exception:
            logger.exception(
                "Failed to embed batch with OpenAI-compatible provider: model=%s batch=%s/%s batch_size=%s",
                settings.embedding_model,
                batch_number,
                total_batches,
                len(batch),
            )
            raise

        ordered = sorted(response.data, key=lambda item: item.index)
        embeddings.extend([[float(value) for value in item.embedding] for item in ordered])
        logger.info(
            "Embedding provider request completed: model=%s batch=%s/%s embeddings=%s",
            settings.embedding_model,
            batch_number,
            total_batches,
            len(ordered),
        )

    return embeddings


async def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Get embeddings using the configured provider."""
    if not texts:
        return []

    provider = _get_provider()
    logger.info("Embedding batch started: provider=%s model=%s texts=%s", provider, settings.embedding_model, len(texts))
    if provider == "onnx":
        embeddings = await _get_onnx_embeddings(texts)
    else:
        embeddings = await _get_openai_embeddings(texts)
    logger.info("Embedding batch completed: provider=%s model=%s embeddings=%s", provider, settings.embedding_model, len(embeddings))
    return embeddings
