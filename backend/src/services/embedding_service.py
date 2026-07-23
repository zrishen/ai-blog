"""Embedding service: OpenAI 兼容远程 API 或本地 sentence-transformers 进程内模型。"""

import asyncio
import logging
import re

from openai import AsyncOpenAI

from src.config import settings

logger = logging.getLogger(__name__)

_openai_client: AsyncOpenAI | None = None
_local_model = None


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:48] or "default"


def _effective_embedding_model() -> str:
    """当前 provider 实际使用的 embedding 模型名（影响 collection 命名与向量空间）。"""
    if settings.embedding_provider == "local":
        return settings.embedding_local_model
    return settings.embedding_model


def get_embedding_collection_suffix() -> str:
    return f"_{_slug(_effective_embedding_model())}"


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


def _get_local_model():
    """懒加载本地 sentence-transformers 模型（首次调用时加载，常驻进程内存）。"""
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer

        logger.info(
            "Initializing local embedding model: model=%s device=%s",
            settings.embedding_local_model,
            settings.embedding_local_device,
        )
        _local_model = SentenceTransformer(
            settings.embedding_local_model,
            device=settings.embedding_local_device,
        )
    return _local_model


async def _embed_local(texts: list[str], progress_callback=None) -> list[list[float]]:
    """本地模型批量编码；同步 encode 套到线程池，避免阻塞 asyncio 事件循环。"""
    model = _get_local_model()
    batch_size = max(1, settings.embedding_batch_size)
    loop = asyncio.get_running_loop()
    embeddings: list[list[float]] = []
    logger.info(
        "Local embedding batch started: model=%s texts=%s",
        settings.embedding_local_model,
        len(texts),
    )
    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        batch_embeddings = await loop.run_in_executor(
            None,
            lambda b=batch: model.encode(b, normalize_embeddings=True).tolist(),
        )
        embeddings.extend(batch_embeddings)
        if progress_callback:
            result = progress_callback(len(embeddings), len(texts), "chunk")
            if result is not None:
                await result
    logger.info(
        "Local embedding batch completed: model=%s embeddings=%s",
        settings.embedding_local_model,
        len(embeddings),
    )
    return embeddings


async def get_embeddings(texts: list[str], progress_callback=None) -> list[list[float]]:
    if not texts:
        return []

    if settings.embedding_provider == "local":
        return await _embed_local(texts, progress_callback)

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
