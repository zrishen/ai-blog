"""Embedding service using Qwen3-Embedding-8B via an OpenAI-compatible API."""

import logging
import re

from openai import AsyncOpenAI

from src.config import settings

logger = logging.getLogger(__name__)

_openai_client: AsyncOpenAI | None = None


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:48] or "default"


def get_embedding_collection_suffix() -> str:
    return f"_{_slug(settings.embedding_model)}"


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = settings.embedding_api_key or settings.openai_api_key
        if not api_key:
            raise ValueError("EMBEDDING_API_KEY or OPENAI_API_KEY is required for embeddings")
        logger.info(
            "Initializing embedding client: model=%s base_url=%s",
            settings.embedding_model,
            settings.embedding_base_url,
        )
        _openai_client = AsyncOpenAI(api_key=api_key, base_url=settings.embedding_base_url)
    return _openai_client


async def get_embeddings(texts: list[str], progress_callback=None) -> list[list[float]]:
    if not texts:
        return []

    client = _get_openai_client()
    batch_size = max(1, min(settings.embedding_batch_size, 32))
    embeddings: list[list[float]] = []

    logger.info("Embedding batch started: model=%s texts=%s", settings.embedding_model, len(texts))
    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        batch_number = start // batch_size + 1
        total_batches = (len(texts) + batch_size - 1) // batch_size
        try:
            logger.info(
                "Embedding request started: model=%s batch=%s/%s batch_size=%s",
                settings.embedding_model,
                batch_number,
                total_batches,
                len(batch),
            )
            response = await client.embeddings.create(model=settings.embedding_model, input=batch)
        except Exception:
            logger.exception(
                "Failed to embed batch: model=%s batch=%s/%s batch_size=%s",
                settings.embedding_model,
                batch_number,
                total_batches,
                len(batch),
            )
            raise

        indexes = [item.index for item in response.data]
        expected_indexes = list(range(len(batch)))
        if len(indexes) != len(batch) or len(set(indexes)) != len(indexes) or sorted(indexes) != expected_indexes:
            raise ValueError(
                f"Invalid embedding response indexes: expected={expected_indexes} actual={indexes}"
            )
        ordered = sorted(response.data, key=lambda item: item.index)
        batch_embeddings = [[float(value) for value in item.embedding] for item in ordered]
        if any(not embedding for embedding in batch_embeddings):
            raise ValueError("Embedding response contains an empty vector")
        embeddings.extend(batch_embeddings)
        if progress_callback:
            result = progress_callback(len(embeddings), len(texts), "chunk")
            if result is not None:
                await result
        logger.info(
            "Embedding request completed: model=%s batch=%s/%s embeddings=%s",
            settings.embedding_model,
            batch_number,
            total_batches,
            len(ordered),
        )

    logger.info("Embedding batch completed: model=%s embeddings=%s", settings.embedding_model, len(embeddings))
    return embeddings
