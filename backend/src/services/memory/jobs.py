"""Periodic maintenance and explicit reindexing for the AI brain."""

import argparse
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost, FileDocument, RagSource
from src.database.session import async_session
from src.services.memory import graph_store, memory_embeddings, schema

logger = logging.getLogger(__name__)

_maintenance_task: asyncio.Task | None = None


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


async def decay_memories() -> int:
    """衰减长期未访问记忆的 confidence（用进废退：recall 命中 touch 强化对冲 decay）。

    作用范围由节点属性隐式界定（FalkorDB 不支持多 label，无需显式匹配）：
    - Entity / Fact / Preference：有 confidence + last_accessed_at，参与用进废退（高频 touch 强化、低频衰减）。
    - Episode 隐式排除：无 confidence（n.confidence > 0.1 对 null 为 false），其遗忘靠 rerank recency。
    - Chunk 隐式排除：原文层无 last_accessed_at。
    - protected 排除：brain 手动修正 / SUPERSEDES 权威值不衰减。
    """
    threshold = (graph_store._utcnow() - timedelta(days=settings.memory_decay_days)).isoformat()
    rs = await graph_store._write(
        "MATCH (n) WHERE n.last_accessed_at IS NOT NULL AND n.last_accessed_at < $threshold "
        "AND n.confidence > 0.1 AND NOT COALESCE(n.protected, false) "
        "SET n.confidence = n.confidence * 0.5 RETURN count(n)",
        {"threshold": threshold},
    )
    rows = graph_store._rows(rs)
    count = rows[0][0] if rows else 0
    if count:
        logger.info("Brain decay: %d memories confidence lowered", count)
    return count


async def _resource_state(
    db: AsyncSession,
    *,
    user_id: int,
    resource_type: str,
    resource_id: int,
) -> str:
    """业务记录状态：absent=已硬删（彻底没了）；soft_deleted=在回收站（deleted_at 有值）；
    active=正常存在。软删文件保留其 RagSource，让回收站恢复时能据此重建向量——
    否则维护任务会把回收站文件误当孤儿清掉归属，导致恢复后回不到 AI 知识库。"""
    if resource_type == "file":
        document = await db.get(FileDocument, resource_id)
        if document is None or str(document.user_id) != str(user_id):
            return "absent"
        return "soft_deleted" if document.deleted_at is not None else "active"
    if resource_type == "blog_post":
        post = await db.get(BlogPost, resource_id)
        if post is None or post.user_id != user_id:
            return "absent"
        return "soft_deleted" if post.deleted_at is not None else "active"
    return "absent"


