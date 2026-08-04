"""知识节点的稳定向量文本与索引编排。"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from src.config import settings
from src.services.memory import graph_store
from src.services.rag import embedding_service

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MemoryNodeRef:
    kind: str
    user_id: int
    memory_id: str


@dataclass
class EmbeddingIndexReport:
    selected: int = 0
    embedded: int = 0
    skipped: int = 0
    failed: int = 0
    by_kind: dict[str, int] = field(default_factory=dict)

    def merge(self, other: "EmbeddingIndexReport") -> None:
        self.selected += other.selected
        self.embedded += other.embedded
        self.skipped += other.skipped
        self.failed += other.failed
        for kind, count in other.by_kind.items():
            self.by_kind[kind] = self.by_kind.get(kind, 0) + count


def _clean(value: Any) -> str:
    return str(value or "").strip()


def render_embedding_text(kind: str, row: Mapping[str, Any]) -> str:
    """将节点语义字段渲染为稳定、确定性的 embedding 文本。"""
    normalized = kind.strip().lower()
    if normalized == "chunk":
        return _clean(row.get("content"))
    if normalized == "entity":
        lines = [f"name: {_clean(row.get('name'))}"]
        entity_type = _clean(row.get("entity_type"))
        description = _clean(row.get("description"))
        aliases = sorted({_clean(alias) for alias in row.get("aliases", []) if _clean(alias)})
        if entity_type:
            lines.append(f"type: {entity_type}")
        if description:
            lines.append(f"description: {description}")
        if aliases:
            lines.append(f"aliases: {', '.join(aliases)}")
        return "\n".join(lines) if _clean(row.get("name")) else ""
    if normalized == "fact":
        subject = _clean(row.get("subject_name")) or _clean(row.get("subject_id"))
        predicate = _clean(row.get("predicate"))
        object_text = _clean(row.get("object_text"))
        if not subject or not predicate or not object_text:
            return ""
        return f"subject: {subject}\npredicate: {predicate}\nobject: {object_text}"
    if normalized == "episode":
        episode_kind = _clean(row.get("kind"))
        summary = _clean(row.get("summary"))
        if not summary:
            return ""
        return f"kind: {episode_kind}\nsummary: {summary}" if episode_kind else f"summary: {summary}"
    if normalized == "preference":
        key = _clean(row.get("key"))
        value = _clean(row.get("value"))
        if not key or not value:
            return ""
        return f"key: {key}\nvalue: {value}"
    raise ValueError(f"Unsupported memory vector kind: {kind}")


def _normalize_refs(refs: list[MemoryNodeRef]) -> list[MemoryNodeRef]:
    unique: dict[tuple[str, int, str], MemoryNodeRef] = {}
    for ref in refs:
        kind = ref.kind.strip().lower()
        graph_store._vector_spec(kind)
        key = (kind, ref.user_id, ref.memory_id)
        unique[key] = MemoryNodeRef(kind=kind, user_id=ref.user_id, memory_id=ref.memory_id)
    return list(unique.values())


async def _index_rows(
    kind: str,
    rows: list[dict],
    *,
    embedding_model: str,
) -> EmbeddingIndexReport:
    report = EmbeddingIndexReport(selected=len(rows))
    prepared = []
    for row in rows:
        text = render_embedding_text(kind, row)
        if not text:
            report.skipped += 1
            continue
        prepared.append({**row, "text": text})
    if not prepared:
        return report

    embeddings = await embedding_service.get_embeddings([row["text"] for row in prepared])
    if len(embeddings) != len(prepared):
        raise ValueError("Embedding response count does not match memory nodes")
    if not embeddings or not embeddings[0]:
        raise ValueError("Embedding response contains no vectors")
    vector_dim = len(embeddings[0])
    if any(len(embedding) != vector_dim for embedding in embeddings):
        raise ValueError("Embedding response contains inconsistent dimensions")

    payload = [
        {
            "user_id": row["user_id"],
            "memory_id": row["memory_id"],
            "text": row["text"],
            "embedding": embedding,
        }
        for row, embedding in zip(prepared, embeddings)
    ]
    report.embedded = await graph_store.upsert_node_embeddings(
        kind=kind,
        embedding_model=embedding_model,
        vector_dim=vector_dim,
        rows=payload,
    )
    report.by_kind[kind] = report.embedded
    return report


async def index_node_refs(
    refs: list[MemoryNodeRef],
    *,
    force: bool = False,
) -> EmbeddingIndexReport:
    """严格索引指定节点；失败向上传递给显式运维调用。"""
    normalized = _normalize_refs(refs)
    report = EmbeddingIndexReport()
    if not normalized:
        return report
    embedding_model = embedding_service.get_embedding_collection_suffix()
    grouped: dict[tuple[str, int], list[str]] = {}
    for ref in normalized:
        grouped.setdefault((ref.kind, ref.user_id), []).append(ref.memory_id)
    for (kind, user_id), ids in grouped.items():
        rows = await graph_store.fetch_nodes_for_embedding(
            kind=kind,
            embedding_model=embedding_model,
            user_id=user_id,
            ids=ids,
            limit=max(len(ids), 1),
            missing_only=not force,
        )
        report.merge(await _index_rows(kind, rows, embedding_model=embedding_model))
    return report


async def index_node_refs_best_effort(refs: list[MemoryNodeRef]) -> EmbeddingIndexReport:
    """在线写入后的降级索引；外部 embedding 失败不回滚结构化记忆。"""
    normalized = _normalize_refs(refs)
    try:
        return await index_node_refs(normalized)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception(
            "Failed to index memory nodes; reindex can repair them: refs=%s",
            [(ref.kind, ref.user_id, ref.memory_id) for ref in normalized],
        )
        return EmbeddingIndexReport(selected=len(normalized), failed=len(normalized))


async def reindex_all(
    *,
    user_id: int | None = None,
    kinds: list[str] | None = None,
    batch_size: int | None = None,
    force: bool = False,
) -> EmbeddingIndexReport:
    """按当前 embedding 模型补齐或重建全部节点向量。"""
    if user_id is not None and user_id <= 0:
        raise ValueError("user_id must be greater than zero")
    if batch_size is not None and batch_size <= 0:
        raise ValueError("batch_size must be greater than zero")
    selected_kinds = graph_store._normalize_kinds(kinds)
    embedding_model = embedding_service.get_embedding_collection_suffix()
    size = settings.embedding_batch_size if batch_size is None else batch_size
    report = EmbeddingIndexReport()
    for kind in selected_kinds:
        cursor: tuple[int, str] | None = None
        while True:
            rows = await graph_store.fetch_nodes_for_embedding(
                kind=kind,
                embedding_model=embedding_model,
                user_id=user_id,
                cursor=cursor,
                limit=size,
                missing_only=not force,
            )
            if not rows:
                break
            report.merge(await _index_rows(kind, rows, embedding_model=embedding_model))
            cursor = (int(rows[-1]["user_id"]), str(rows[-1]["memory_id"]))

        if force:
            continue
        # UUID id 并非单调序列；再从起点扫缺失项，覆盖主扫描期间新写入且字典序更小的节点。
        repair_rounds = 0
        while repair_rounds < 3:
            rows = await graph_store.fetch_nodes_for_embedding(
                kind=kind,
                embedding_model=embedding_model,
                user_id=user_id,
                limit=size,
                missing_only=True,
            )
            if not rows:
                break
            batch_report = await _index_rows(kind, rows, embedding_model=embedding_model)
            report.merge(batch_report)
            repair_rounds += 1
            if batch_report.embedded == 0:
                break
        remaining = await graph_store.fetch_nodes_for_embedding(
            kind=kind,
            embedding_model=embedding_model,
            user_id=user_id,
            limit=1,
            missing_only=True,
        )
        if remaining:
            raise RuntimeError(
                f"Memory reindex incomplete for kind={kind}; remaining nodes require retry"
            )
    return report
