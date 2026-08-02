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
    """recall 单条结果。"""
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
    """slug → 合法的向量属性名（embedding_<slug>）。"""
    return "embedding_" + "".join(c if c.isalnum() else "_" for c in slug)


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


async def ensure_vector_index(embedding_model_slug: str, dim: int) -> None:
    """按 embedding 模型 slug 幂等建 Chunk 向量索引（维度隔离：每模型一个 embedding_<slug> 属性）。"""

    def _exists(g, prop: str) -> bool:
        result = _run(
            g,
            "CALL db.indexes() "
            "YIELD label, properties, types, entitytype "
            "RETURN label, properties, types, entitytype",
        )
        for label, properties, types, entitytype in _rows(result):
            index_properties = [properties] if isinstance(properties, str) else (properties or [])
            if isinstance(types, Mapping):
                index_types = [
                    index_type
                    for property_types in types.values()
                    for index_type in (
                        property_types
                        if isinstance(property_types, (list, tuple, set))
                        else [property_types]
                    )
                ]
            else:
                index_types = [types] if isinstance(types, str) else (types or [])
            if (
                label == S.CHUNK
                and prop in index_properties
                and "VECTOR" in {str(index_type).upper() for index_type in index_types}
                and str(entitytype).upper() == "NODE"
            ):
                return True
        return False

    def _do() -> None:
        g = _graph()
        prop = _safe_prop(embedding_model_slug)
        if _exists(g, prop):
            return
        try:
            g.create_node_vector_index(S.CHUNK, prop, dim=dim, similarity_function="cosine")
        except ResponseError:
            # Another backend worker may create the same index after our check.
            if _exists(g, prop):
                return
            raise

    await asyncio.to_thread(_do)


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
        f"source_doc_id:$sdoc, created_at:$now}})",
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
        f"occurred_at:$occ, conversation_id:$cid, message_id:$mid, participants:$parts, created_at:$now}})",
        params,
    )
    return eid


async def add_preference(*, user_id: int, key: str, value: str, confidence: float = 1.0) -> str:
    pid = _new_id()
    await _write(
        f"CREATE (p:{S.PREFERENCE} {{pref_id:$pid, user_id:$uid, key:$key, value:$val, "
        f"confidence:$conf, valid_from:$vf, valid_to:$vt}})",
        {"pid": pid, "uid": user_id, "key": key, "val": value, "conf": confidence,
         "vf": _now_iso(), "vt": None},
    )
    return pid


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
            f"c.stored_name=$stored, c.content=$content, c.{prop}=$emb, c.resource_type=$rt, "
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
        cypher = (
            f"CALL db.idx.vector.queryNodes('{S.CHUNK}', '{prop}', $k, $vec) "
            f"YIELD node, score WHERE node.user_id=$uid AND node.stored_name IN $wl "
            f"RETURN node.content, node.stored_name, node.source, score ORDER BY score LIMIT $k"
        )
        rs = _run(g, cypher, {"k": top_k, "vec": query_embedding, "uid": user_id, "wl": wl})
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
    """大脑 recall：① 向量召回 Top-K Chunk ② 沿 MENTIONS 扩展 1 跳到 Entity ③ 返回原文 + 关联实体。"""
    top_k = top_k or settings.memory_recall_top_k
    prop = _safe_prop(embedding_model)
    wl = list(whitelist_stored_names) if whitelist_stored_names else None

    def _do() -> list[MemoryHit]:
        g = _graph()
        where = "WHERE node.user_id=$uid"
        if wl is not None:
            where += " AND node.stored_name IN $wl"
        cypher = (
            f"CALL db.idx.vector.queryNodes('{S.CHUNK}', '{prop}', $k, $vec) YIELD node, score "
            f"{where} "
            f"OPTIONAL MATCH (node)-[:{S.MENTIONS}]->(e:{S.ENTITY}) "
            f"RETURN node.content, node.source, score, collect(e.name) AS entities "
            f"ORDER BY score LIMIT $k"
        )
        rs = _run(g, cypher, {"k": top_k, "vec": query_embedding, "uid": user_id, "wl": wl})
        hits: list[MemoryHit] = []
        for row in _rows(rs):
            content = row[0]
            entities = row[3] or []
            if entities:
                content = content + "\n关联实体: " + ", ".join(entities)
            hits.append(MemoryHit(content=content, kind="chunk", score=row[2],
                                  metadata={"source": row[1], "entities": entities}))
        return hits

    return await asyncio.to_thread(_do)


async def traverse(*, start_ids: list[str], hops: int, edge_types: list[str] | None = None) -> list[dict]:
    """通用多跳图遍历（供 recall/可视化/高级查询）。返回 {node, depth} 列表。"""
    edges = "|".join(edge_types) if edge_types else f"{S.RELATES_TO}|{S.MENTIONS}|{S.INVOLVES}|{S.SUPERSEDES}"
    cypher = (
        f"MATCH (n) WHERE n.entity_id IN $ids OR n.fact_id IN $ids OR n.episode_id IN $ids "
        f"MATCH (n)-[:{edges}*1..{hops}]-(m) RETURN DISTINCT m"
    )
    rs = await _read(cypher, {"ids": start_ids})
    return [{"node": r[0]} for r in _rows(rs)]


# ---------------- 运维 ----------------

async def list_user_collections(user_id: int) -> list[str]:
    rs = await _read(
        f"MATCH (c:{S.CHUNK} {{user_id:$uid}}) RETURN DISTINCT c.collection_name",
        {"uid": user_id},
    )
    return [r[0] for r in _rows(rs)]


async def delete_subgraph(*, user_id: int, resource_type: str, resource_id: int) -> int:
    await _write(
        f"MATCH (c:{S.CHUNK} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) DETACH DELETE c",
        {"uid": user_id, "rt": resource_type, "rid": resource_id},
    )
    return 0


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
    await _write(
        f"MATCH (d:{S.DOCUMENT} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) DETACH DELETE d",
        params,
    )
    await _write(
        f"MATCH (c:{S.CHUNK} {{user_id:$uid, resource_type:$rt, resource_id:$rid}}) DETACH DELETE c",
        params,
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
    """按 user + name(+type) 找现有 Entity id，供消歧去重。"""
    cypher = (
        f"MATCH (e:{S.ENTITY} {{user_id:$uid, name:$name}}) "
        f"WHERE $etype IS NULL OR e.entity_type = $etype "
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
