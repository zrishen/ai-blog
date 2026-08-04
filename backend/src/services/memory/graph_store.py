"""FalkorDB 大脑 graph_store：记忆图谱 + 向量 + 时序 recall。

照搬 `services/rag/vector_store.py` 范式：模块级 `_client` 单例 + async 函数 + `asyncio.to_thread`
包同步 SDK。graph 名 `cortex`（settings.falkordb_graph_name）。

节点：Entity / Fact(时效) / Episode(时序) / Preference / Document（知识层）+ Chunk（原文层）
边：RELATES_TO / SUBJECT|OBJECT / INVOLVES / MENTIONS / SOURCES / SUPERSEDES / SAME_AS

注意：FalkorDB Cypher 语法按 SDK 1.6.2 编写，需 FalkorDB 容器实跑验证
（本会话无 docker，验证留部署环境，跑 tests/memory/test_graph_store.py）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any

from falkordb import FalkorDB
from redis.exceptions import ResponseError

from src.config import settings
from src.services.memory import schema as S

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _now_iso() -> str:
    return _utcnow().isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


@dataclass
class MemoryHit:
    """recall 单条结果。score 是 FalkorDB 向量距离，越小越相关。"""
    content: str
    kind: str                      # entity / fact / episode / chunk / preference
    score: float | None = None
    metadata: dict[str, Any] | None = None


_client: FalkorDB | None = None


def _get_client() -> FalkorDB:
    global _client
    if _client is None:
        _client = FalkorDB.from_url(settings.falkordb_url)
    return _client


def _graph():
    return _get_client().select_graph(settings.falkordb_graph_name)


def _safe_prop(slug: str) -> str:
    """slug → 合法且稳定的向量属性名（embedding_<slug>）。"""
    normalized = slug.strip("_")
    return "embedding_" + "".join(c if c.isalnum() else "_" for c in normalized)


def _safe_text_prop(slug: str) -> str:
    normalized = slug.strip("_")
    return "embedding_source_" + "".join(c if c.isalnum() else "_" for c in normalized)


def _vector_spec(kind: str) -> tuple[str, str]:
    normalized = kind.strip().lower()
    try:
        return S.VECTOR_NODE_SPECS[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported memory vector kind: {kind}") from exc


def _normalize_kinds(kinds: list[str] | None) -> list[str]:
    if kinds is None:
        return list(S.VECTOR_KIND_ORDER)
    normalized: list[str] = []
    for kind in kinds:
        value = kind.strip().lower()
        _vector_spec(value)
        if value not in normalized:
            normalized.append(value)
    return normalized


def _parse_iso(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _recency_score(value: Any, *, now: datetime) -> float:
    parsed = _parse_iso(value)
    if parsed is None:
        return 0.0
    age_days = max(0.0, (now - parsed).total_seconds() / 86400)
    return math.exp(-age_days / 90.0)


# Overfetch 缓解共享 label 全局 ANN 的跨租户候选饥饿（实测 50 噪声即可饿死 candidate_k=32）。
_RECALL_OVERFETCH_FLOOR = 128


def _candidate_overfetch(top_k: int) -> int:
    return max(_RECALL_OVERFETCH_FLOOR, top_k * 16)


def _rerank_score(hit: MemoryHit, *, now: datetime) -> float:
    metadata = hit.metadata or {}
    graph_distance = int(metadata.get("graph_distance") or 0)
    if isinstance(hit.score, (int, float)) and math.isfinite(hit.score):
        distance = hit.score
    elif graph_distance > 0:
        # 图扩展节点无直接向量证据：用图距离作语义代理（越近间接相关性越强），
        # 否则 semantic 恒 0 会让跨类型证据在 Top-K 里被直接命中永久压制。
        distance = 0.8 + 0.4 * graph_distance
    else:
        distance = 2.0
    semantic = max(0.0, min(1.0, 1.0 - distance / 2.0))
    confidence = metadata.get("confidence")
    confidence_score = (
        max(0.0, min(1.0, float(confidence)))
        if isinstance(confidence, (int, float)) and math.isfinite(confidence)
        else 1.0
    )
    timestamp = metadata.get("occurred_at") or metadata.get("valid_from")
    recency = _recency_score(timestamp, now=now) if timestamp else 1.0
    graph_score = 1.0 / (1.0 + max(0, graph_distance))
    validity = 0.55 if metadata.get("valid_to") else 1.0
    source_quality = 1.0 if metadata.get("source") not in {None, "memory"} else 0.85
    return round(
        0.55 * semantic
        + 0.15 * confidence_score
        + 0.12 * recency
        + 0.10 * graph_score
        + 0.05 * validity
        + 0.03 * source_quality,
        6,
    )


# ---------------- 客户端 / 索引 ----------------

async def ping() -> bool:
    """FalkorDB 连通性检查（bootstrap fail-fast / status）。"""
    try:
        await asyncio.to_thread(lambda: _get_client().list_graphs())
        return True
    except Exception:
        logger.exception("FalkorDB ping failed")
        return False


async def ensure_graph() -> None:
    """Create the persistent graph key so empty-state reads remain valid."""
    await _write("MERGE (:CortexMeta {key:'cortex'})", {})


def _index_rows(graph) -> list[tuple]:
    result = _run(
        graph,
        "CALL db.indexes() "
        "YIELD label, properties, types, options, entitytype, status "
        "RETURN label, properties, types, options, entitytype, status",
    )
    return _rows(result)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return [value]


def _vector_index_details(
    row: tuple,
    *,
    label: str,
    prop: str,
) -> tuple[Mapping[str, Any], str] | None:
    if len(row) < 6:
        return None
    index_label, properties, types, options, entitytype, status = row[:6]
    index_properties = _as_list(properties)
    if index_label != label or prop not in index_properties or str(entitytype).upper() != "NODE":
        return None

    property_types = types.get(prop) if isinstance(types, Mapping) else types
    if "VECTOR" not in {str(index_type).upper() for index_type in _as_list(property_types)}:
        return None

    property_options: Any = options.get(prop) if isinstance(options, Mapping) else None
    if not isinstance(property_options, Mapping) and isinstance(options, Mapping):
        if "dimension" in options or "similarityFunction" in options:
            property_options = options
    if not isinstance(property_options, Mapping):
        property_options = {}
    return property_options, str(status or "")


def _validate_vector_index(
    row: tuple,
    *,
    label: str,
    prop: str,
    dim: int | None = None,
    require_operational: bool = True,
) -> bool:
    details = _vector_index_details(row, label=label, prop=prop)
    if details is None:
        return False
    options, status = details
    similarity = str(options.get("similarityFunction", "")).lower()
    if not options and dim is None:
        return not require_operational or not status or status.upper() == "OPERATIONAL"
    if similarity != "cosine":
        raise RuntimeError(
            f"Vector index {label}.{prop} uses incompatible similarity function: {similarity or 'unknown'}"
        )
    if dim is not None:
        try:
            indexed_dim = int(options.get("dimension"))
        except (TypeError, ValueError) as exc:
            raise RuntimeError(f"Vector index {label}.{prop} has no valid dimension") from exc
        if indexed_dim != dim:
            raise RuntimeError(
                f"Vector index {label}.{prop} dimension mismatch: expected {dim}, actual {indexed_dim}"
            )
    return not require_operational or status.upper() == "OPERATIONAL"


async def ensure_vector_index(
    embedding_model_slug: str,
    dim: int,
    *,
    kind: str = "chunk",
) -> None:
    """按节点类型与 embedding slug 幂等建立向量索引。"""
    label, _ = _vector_spec(kind)

    def _do() -> None:
        graph = _graph()
        prop = _safe_prop(embedding_model_slug)
        rows = _index_rows(graph)
        existing = next(
            (row for row in rows if _vector_index_details(row, label=label, prop=prop) is not None),
            None,
        )
        if existing is not None:
            _validate_vector_index(
                existing,
                label=label,
                prop=prop,
                dim=dim,
                require_operational=False,
            )
            return
        try:
            graph.create_node_vector_index(label, prop, dim=dim, similarity_function="cosine")
        except ResponseError:
            # Another backend worker may create the same index after our check.
            rows = _index_rows(graph)
            existing = next(
                (row for row in rows if _vector_index_details(row, label=label, prop=prop) is not None),
                None,
            )
            if existing is not None:
                _validate_vector_index(
                    existing,
                    label=label,
                    prop=prop,
                    dim=dim,
                    require_operational=False,
                )
                return
            raise

    await asyncio.to_thread(_do)


async def list_vector_indexed_kinds(embedding_model_slug: str) -> set[str]:
    """返回当前 embedding 空间已经建立向量索引的节点类型。"""

    def _do() -> set[str]:
        prop = _safe_prop(embedding_model_slug)
        rows = _index_rows(_graph())
        return {
            kind
            for kind, (label, _) in S.VECTOR_NODE_SPECS.items()
            if any(
                _validate_vector_index(row, label=label, prop=prop)
                for row in rows
                if _vector_index_details(row, label=label, prop=prop) is not None
            )
        }

    return await asyncio.to_thread(_do)


# ---------------- 知识层写入 ----------------

async def add_entity(
    *, user_id: int, name: str, entity_type: str | None = None,
    aliases: list[str] | None = None, description: str | None = None, confidence: float = 1.0,
) -> str:
    eid = _new_id()
    params = {
        "eid": eid, "uid": user_id, "name": name, "etype": entity_type,
        "aliases": aliases or [], "desc": description or "", "conf": confidence, "now": _now_iso(),
    }
    await _write(
        f"CREATE (n:{S.ENTITY} {{entity_id:$eid, user_id:$uid, name:$name, entity_type:$etype, "
        f"aliases:$aliases, description:$desc, confidence:$conf, created_at:$now, last_accessed_at:$now}})",
        params,
    )
    return eid


async def add_fact(
    *, user_id: int, subject_id: str, predicate: str, object_text: str,
    object_id: str | None = None, valid_from: str | None = None, valid_to: str | None = None,
    confidence: float = 1.0, source_doc_id: str | None = None,
) -> str:
    fid = _new_id()
    params = {
        "fid": fid, "uid": user_id, "sid": subject_id, "pred": predicate, "obj": object_text,
        "oid": object_id, "vf": valid_from or _now_iso(), "vt": valid_to, "conf": confidence,
        "sdoc": source_doc_id, "now": _now_iso(),
    }
    await _write(
        f"CREATE (f:{S.FACT} {{fact_id:$fid, user_id:$uid, subject_id:$sid, predicate:$pred, "
        f"object_text:$obj, object_id:$oid, valid_from:$vf, valid_to:$vt, confidence:$conf, "
        f"source_doc_id:$sdoc, created_at:$now, last_accessed_at:$now}})",
        params,
    )
    if object_id:
        await _write(
            f"MATCH (f:{S.FACT} {{fact_id:$fid}}), (s:{S.ENTITY} {{entity_id:$sid}}), "
            f"(o:{S.ENTITY} {{entity_id:$oid}}) CREATE (f)-[:{S.SUBJECT}]->(s), (f)-[:{S.OBJECT}]->(o)",
            {"fid": fid, "sid": subject_id, "oid": object_id},
        )
    else:
        await _write(
            f"MATCH (f:{S.FACT} {{fact_id:$fid}}), (s:{S.ENTITY} {{entity_id:$sid}}) "
            f"CREATE (f)-[:{S.SUBJECT}]->(s)",
            {"fid": fid, "sid": subject_id},
        )
    return fid


async def add_episode(
    *, user_id: int, kind: str, summary: str, occurred_at: str | None = None,
    conversation_id: int | None = None, message_id: int | None = None,
    participants: list[str] | None = None,
) -> str:
    eid = _new_id()
    params = {
        "eid": eid, "uid": user_id, "kind": kind, "summary": summary,
        "occ": occurred_at or _now_iso(), "cid": conversation_id, "mid": message_id,
        "parts": participants or [], "now": _now_iso(),
    }
    await _write(
        f"CREATE (e:{S.EPISODE} {{episode_id:$eid, user_id:$uid, kind:$kind, summary:$summary, "
        f"occurred_at:$occ, conversation_id:$cid, message_id:$mid, participants:$parts, "
        f"created_at:$now, last_accessed_at:$now}})",
        params,
    )
    return eid


async def add_preference(*, user_id: int, key: str, value: str, confidence: float = 1.0) -> str:
    pid = _new_id()
    await _write(
        f"CREATE (p:{S.PREFERENCE} {{pref_id:$pid, user_id:$uid, key:$key, value:$val, "
        f"confidence:$conf, valid_from:$vf, valid_to:$vt, last_accessed_at:$vf}})",
        {"pid": pid, "uid": user_id, "key": key, "val": value, "conf": confidence,
         "vf": _now_iso(), "vt": None},
    )
    return pid


async def fetch_nodes_for_embedding(
    *,
    kind: str,
    embedding_model: str,
    user_id: int | None = None,
    ids: list[str] | None = None,
    cursor: tuple[int, str] | None = None,
    limit: int = 32,
    missing_only: bool = True,
) -> list[dict]:
    """读取知识节点的稳定语义字段，供在线索引和 backfill。"""
    normalized = kind.strip().lower()
    label, id_key = _vector_spec(normalized)
    prop = _safe_prop(embedding_model)
    text_prop = _safe_text_prop(embedding_model)
    filters = []
    params: dict[str, Any] = {"limit": max(1, limit)}
    if user_id is not None:
        filters.append("node.user_id=$uid")
        params["uid"] = user_id
    if ids is not None:
        if not ids:
            return []
        filters.append(f"node.{id_key} IN $ids")
        params["ids"] = ids
    if cursor is not None:
        filters.append(
            f"(node.user_id > $cursor_uid OR "
            f"(node.user_id = $cursor_uid AND node.{id_key} > $cursor_id))"
        )
        params.update({"cursor_uid": cursor[0], "cursor_id": cursor[1]})
    if missing_only:
        if normalized == "chunk":
            filters.append(f"node.{prop} IS NULL")
        else:
            filters.append(f"(node.{prop} IS NULL OR node.{text_prop} IS NULL)")
    where = "WHERE " + " AND ".join(filters) if filters else ""

    if normalized == "chunk":
        cypher = (
            f"MATCH (node:{label}) {where} "
            f"RETURN node.user_id, node.{id_key}, node.content "
            f"ORDER BY node.user_id, node.{id_key} LIMIT $limit"
        )
    elif normalized == "entity":
        entity_filters = ["canonical IS NULL", *filters]
        cypher = (
            f"MATCH (node:{label}) "
            f"OPTIONAL MATCH (node)-[:{S.SAME_AS}]->(canonical:{S.ENTITY}) "
            "WITH node, canonical "
            f"WHERE {' AND '.join(entity_filters)} "
            f"RETURN node.user_id, node.{id_key}, node.name, node.entity_type, "
            "node.aliases, node.description "
            f"ORDER BY node.user_id, node.{id_key} LIMIT $limit"
        )
    elif normalized == "fact":
        cypher = (
            f"MATCH (node:{label}) "
            f"OPTIONAL MATCH (node)-[:{S.SUBJECT}]->(subject:{S.ENTITY}) "
            "WITH node, CASE WHEN subject.user_id=node.user_id THEN subject.name ELSE NULL END AS subject_name "
            f"{where} RETURN node.user_id, node.{id_key}, node.subject_id, subject_name, "
            "node.predicate, node.object_text "
            f"ORDER BY node.user_id, node.{id_key} LIMIT $limit"
        )
    elif normalized == "episode":
        cypher = (
            f"MATCH (node:{label}) {where} "
            f"RETURN node.user_id, node.{id_key}, node.kind, node.summary "
            f"ORDER BY node.user_id, node.{id_key} LIMIT $limit"
        )
    else:
        cypher = (
            f"MATCH (node:{label}) {where} "
            f"RETURN node.user_id, node.{id_key}, node.key, node.value "
            f"ORDER BY node.user_id, node.{id_key} LIMIT $limit"
        )

    rows = _rows(await _read(cypher, params))
    if normalized == "chunk":
        return [
            {"user_id": row[0], "memory_id": row[1], "content": row[2]}
            for row in rows
        ]
    if normalized == "entity":
        return [
            {
                "user_id": row[0], "memory_id": row[1], "name": row[2],
                "entity_type": row[3], "aliases": row[4] or [], "description": row[5],
            }
            for row in rows
        ]
    if normalized == "fact":
        return [
            {
                "user_id": row[0], "memory_id": row[1], "subject_id": row[2],
                "subject_name": row[3], "predicate": row[4], "object_text": row[5],
            }
            for row in rows
        ]
    if normalized == "episode":
        return [
            {"user_id": row[0], "memory_id": row[1], "kind": row[2], "summary": row[3]}
            for row in rows
        ]
    return [
        {"user_id": row[0], "memory_id": row[1], "key": row[2], "value": row[3]}
        for row in rows
    ]


async def upsert_node_embeddings(
    *,
    kind: str,
    embedding_model: str,
    vector_dim: int,
    rows: list[dict],
) -> int:
    """为节点写入当前 embedding 空间的向量和稳定文本。"""
    normalized = kind.strip().lower()
    label, id_key = _vector_spec(normalized)
    if not rows:
        return 0
    for row in rows:
        embedding = row.get("embedding") or []
        if len(embedding) != vector_dim or not row.get("text", "").strip():
            raise ValueError("Knowledge node embeddings must be non-empty and have one dimension")
    await ensure_vector_index(embedding_model, vector_dim, kind=normalized)
    prop = _safe_prop(embedding_model)
    text_prop = _safe_text_prop(embedding_model)
    updated = 0
    for row in rows:
        set_clause = f"SET node.{prop}=vecf32($embedding)"
        params = {
            "uid": row["user_id"],
            "mid": row["memory_id"],
            "embedding": row["embedding"],
        }
        if normalized != "chunk":
            set_clause += f", node.{text_prop}=$text"
            params["text"] = row["text"]
        result = await _write(
            f"MATCH (node:{label} {{user_id:$uid, {id_key}:$mid}}) "
            f"{set_clause} RETURN count(node)",
            params,
        )
        result_rows = _rows(result)
        updated += result_rows[0][0] if result_rows else 0
    return updated


async def get_fact(*, user_id: int, fact_id: str) -> dict | None:
    rs = await _read(
        f"MATCH (f:{S.FACT} {{user_id:$uid, fact_id:$fid}}) WHERE f.valid_to IS NULL "
        "RETURN f.subject_id, f.predicate, f.object_text, f.confidence, f.source_doc_id",
        {"uid": user_id, "fid": fact_id},
    )
    rows = _rows(rs)
    if not rows:
        return None
    row = rows[0]
    return {
        "fact_id": fact_id,
        "subject_id": row[0],
        "predicate": row[1],
        "object_text": row[2],
        "confidence": row[3],
        "source_doc_id": row[4],
    }


async def correct_fact(
    *,
    user_id: int,
    fact_id: str,
    object_text: str,
    predicate: str | None = None,
    confidence: float | None = None,
) -> dict | None:
    """Supersede one active fact while retaining it as historical evidence."""
    existing = await get_fact(user_id=user_id, fact_id=fact_id)
    if existing is None:
        return None
    new_predicate = predicate or existing["predicate"]
    new_confidence = existing["confidence"] if confidence is None else confidence
    new_id = await add_fact(
        user_id=user_id,
        subject_id=existing["subject_id"],
        predicate=new_predicate,
        object_text=object_text,
        confidence=new_confidence,
        source_doc_id=existing["source_doc_id"],
    )
    await supersede_fact(new_fact_id=new_id, old_fact_id=fact_id)
    return {
        **existing,
        "fact_id": new_id,
        "predicate": new_predicate,
        "object_text": object_text,
        "confidence": new_confidence,
        "valid_from": _now_iso(),
        "valid_to": None,
    }


async def get_preference(*, user_id: int, pref_id: str) -> dict | None:
    rs = await _read(
        f"MATCH (p:{S.PREFERENCE} {{user_id:$uid, pref_id:$pid}}) WHERE p.valid_to IS NULL "
        "RETURN p.key, p.value, p.confidence, p.valid_from",
        {"uid": user_id, "pid": pref_id},
    )
    rows = _rows(rs)
    if not rows:
        return None
    row = rows[0]
    return {
        "pref_id": pref_id,
        "key": row[0],
        "value": row[1],
        "confidence": row[2],
        "valid_from": row[3],
    }


async def update_preference(
    *, user_id: int, pref_id: str, value: str, confidence: float | None = None
) -> dict | None:
    """Version a preference so prior values remain auditable but inactive."""
    existing = await get_preference(user_id=user_id, pref_id=pref_id)
    if existing is None:
        return None
    new_confidence = existing["confidence"] if confidence is None else confidence
    await _write(
        f"MATCH (p:{S.PREFERENCE} {{user_id:$uid, key:$key}}) WHERE p.valid_to IS NULL "
        "SET p.valid_to=$now",
        {"uid": user_id, "key": existing["key"], "now": _now_iso()},
    )
    new_id = await add_preference(
        user_id=user_id,
        key=existing["key"],
        value=value,
        confidence=new_confidence,
    )
    return {
        "pref_id": new_id,
        "key": existing["key"],
        "value": value,
        "confidence": new_confidence,
        "valid_from": _now_iso(),
    }


async def delete_memory(*, user_id: int, memory_type: str, memory_id: str) -> bool:
    specs = {
        "episode": (S.EPISODE, "episode_id"),
        "fact": (S.FACT, "fact_id"),
        "preference": (S.PREFERENCE, "pref_id"),
    }
    spec = specs.get(memory_type)
    if spec is None:
        return False
    label, id_key = spec
    params = {"uid": user_id, "mid": memory_id}
    result = await _read(
        f"MATCH (n:{label} {{user_id:$uid, {id_key}:$mid}}) RETURN count(n)",
        params,
    )
    rows = _rows(result)
    if not rows or not rows[0][0]:
        return False
    await _write(
        f"MATCH (n:{label} {{user_id:$uid, {id_key}:$mid}}) DETACH DELETE n",
        params,
    )
    return True


async def link_episode_entities(episode_id: str, entity_ids: list[str]) -> None:
    """Episode INVOLVES 实体（对话涉及了哪些实体）。"""
    if not entity_ids:
        return
    for eid in entity_ids:
        await _write(
            f"MATCH (e:{S.EPISODE} {{episode_id:$ep}}), (n:{S.ENTITY} {{entity_id:$eid}}) "
            f"CREATE (e)-[:{S.INVOLVES}]->(n)",
            {"ep": episode_id, "eid": eid},
        )


async def link_document(*, user_id: int, resource_type: str, resource_id: int, title: str) -> str:
    did = _new_id()
    result = await _write(
        f"MERGE (d:{S.DOCUMENT} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) "
        f"ON CREATE SET d.doc_id=$did, d.title=$title ON MATCH SET d.title=$title "
        f"RETURN d.doc_id",
        {"did": did, "uid": user_id, "rt": resource_type, "rid": resource_id, "title": title},
    )
    return _rows(result)[0][0]


async def link_document_knowledge(
    *, doc_id: str, entity_ids: list[str], fact_ids: list[str]
) -> None:
    for entity_id in entity_ids:
        await _write(
            f"MATCH (d:{S.DOCUMENT} {{doc_id:$doc}}), (e:{S.ENTITY} {{entity_id:$entity}}) "
            f"MERGE (d)-[:{S.SOURCES}]->(e)",
            {"doc": doc_id, "entity": entity_id},
        )
    for fact_id in fact_ids:
        await _write(
            f"MATCH (d:{S.DOCUMENT} {{doc_id:$doc}}), (f:{S.FACT} {{fact_id:$fact}}) "
            f"MERGE (d)-[:{S.SOURCES}]->(f)",
            {"doc": doc_id, "fact": fact_id},
        )


# ---------------- 巩固 ----------------

async def supersede_fact(*, new_fact_id: str, old_fact_id: str) -> None:
    """新事实取代旧事实：旧 Fact valid_to 置位 + SUPERSEDES 边（保留旧记录可回溯）。"""
    await _write(
        f"MATCH (old:{S.FACT} {{fact_id:$old}}) SET old.valid_to=$now "
        f"WITH old MATCH (new:{S.FACT} {{fact_id:$new}}) CREATE (new)-[:{S.SUPERSEDES}]->(old)",
        {"old": old_fact_id, "new": new_fact_id, "now": _now_iso()},
    )


async def merge_entities(*, source_id: str, target_id: str) -> int:
    """实体消歧：source SAME_AS target（不删 source，标注等价；前端/查询可合并视图）。"""
    await _write(
        f"MATCH (s:{S.ENTITY} {{entity_id:$sid}}), (t:{S.ENTITY} {{entity_id:$tid}}) "
        f"CREATE (s)-[:{S.SAME_AS}]->(t)",
        {"sid": source_id, "tid": target_id},
    )
    return 1


# ---------------- 原文层（承接旧 vector_store 契约）----------------

async def add_document_chunks(
    *, user_id: int, collection_name: str, stored_name: str,
    chunks: list[str], embeddings: list[list[float]], metadata_list: list[dict] | None = None,
    embedding_model: str, vector_dim: int, progress_callback=None,
) -> None:
    """原文层：批量写扁平 Chunk 向量（不建图谱边）。承接旧 add_documents 语义。"""
    if not chunks:
        return
    prop = _safe_prop(embedding_model)
    await ensure_vector_index(embedding_model, vector_dim)
    metadata_list = metadata_list or [{}] * len(chunks)
    for i, (text, emb, meta) in enumerate(zip(chunks, embeddings, metadata_list)):
        cid = f"{stored_name}:{i}"
        params = {
            "cid": cid, "uid": user_id, "col": collection_name, "stored": stored_name,
            "content": text, "emb": emb, "rt": meta.get("resource_type"),
            "rid": meta.get("resource_id"), "src": meta.get("source") or meta.get("file_name"),
            "idx": i, "total": len(chunks),
        }
        await _write(
            f"MERGE (c:{S.CHUNK} {{chunk_id:$cid, user_id:$uid}}) SET c.collection_name=$col, "
            f"c.stored_name=$stored, c.content=$content, c.{prop}=vecf32($emb), c.resource_type=$rt, "
            f"c.resource_id=$rid, c.source=$src, c.chunk_index=$idx, c.total_chunks=$total",
            params,
        )
        if progress_callback:
            res = progress_callback(i + 1, len(chunks), "chunk")
            if res is not None:
                await res


async def search_documents(
    *, user_id: int, collection_name: str | None, query_embedding: list[float],
    embedding_model: str, top_k: int, whitelist_stored_names: set[str],
) -> list[MemoryHit]:
    """原文层向量检索（仅 Chunk，无图扩展）。白名单下推到 Cypher。对应 tools/file.py base_search_file。"""
    prop = _safe_prop(embedding_model)
    wl = list(whitelist_stored_names)

    def _do() -> list[MemoryHit]:
        g = _graph()
        candidate_k = _candidate_overfetch(top_k)
        where = "node.user_id=$uid AND node.stored_name IN $wl"
        if collection_name is not None:
            where += " AND node.collection_name=$collection"
        cypher = (
            f"CALL db.idx.vector.queryNodes('{S.CHUNK}', '{prop}', $candidate_k, vecf32($vec)) "
            f"YIELD node, score WHERE {where} "
            f"RETURN node.content, node.stored_name, node.source, score "
            f"ORDER BY score ASC LIMIT $limit"
        )
        rs = _run(
            g,
            cypher,
            {
                "candidate_k": candidate_k,
                "limit": top_k,
                "vec": query_embedding,
                "uid": user_id,
                "wl": wl,
                "collection": collection_name,
            },
        )
        hits: list[MemoryHit] = []
        for row in _rows(rs):
            hits.append(MemoryHit(content=row[0], kind="chunk", score=row[3],
                                  metadata={"stored_name": row[1], "source": row[2]}))
        return hits

    return await asyncio.to_thread(_do)


async def delete_document_chunks(collection_name: str, stored_name: str) -> bool:
    """签名与旧 vector_store 完全一致；删该 stored_name 的 Chunk（连带 MENTIONS 边）。"""
    await _write(
        f"MATCH (c:{S.CHUNK} {{collection_name:$collection, stored_name:$stored}}) DETACH DELETE c",
        {"collection": collection_name, "stored": stored_name},
    )
    return True


async def link_chunk_entities(stored_name: str, chunk_index: int, entity_ids: list[str]) -> None:
    """Chunk MENTIONS 实体（抽取出的实体锚定到原文片段）。"""
    if not entity_ids:
        return
    cid = f"{stored_name}:{chunk_index}"
    for eid in entity_ids:
        await _write(
            f"MATCH (c:{S.CHUNK} {{chunk_id:$cid}}), (e:{S.ENTITY} {{entity_id:$eid}}) "
            f"MERGE (c)-[:{S.MENTIONS}]->(e)",
            {"cid": cid, "eid": eid},
        )


# ---------------- recall（时序：向量 + 时效 + 图扩展 + 置信度）----------------

async def recall(
    *, user_id: int, query_embedding: list[float], embedding_model: str,
    top_k: int | None = None, hops: int | None = None,
    whitelist_stored_names: set[str] | None = None, kinds: list[str] | None = None,
    only_valid: bool = True,
) -> list[MemoryHit]:
    """多类型语义候选 + user-scoped 受限图扩展 + 多信号排序。"""
    top_k = top_k or settings.memory_recall_top_k
    max_hops = max(0, min(hops if hops is not None else settings.memory_recall_hops, 2))
    requested = _normalize_kinds(kinds)
    if not requested:
        return []
    available = await list_vector_indexed_kinds(embedding_model)
    selected = [kind for kind in requested if kind in available]
    if not selected:
        return []
    prop = _safe_prop(embedding_model)
    text_prop = _safe_text_prop(embedding_model)
    wl = list(whitelist_stored_names) if whitelist_stored_names else None
    candidate_k = _candidate_overfetch(top_k)

    def _do() -> list[MemoryHit]:
        graph = _graph()
        hits: list[MemoryHit] = []
        for kind in selected:
            label, id_key = _vector_spec(kind)
            where_parts = ["node.user_id=$uid"]
            if kind == "chunk" and wl is not None:
                where_parts.append("node.stored_name IN $wl")
            if kind in {"fact", "preference"} and only_valid:
                where_parts.append("node.valid_to IS NULL")
            params = {
                "k": candidate_k,
                "limit": candidate_k,
                "vec": query_embedding,
                "uid": user_id,
                "wl": wl,
            }
            prefix = (
                f"CALL db.idx.vector.queryNodes('{label}', '{prop}', $k, vecf32($vec)) "
                "YIELD node, score "
            )
            if kind == "chunk":
                cypher = (
                    prefix
                    + f"WHERE {' AND '.join(where_parts)} "
                    + f"OPTIONAL MATCH (node)-[:{S.MENTIONS}]->(e:{S.ENTITY} {{user_id:$uid}}) "
                    + "RETURN node.content, node.source, score, collect(e.name), node.chunk_id "
                    + "ORDER BY score ASC LIMIT $limit"
                )
                for row in _rows(_run(graph, cypher, params)):
                    content = row[0]
                    entities = row[3] or []
                    if entities:
                        content += "\n关联实体: " + ", ".join(entities)
                    hits.append(MemoryHit(
                        content=content,
                        kind=kind,
                        score=row[2],
                        metadata={
                            "id": row[4], "source": row[1], "entities": entities,
                            "graph_distance": 0, "evidence": "direct-vector-match", "path": [],
                        },
                    ))
            elif kind == "entity":
                cypher = (
                    prefix
                    + f"WHERE {' AND '.join(where_parts)} "
                    + f"OPTIONAL MATCH (node)-[:{S.SAME_AS}]->(canonical:{S.ENTITY}) "
                    + "WITH node, score, canonical WHERE canonical IS NULL "
                    + f"RETURN node.{text_prop}, score, node.{id_key}, node.name, "
                    + "node.entity_type, node.confidence "
                    + "ORDER BY score ASC LIMIT $limit"
                )
                for row in _rows(_run(graph, cypher, params)):
                    hits.append(MemoryHit(
                        content=row[0],
                        kind=kind,
                        score=row[1],
                        metadata={
                            "id": row[2], "source": row[3], "name": row[3],
                            "entity_type": row[4], "confidence": row[5],
                            "graph_distance": 0, "evidence": "direct-vector-match", "path": [],
                        },
                    ))
            elif kind == "fact":
                cypher = (
                    prefix
                    + f"WHERE {' AND '.join(where_parts)} "
                    + f"RETURN node.{text_prop}, score, node.{id_key}, node.subject_id, "
                    + "node.predicate, node.valid_from, node.valid_to, node.confidence, node.source_doc_id "
                    + "ORDER BY score ASC LIMIT $limit"
                )
                for row in _rows(_run(graph, cypher, params)):
                    hits.append(MemoryHit(
                        content=row[0],
                        kind=kind,
                        score=row[1],
                        metadata={
                            "id": row[2], "source": row[8] or "memory",
                            "subject_id": row[3], "predicate": row[4],
                            "valid_from": row[5], "valid_to": row[6],
                            "confidence": row[7], "source_doc_id": row[8],
                            "graph_distance": 0, "evidence": "direct-vector-match", "path": [],
                        },
                    ))
            elif kind == "episode":
                cypher = (
                    prefix
                    + f"WHERE {' AND '.join(where_parts)} "
                    + f"RETURN node.{text_prop}, score, node.{id_key}, node.kind, "
                    + "node.occurred_at, node.conversation_id, node.message_id, node.confidence "
                    + "ORDER BY score ASC LIMIT $limit"
                )
                for row in _rows(_run(graph, cypher, params)):
                    hits.append(MemoryHit(
                        content=row[0],
                        kind=kind,
                        score=row[1],
                        metadata={
                            "id": row[2], "source": f"conversation:{row[5]}" if row[5] else "memory",
                            "episode_kind": row[3], "occurred_at": row[4],
                            "conversation_id": row[5], "message_id": row[6],
                            "confidence": row[7] if len(row) > 7 else None,
                            "graph_distance": 0, "evidence": "direct-vector-match", "path": [],
                        },
                    ))
            else:
                cypher = (
                    prefix
                    + f"WHERE {' AND '.join(where_parts)} "
                    + f"RETURN node.{text_prop}, score, node.{id_key}, node.key, "
                    + "node.valid_from, node.valid_to, node.confidence "
                    + "ORDER BY score ASC LIMIT $limit"
                )
                for row in _rows(_run(graph, cypher, params)):
                    hits.append(MemoryHit(
                        content=row[0],
                        kind=kind,
                        score=row[1],
                        metadata={
                            "id": row[2], "source": "preference", "key": row[3],
                            "valid_from": row[4], "valid_to": row[5], "confidence": row[6],
                            "graph_distance": 0, "evidence": "direct-vector-match", "path": [],
                        },
                    ))
        seed_hits = list(hits)
        if max_hops:
            seed_refs = [
                (hit.kind, str((hit.metadata or {}).get("id")))
                for hit in seed_hits
                if (hit.metadata or {}).get("id")
            ]
            expanded = _expand_memory_seeds_sync(
                graph,
                user_id=user_id,
                seeds=seed_refs,
                hops=max_hops,
                only_valid=only_valid,
                limit=max(top_k * 4, 24),
            )
            hits.extend(expanded)

        now = _utcnow()
        kind_order = {kind: index for index, kind in enumerate(S.VECTOR_KIND_ORDER)}
        deduped: dict[tuple[str, str], MemoryHit] = {}
        for hit in hits:
            metadata = hit.metadata or {}
            key = (hit.kind, str(metadata.get("id") or hit.content[:200]))
            metadata["rank_score"] = _rerank_score(hit, now=now)
            hit.metadata = metadata
            current = deduped.get(key)
            if current is None or metadata["rank_score"] > (current.metadata or {}).get("rank_score", 0.0):
                deduped[key] = hit
        ranked = sorted(
            deduped.values(),
            key=lambda hit: (
                -(hit.metadata or {}).get("rank_score", 0.0),
                hit.score if hit.score is not None else float("inf"),
                kind_order.get(hit.kind, len(kind_order)),
                str((hit.metadata or {}).get("id", "")),
            ),
        )
        return ranked[:top_k]

    ranked = await asyncio.to_thread(_do)
    return await _annotate_superseded_replacements(user_id=user_id, hits=ranked)


async def _annotate_superseded_replacements(
    *, user_id: int, hits: list[MemoryHit]
) -> list[MemoryHit]:
    """Fact 演化标注：为命中的当前 Fact 回填它取代的旧值（metadata.replaced）。
    拆到独立纯 MATCH 查询：queryNodes YIELD 内做 OPTIONAL MATCH + 聚合/路径表达式会让
    FalkorDB SDK 迭代异常（StopIteration），纯 MATCH 批量查询稳定。"""
    fact_ids = [
        str((h.metadata or {}).get("id"))
        for h in hits
        if h.kind == "fact" and (h.metadata or {}).get("id")
    ]
    if not fact_ids:
        return hits
    rs = await _read(
        f"MATCH (f:{S.FACT} {{user_id:$uid}})-[:{S.SUPERSEDES}]->(old:{S.FACT}) "
        "WHERE f.fact_id IN $ids RETURN f.fact_id, old.object_text",
        {"uid": user_id, "ids": fact_ids},
    )
    replaced_map: dict[str, list[str]] = {}
    for fid, old_obj in _rows(rs):
        if old_obj:
            replaced_map.setdefault(fid, []).append(old_obj)
    for hit in hits:
        if hit.kind == "fact" and hit.metadata:
            hit.metadata["replaced"] = replaced_map.get(str(hit.metadata.get("id")), [])
    return hits


async def touch_memories(*, user_id: int, hits: list[MemoryHit]) -> None:
    """刷新被 recall 命中节点的 last_accessed_at，驱动衰减闭环（best-effort，调用方包 try）。

    Chunk 是原文层、不参与记忆衰减，跳过；其余类型按 (kind, node id) 批量更新访问时间。
    """
    refs: dict[str, list[str]] = {}
    for hit in hits:
        if hit.kind == "chunk":
            continue
        node_id = (hit.metadata or {}).get("id")
        if node_id:
            refs.setdefault(hit.kind, []).append(str(node_id))
    if not refs:
        return
    now = _now_iso()
    for kind, ids in refs.items():
        label, id_key = _vector_spec(kind)
        await _write(
            f"MATCH (node:{label}) WHERE node.user_id=$uid AND node.{id_key} IN $ids "
            "SET node.last_accessed_at=$now, "
            "node.confidence = CASE WHEN node.confidence IS NULL THEN 0.5 "
            "WHEN node.confidence + 0.05 > 1.0 THEN 1.0 "
            "ELSE node.confidence + 0.05 END",
            {"uid": user_id, "ids": ids, "now": now},
        )


def _node_kind(labels: Any) -> str | None:
    label_values = _as_list(labels)
    for kind, (label, _) in S.GRAPH_NODE_SPECS.items():
        if label in label_values:
            return kind
    return None


def _node_memory_id(kind: str, properties: Mapping[str, Any]) -> str | None:
    _, id_key = S.GRAPH_NODE_SPECS[kind]
    value = properties.get(id_key)
    return str(value) if value is not None else None


def _render_expanded_node(kind: str, properties: Mapping[str, Any]) -> str:
    if kind == "chunk":
        return str(properties.get("content") or "")
    if kind == "entity":
        return str(properties.get("name") or "")
    if kind == "fact":
        return " ".join(
            str(value).strip()
            for value in (
                properties.get("subject_id"),
                properties.get("predicate"),
                properties.get("object_text"),
            )
            if value
        )
    if kind == "episode":
        return str(properties.get("summary") or "")
    if kind == "preference":
        return f"{properties.get('key')}: {properties.get('value')}"
    return str(properties.get("title") or "")


def _expand_memory_seeds_sync(
    graph,
    *,
    user_id: int,
    seeds: list[tuple[str, str]],
    hops: int,
    only_valid: bool,
    limit: int,
) -> list[MemoryHit]:
    if not seeds or hops <= 0:
        return []
    allowed_edges = "|".join(S.GRAPH_RECALL_EDGES)
    hits: list[MemoryHit] = []
    seen: set[tuple[str, str]] = set(seeds)
    frontier = list(seeds)
    for depth in range(1, hops + 1):
        if not frontier or len(hits) >= limit:
            break
        next_frontier: list[tuple[str, str]] = []
        for seed_kind, seed_id in frontier:
            seed_spec = S.GRAPH_NODE_SPECS.get(seed_kind)
            if seed_spec is None:
                continue
            seed_label, seed_id_key = seed_spec
            cypher = (
                f"MATCH (seed:{seed_label} {{user_id:$uid, {seed_id_key}:$seed_id}}) "
                f"MATCH (seed)-[rel:{allowed_edges}]-(node) "
                "WHERE node.user_id=$uid "
                "RETURN labels(node), properties(node), type(rel), startNode(rel)=seed "
                "ORDER BY type(rel) LIMIT $limit"
            )
            rows = _rows(_run(
                graph,
                cypher,
                {"uid": user_id, "seed_id": seed_id, "limit": max(1, limit - len(hits))},
            ))
            for row in rows:
                if len(row) < 4 or not isinstance(row[1], Mapping):
                    continue
                kind = _node_kind(row[0])
                if kind not in S.VECTOR_NODE_SPECS:
                    continue
                properties = row[1]
                memory_id = _node_memory_id(kind, properties)
                if not memory_id or (kind, memory_id) in seen:
                    continue
                if only_valid and kind in {"fact", "preference"} and properties.get("valid_to"):
                    continue
                content = _render_expanded_node(kind, properties).strip()
                if not content:
                    continue
                source = properties.get("source") or properties.get("source_doc_id") or "memory"
                confidence = properties.get("confidence")
                metadata = {
                    "id": memory_id,
                    "source": source,
                    "confidence": confidence,
                    "occurred_at": properties.get("occurred_at"),
                    "valid_from": properties.get("valid_from"),
                    "valid_to": properties.get("valid_to"),
                    "graph_distance": depth,
                    "evidence": {"seed_kind": seed_kind, "seed_id": seed_id},
                    "path": [{
                        "from_kind": seed_kind,
                        "from_id": seed_id,
                        "relation": row[2],
                        "direction": "out" if row[3] else "in",
                        "to_kind": kind,
                        "to_id": memory_id,
                    }],
                    "expanded": True,
                }
                hits.append(MemoryHit(content=content, kind=kind, score=None, metadata=metadata))
                seen.add((kind, memory_id))
                next_frontier.append((kind, memory_id))
                if len(hits) >= limit:
                    break
        frontier = next_frontier
    return hits


# ---------------- 运维 ----------------

async def list_resource_memory() -> list[dict]:
    """Return resource keys represented by document anchors or indexed chunks."""
    documents = await _read(
        f"MATCH (d:{S.DOCUMENT}) RETURN d.user_id, d.resource_type, d.resource_id",
    )
    chunks = await _read(
        f"MATCH (c:{S.CHUNK}) WHERE c.resource_type IS NOT NULL AND c.resource_id IS NOT NULL "
        "RETURN DISTINCT c.user_id, c.resource_type, c.resource_id",
    )
    keys = {
        (row[0], row[1], row[2])
        for row in [*_rows(documents), *_rows(chunks)]
        if row[0] is not None and row[1] is not None and row[2] is not None
    }
    return [
        {"user_id": user_id, "resource_type": resource_type, "resource_id": resource_id}
        for user_id, resource_type, resource_id in keys
    ]


async def has_resource_memory(*, user_id: int, resource_type: str, resource_id: int) -> bool:
    rs = await _read(
        f"OPTIONAL MATCH (d:{S.DOCUMENT} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) "
        "WITH count(d) AS documents "
        f"OPTIONAL MATCH (c:{S.CHUNK} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) "
        "RETURN documents, count(c)",
        {"uid": user_id, "rt": resource_type, "rid": resource_id},
    )
    rows = _rows(rs)
    return bool(rows and rows[0][0] and rows[0][1])


async def delete_resource_memory(*, user_id: int, resource_type: str, resource_id: int) -> None:
    """Delete the graph representation for a removed or unindexed resource."""
    params = {"uid": user_id, "rt": resource_type, "rid": resource_id}
    doc_result = await _read(
        f"MATCH (d:{S.DOCUMENT} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) "
        "RETURN d.doc_id",
        params,
    )
    doc_ids = [row[0] for row in _rows(doc_result) if row and row[0]]
    if doc_ids:
        await _write(
            f"MATCH (f:{S.FACT} {{user_id:$uid}}) "
            "WHERE f.source_doc_id IN $doc_ids DETACH DELETE f",
            {"uid": user_id, "doc_ids": doc_ids},
        )
    await _write(
        f"MATCH (d:{S.DOCUMENT} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) DETACH DELETE d",
        params,
    )
    await _write(
        f"MATCH (c:{S.CHUNK} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) DETACH DELETE c",
        params,
    )
    await _write(
        f"MATCH (e:{S.ENTITY} {{user_id:$uid}}) "
        f"WHERE NOT (e)<-[:{S.MENTIONS}|{S.SOURCES}|{S.SUBJECT}|{S.OBJECT}|{S.INVOLVES}]-() "
        f"AND NOT (e)-[:{S.RELATES_TO}|{S.SAME_AS}]-() DETACH DELETE e",
        {"uid": user_id},
    )


# ---------------- 只读列表查询（brain_service / 前端可视化）----------------

async def list_entities(*, user_id: int, limit: int = 200, offset: int = 0) -> list[dict]:
    """列出用户全部实体（按创建时间倒序）。"""
    cypher = (
        f"MATCH (e:{S.ENTITY} {{user_id:$uid}}) "
        f"RETURN e.entity_id, e.name, e.entity_type, e.aliases, e.description, "
        f"e.confidence, e.created_at, e.last_accessed_at "
        f"ORDER BY e.created_at DESC SKIP $skip LIMIT $limit"
    )
    rs = await _read(cypher, {"uid": user_id, "skip": offset, "limit": limit})
    return [
        {"entity_id": r[0], "name": r[1], "entity_type": r[2], "aliases": r[3] or [],
         "description": r[4], "confidence": r[5], "created_at": r[6], "last_accessed_at": r[7]}
        for r in _rows(rs)
    ]


async def list_episodes(*, user_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    """列出用户情景记忆（对话/事件，按发生时间倒序）。"""
    cypher = (
        f"MATCH (e:{S.EPISODE} {{user_id:$uid}}) "
        f"RETURN e.episode_id, e.kind, e.summary, e.occurred_at, e.conversation_id, e.participants "
        f"ORDER BY e.occurred_at DESC SKIP $skip LIMIT $limit"
    )
    rs = await _read(cypher, {"uid": user_id, "skip": offset, "limit": limit})
    return [
        {"episode_id": r[0], "kind": r[1], "summary": r[2], "occurred_at": r[3],
         "conversation_id": r[4], "participants": r[5] or []}
        for r in _rows(rs)
    ]


async def list_preferences(*, user_id: int) -> list[dict]:
    """列出当前有效的用户偏好（valid_to 为空）。"""
    cypher = (
        f"MATCH (p:{S.PREFERENCE} {{user_id:$uid}}) "
        f"WHERE p.valid_to IS NULL "
        f"RETURN p.pref_id, p.key, p.value, p.confidence, p.valid_from ORDER BY p.key"
    )
    rs = await _read(cypher, {"uid": user_id})
    return [
        {"pref_id": r[0], "key": r[1], "value": r[2], "confidence": r[3], "valid_from": r[4]}
        for r in _rows(rs)
    ]


async def list_facts(
    *, user_id: int, entity_id: str | None = None, only_valid: bool = True,
    limit: int = 200, offset: int = 0,
) -> list[dict]:
    """列出事实；entity_id 给定时只返回该实体相关事实（经 SUBJECT/OBJECT 边）。"""
    valid_filter = " AND f.valid_to IS NULL" if only_valid else ""
    if entity_id:
        cypher = (
            f"MATCH (f:{S.FACT})-[:{S.SUBJECT}|{S.OBJECT}]->(e:{S.ENTITY} {{entity_id:$eid}}) "
            f"WHERE f.user_id=$uid{valid_filter} "
            f"RETURN f.fact_id, f.subject_id, f.predicate, f.object_text, f.valid_from, "
            f"f.valid_to, f.confidence, f.source_doc_id "
            f"ORDER BY f.created_at DESC SKIP $skip LIMIT $limit"
        )
        params = {"uid": user_id, "eid": entity_id, "skip": offset, "limit": limit}
    else:
        where_clause = "WHERE f.valid_to IS NULL " if only_valid else ""
        cypher = (
            f"MATCH (f:{S.FACT} {{user_id:$uid}}) "
            + where_clause
            + "RETURN f.fact_id, f.subject_id, f.predicate, f.object_text, f.valid_from, "
            "f.valid_to, f.confidence, f.source_doc_id "
            "ORDER BY f.created_at DESC SKIP $skip LIMIT $limit"
        )
        params = {"uid": user_id, "skip": offset, "limit": limit}
    rs = await _read(cypher, params)
    return [
        {"fact_id": r[0], "subject_id": r[1], "predicate": r[2], "object_text": r[3],
         "valid_from": r[4], "valid_to": r[5], "confidence": r[6], "source_doc_id": r[7]}
        for r in _rows(rs)
    ]


async def graph_neighborhood(*, user_id: int, limit: int = 80) -> dict:
    """力导向图谱数据：高置信/近期活跃的 Entity + 它们之间的 RELATES_TO/SAME_AS 边。"""
    nodes_q = (
        f"MATCH (e:{S.ENTITY} {{user_id:$uid}}) "
        f"RETURN e.entity_id, e.name, e.entity_type, e.confidence "
        f"ORDER BY e.confidence DESC, e.last_accessed_at DESC LIMIT $limit"
    )
    nodes_rs = await _read(nodes_q, {"uid": user_id, "limit": limit})
    entities = [
        {"id": r[0], "name": r[1], "entity_type": r[2], "confidence": r[3]}
        for r in _rows(nodes_rs)
    ]
    if not entities:
        return {"nodes": [], "edges": []}
    ids = [e["id"] for e in entities]
    edges_q = (
        f"MATCH (a:{S.ENTITY})-[r:{S.RELATES_TO}|{S.SAME_AS}]->(b:{S.ENTITY}) "
        f"WHERE a.entity_id IN $ids AND b.entity_id IN $ids "
        f"RETURN a.entity_id, type(r), b.entity_id, coalesce(r.weight, 1.0)"
    )
    edges_rs = await _read(edges_q, {"ids": ids})
    edges = [
        {"source": r[0], "type": r[1], "target": r[2], "weight": r[3]}
        for r in _rows(edges_rs)
    ]
    return {"nodes": entities, "edges": edges}


async def stats(user_id: int) -> dict:
    """各类记忆节点计数。"""
    cypher = (
        "MATCH (n) WHERE n.user_id=$uid "
        "RETURN labels(n)[0] AS label, count(n) AS cnt"
    )
    rs = await _read(cypher, {"uid": user_id})
    counts = {r[0]: r[1] for r in _rows(rs)}
    return {
        "entities": counts.get(S.ENTITY, 0),
        "facts": counts.get(S.FACT, 0),
        "episodes": counts.get(S.EPISODE, 0),
        "preferences": counts.get(S.PREFERENCE, 0),
        "chunks": counts.get(S.CHUNK, 0),
        "documents": counts.get(S.DOCUMENT, 0),
    }


# ---------------- 巩固辅助查询 ----------------

async def find_entity_by_name(*, user_id: int, name: str, entity_type: str | None = None) -> str | None:
    """按 user + name(+type) 找现有规范 Entity id（排除 SAME_AS 源节点），供消歧去重。"""
    cypher = (
        f"MATCH (e:{S.ENTITY} {{user_id:$uid, name:$name}}) "
        f"WHERE ($etype IS NULL OR e.entity_type = $etype) AND NOT (e)-[:{S.SAME_AS}]->() "
        f"RETURN e.entity_id LIMIT 1"
    )
    rs = await _read(cypher, {"uid": user_id, "name": name, "etype": entity_type})
    rows = _rows(rs)
    return rows[0][0] if rows else None


async def find_active_facts(*, user_id: int, subject_id: str, predicate: str) -> list[dict]:
    """找该主体+谓词的当前有效 Fact（valid_to 为空），供冲突检测。"""
    cypher = (
        f"MATCH (f:{S.FACT} {{user_id:$uid, subject_id:$sid, predicate:$pred}}) "
        f"WHERE f.valid_to IS NULL RETURN f.fact_id, f.object_text"
    )
    rs = await _read(cypher, {"uid": user_id, "sid": subject_id, "pred": predicate})
    return [{"fact_id": r[0], "object_text": r[1]} for r in _rows(rs)]


async def find_active_preference(*, user_id: int, key: str) -> dict | None:
    """找该 user+key 的当前有效 Preference（valid_to 为空），供首次/重复/版本化仲裁。"""
    cypher = (
        f"MATCH (p:{S.PREFERENCE} {{user_id:$uid, key:$key}}) "
        f"WHERE p.valid_to IS NULL RETURN p.pref_id, p.value"
    )
    rs = await _read(cypher, {"uid": user_id, "key": key})
    rows = _rows(rs)
    if not rows:
        return None
    return {"pref_id": rows[0][0], "value": rows[0][1]}


# ---------------- 内部：Cypher 执行辅助 ----------------

def _run(graph, cypher: str, params: dict | None = None):
    """执行 Cypher（写/读统一），返回 ResultSet。"""
    return graph.query(cypher, params=params or {})


def _rows(result_set) -> list[tuple]:
    """ResultSet → 行列表。FalkorDB SDK: result_set.result_set 是 list[list]。"""
    if result_set is None:
        return []
    data = getattr(result_set, "result_set", None) or []
    return [tuple(row) for row in data]


async def _write(cypher: str, params: dict) -> Any:
    return await asyncio.to_thread(lambda: _graph().query(cypher, params=params))


async def _read(cypher: str, params: dict | None = None) -> Any:
    return await asyncio.to_thread(lambda: _graph().ro_query(cypher, params=params or {}))
