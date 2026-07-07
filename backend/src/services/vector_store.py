"""Vector store service using ChromaDB."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

import chromadb
from chromadb.config import Settings as ChromaSettings
from chromadb.errors import NotFoundError

from src.config import settings

_client: chromadb.PersistentClient | None = None


def _get_client() -> chromadb.PersistentClient:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(
            path=settings.chroma_db_path,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
    return _client


@dataclass
class SearchResult:
    """A single search result from the vector store."""
    content: str
    metadata: dict
    distance: float | None = None


async def add_documents(
    collection_name: str,
    documents: list[str],
    metadata_list: list[dict] | None = None,
    embeddings: list[list[float]] | None = None,
) -> None:
    """Add documents to a collection.

    Args:
        collection_name: Name of the ChromaDB collection.
        documents: List of text documents to add.
        metadata_list: Optional list of metadata dicts (one per document).
        embeddings: Optional embedding vectors matching the documents.
    """
    if not documents:
        return

    client = _get_client()
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    if metadata_list is None:
        metadata_list = [{}] * len(documents)

    ids = [str(metadata.get("chunk_id") or f"{collection_name}_{uuid4().hex}_{i}") for i, metadata in enumerate(metadata_list)]
    upsert_kwargs = {"documents": documents, "metadatas": metadata_list, "ids": ids}
    if embeddings is not None:
        upsert_kwargs["embeddings"] = embeddings
    collection.upsert(**upsert_kwargs)


async def search(
    collection_name: str,
    query: str,
    query_embedding: list[float],
    top_k: int | None = None,
) -> list[SearchResult]:
    """Search for similar documents.

    Args:
        collection_name: Name of the ChromaDB collection.
        query: Original query text (for reference).
        query_embedding: Embedding vector of the query.
        top_k: Number of results to return. Defaults to settings.rag_top_k.

    Returns:
        List of SearchResult objects.
    """
    if top_k is None:
        top_k = settings.rag_top_k

    client = _get_client()
    try:
        collection = client.get_collection(name=collection_name)
    except (ValueError, NotFoundError):
        return []

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    results_list: list[SearchResult] = []
    for i in range(len(results["ids"][0])):
        results_list.append(SearchResult(
            content=results["documents"][0][i],
            metadata=results["metadatas"][0][i] if results["metadatas"] else {},
            distance=results["distances"][0][i] if results["distances"] else None,
        ))

    return results_list


async def delete_document_chunks(collection_name: str, stored_name: str) -> bool:
    """Delete chunks for one stored document from a collection."""
    client = _get_client()
    try:
        collection = client.get_collection(name=collection_name)
    except (ValueError, NotFoundError):
        return False

    collection.delete(where={"stored_name": stored_name})
    return True


async def delete_collection(collection_name: str) -> bool:
    """Delete an entire collection.

    Args:
        collection_name: Name of the collection to delete.

    Returns:
        True if deleted, False if collection didn't exist.
    """
    client = _get_client()
    try:
        client.delete_collection(name=collection_name)
        return True
    except (ValueError, NotFoundError):
        return False


async def list_collections() -> list[str]:
    """List all collection names.

    Returns:
        List of collection names.
    """
    client = _get_client()
    return [c.name for c in client.list_collections()]


async def get_collection_count(collection_name: str) -> int:
    """Get the number of documents in a collection.

    Args:
        collection_name: Name of the collection.

    Returns:
        Document count, or 0 if collection doesn't exist.
    """
    client = _get_client()
    try:
        collection = client.get_collection(name=collection_name)
        return collection.count()
    except (ValueError, NotFoundError):
        return 0