async def _reconcile_orphans_in_session(db: AsyncSession) -> int:
    """Remove graph state whose business record is gone and flag missing graph indexes."""
    changes = 0
    graph_resources = await graph_store.list_resource_memory()
    sources = list((await db.execute(select(RagSource))).scalars().all())
    source_keys = {(source.user_id, source.resource_type, source.resource_id): source for source in sources}
    processed: set[tuple[int, str, int]] = set()
    to_reindex: list[tuple[int, str, int]] = []

    for resource in graph_resources:
        key = (resource["user_id"], resource["resource_type"], resource["resource_id"])
        state = await _resource_state(
            db,
            user_id=key[0],
            resource_type=key[1],
            resource_id=key[2],
        )
        # active 且有归属：正常保留；soft_deleted：回收站文件保留 graph 记忆（restore 时重建）
        if (state == "active" and key in source_keys) or state == "soft_deleted":
            continue
        # absent：业务记录已硬删，graph 记忆是孤儿
        await graph_store.delete_resource_memory(
            user_id=key[0],
            resource_type=key[1],
            resource_id=key[2],
        )
        source = source_keys.get(key)
        if source is not None:
            await db.delete(source)
        processed.add(key)
        changes += 1

    for key, source in source_keys.items():
        if key in processed:
            continue
        state = await _resource_state(
            db,
            user_id=key[0],
            resource_type=key[1],
            resource_id=key[2],
        )
        if state == "absent":
            await graph_store.delete_resource_memory(
                user_id=key[0],
                resource_type=key[1],
                resource_id=key[2],
            )
            await db.delete(source)
            changes += 1
        elif state == "soft_deleted":
            # 回收站文件：保留归属，不重建向量（等用户恢复时由 restore job 重建）
            continue
        elif source.index_status == "active" and not await graph_store.has_resource_memory(
            user_id=key[0],
            resource_type=key[1],
            resource_id=key[2],
        ):
            source.index_status = "stale"
            source.error_message = "FalkorDB index is missing; reindex required"
            to_reindex.append(key)
            changes += 1

    if changes:
        await db.commit()
        logger.info("Brain reconciliation applied %d repair(s)", changes)
    if to_reindex:
        from src.services.workspace.rag_service import schedule_reindex_for_source

    for user_id, resource_type, resource_id in to_reindex:
        try:
            job = await schedule_reindex_for_source(
                db,
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
            if job is None:
                logger.warning(
                    "No brain reindex handler for resource type %s/%s",
                    resource_type,
                    resource_id,
                )
        except Exception:
            logger.exception("Failed to schedule brain reindex for %s/%s", resource_type, resource_id)
    return changes


async def reconcile_orphans(db: AsyncSession | None = None) -> int:
    if db is not None:
        return await _reconcile_orphans_in_session(db)
    async with async_session() as session:
        return await _reconcile_orphans_in_session(session)


async def reindex_all(
    *,
    user_id: int | None = None,
    kinds: list[str] | None = None,
    batch_size: int | None = None,
    force: bool = False,
) -> memory_embeddings.EmbeddingIndexReport:
    """显式补齐当前 embedding 模型空间，不加入周期维护以避免意外成本。"""
    return await memory_embeddings.reindex_all(
        user_id=user_id,
        kinds=kinds,
        batch_size=batch_size,
        force=force,
    )


# SAME_AS 源节点的边重定向到 canonical：(edge, 对端 label, 方向)。FalkorDB 要求节点带 label，
# 故按边类型固定对端 label（MENTIONS←Chunk / SUBJECT|OBJECT←Fact / INVOLVES←Episode /
# SOURCES←Document / RELATES_TO→Entity）；SAME_AS 自身边不迁移。
_SAME_AS_REDIRECTS = (
    (schema.MENTIONS, schema.CHUNK, "in"),
    (schema.SUBJECT, schema.FACT, "in"),
    (schema.OBJECT, schema.FACT, "in"),
    (schema.INVOLVES, schema.EPISODE, "in"),
    (schema.SOURCES, schema.DOCUMENT, "in"),
    (schema.RELATES_TO, schema.ENTITY, "out"),
)


async def merge_same_as(*, user_id: int | None = None, dry_run: bool = False) -> dict:
    """合并 SAME_AS 历史源实体到 canonical：边重定向 + 属性合并 + 删源。

    B 修复前 consolidate_entity 会新建重复实体 src 并 src-[:SAME_AS]->canonical；修复后
    不再产生新源，本命令清理存量——把 src 的图边 MERGE 到 canonical（去重），合并 src 的
    aliases/description/confidence，再 DETACH DELETE src。recall/find/list 已只用 canonical，
    迁移仅为消脏边、统一锚点。dry_run 只统计不执行。
    """
    where = "WHERE src.user_id = canonical.user_id"
    params: dict = {}
    if user_id is not None:
        where += " AND src.user_id = $uid"
        params["uid"] = user_id
    pairs_rs = await graph_store._read(
        f"MATCH (src:{schema.ENTITY})-[:{schema.SAME_AS}]->(canonical:{schema.ENTITY}) "
        f"{where} RETURN src.entity_id, canonical.entity_id, src.user_id",
        params,
    )
    pairs = graph_store._rows(pairs_rs)

    if dry_run:
        return {"mode": "dry_run", "source_nodes": len(pairs)}

    merged = 0
    for src_id, canon_id, uid in pairs:
        sp: dict = {"uid": uid, "sid": src_id, "cid": canon_id}
        pair_match = (
            f"MATCH (src:{schema.ENTITY} {{user_id:$uid, entity_id:$sid}})"
            f"-[:{schema.SAME_AS}]->(canon:{schema.ENTITY} {{user_id:$uid, entity_id:$cid}}) "
        )
        for edge, label, direction in _SAME_AS_REDIRECTS:
            if direction == "in":
                await graph_store._write(
                    pair_match + f"MATCH (x:{label} {{user_id:$uid}})-[:{edge}]->(src) MERGE (x)-[:{edge}]->(canon)",
                    sp,
                )
            else:
                await graph_store._write(
                    pair_match + f"MATCH (src)-[:{edge}]->(y:{label} {{user_id:$uid}}) "
                    f"WHERE y.entity_id <> $cid "  # 防自环：src-RELATES_TO->canon 不重定向成 canon->canon
                    f"MERGE (canon)-[:{edge}]->(y)",
                    sp,
                )
        prop_rs = await graph_store._read(
            f"MATCH (src:{schema.ENTITY} {{user_id:$uid, entity_id:$sid}}), "
            f"(canon:{schema.ENTITY} {{user_id:$uid, entity_id:$cid}}) "
            f"RETURN src.aliases, src.description, src.confidence, "
            f"canon.aliases, canon.description, canon.confidence",
            sp,
        )
        prop_rows = graph_store._rows(prop_rs)
        if prop_rows:
            s_aliases, s_desc, s_conf, c_aliases, c_desc, c_conf = prop_rows[0]
            merged_aliases: list = []
            for alias in (*(c_aliases or []), *(s_aliases or [])):
                if alias and alias not in merged_aliases:
                    merged_aliases.append(alias)
            merged_desc = c_desc or s_desc or ""
            confs = [c for c in (c_conf, s_conf) if isinstance(c, (int, float))]
            merged_conf = max(confs) if confs else 0
            await graph_store._write(
                f"MATCH (canon:{schema.ENTITY} {{user_id:$uid, entity_id:$cid}}) "
                "SET canon.aliases = $aliases, canon.description = $desc, canon.confidence = $conf",
                {**sp, "aliases": merged_aliases, "desc": merged_desc, "conf": merged_conf},
            )
        await graph_store._write(
            f"MATCH (src:{schema.ENTITY} {{user_id:$uid, entity_id:$sid}}) DETACH DELETE src",
            sp,
        )
        merged += 1

    if merged:
        logger.info("Brain SAME_AS merge: %d source node(s) merged into canonical", merged)
    return {"mode": "execute", "source_nodes_merged": merged}


async def run_maintenance() -> None:
    await decay_memories()
    await reconcile_orphans()


async def _maintenance_loop() -> None:
    while True:
        await asyncio.sleep(max(1.0, settings.memory_maintenance_interval_seconds))
        try:
            await run_maintenance()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Brain maintenance failed; it will retry on the next interval")


def schedule_maintenance() -> None:
    global _maintenance_task
    if _maintenance_task and not _maintenance_task.done():
        return
    task = asyncio.create_task(_maintenance_loop(), name="brain-maintenance")
    _maintenance_task = task

    def clear_finished(finished: asyncio.Task) -> None:
        global _maintenance_task
        if _maintenance_task is finished:
            _maintenance_task = None

    task.add_done_callback(clear_finished)


def _build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AI 大脑维护任务")
    subparsers = parser.add_subparsers(dest="command", required=True)
    reindex = subparsers.add_parser("reindex-all", help="补齐当前 embedding 模型的节点向量")
    scope = reindex.add_mutually_exclusive_group(required=True)
    scope.add_argument("--user-id", type=_positive_int)
    scope.add_argument("--all-users", action="store_true")
    reindex.add_argument(
        "--kind",
        action="append",
        choices=list(schema.VECTOR_KIND_ORDER),
        dest="kinds",
    )
    reindex.add_argument("--batch-size", type=_positive_int)
    reindex.add_argument("--force", action="store_true")

    merge = subparsers.add_parser("merge-same-as", help="合并 SAME_AS 历史源实体到 canonical")
    merge_scope = merge.add_mutually_exclusive_group(required=True)
    merge_scope.add_argument("--user-id", type=_positive_int)
    merge_scope.add_argument("--all-users", action="store_true")
    merge.add_argument("--dry-run", action="store_true")
    return parser


async def _run_cli() -> int:
    args = _build_cli_parser().parse_args()
    if not await graph_store.ping():
        logger.error("FalkorDB unavailable; %s aborted", args.command)
        return 1
    if args.command == "reindex-all":
        report = await reindex_all(
            user_id=None if args.all_users else args.user_id,
            kinds=args.kinds,
            batch_size=args.batch_size,
            force=args.force,
        )
        logger.info(
            "Brain reindex completed: selected=%d embedded=%d skipped=%d failed=%d by_kind=%s",
            report.selected,
            report.embedded,
            report.skipped,
            report.failed,
            report.by_kind,
        )
        return 0
    if args.command == "merge-same-as":
        result = await merge_same_as(
            user_id=None if args.all_users else args.user_id,
            dry_run=args.dry_run,
        )
        logger.info("Brain SAME_AS merge result: %s", result)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_run_cli()))
