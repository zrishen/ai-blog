"""Periodic maintenance for the AI brain."""

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost, FileDocument, RagSource
from src.database.session import async_session
from src.services.memory import graph_store

logger = logging.getLogger(__name__)

_maintenance_task: asyncio.Task | None = None


async def decay_memories() -> int:
    """Lower confidence for memories that have not been accessed recently."""
    threshold = (graph_store._utcnow() - timedelta(days=settings.memory_decay_days)).isoformat()
    rs = await graph_store._write(
        "MATCH (n) WHERE n.last_accessed_at IS NOT NULL AND n.last_accessed_at < $threshold "
        "AND n.confidence > 0.1 SET n.confidence = n.confidence * 0.5 RETURN count(n)",
        {"threshold": threshold},
    )
    rows = graph_store._rows(rs)
    count = rows[0][0] if rows else 0
    if count:
        logger.info("Brain decay: %d memories confidence lowered", count)
    return count


async def _resource_exists(
    db: AsyncSession,
    *,
    user_id: int,
    resource_type: str,
    resource_id: int,
) -> bool:
    if resource_type == "file":
        document = await db.get(FileDocument, resource_id)
        return bool(
            document
            and document.deleted_at is None
            and str(document.user_id) == str(user_id)
        )
    if resource_type == "blog_post":
        post = await db.get(BlogPost, resource_id)
        return bool(post and post.deleted_at is None and post.user_id == user_id)
    return False


async def _schedule_reindex(
    db: AsyncSession,
    *,
    user_id: int,
    resource_type: str,
    resource_id: int,
) -> None:
    from src.services.workspace import rag_service

    if resource_type == "file":
        await rag_service.index_file_document(db, user_id, resource_id)
    elif resource_type == "blog_post":
        await rag_service.index_blog_post(db, user_id, resource_id)


async def _reconcile_orphans_in_session(db: AsyncSession) -> int:
    """Remove graph state whose business record is gone and flag missing graph indexes."""
    changes = 0
    graph_resources = await graph_store.list_resource_memory()
    sources = list((await db.execute(select(RagSource))).scalars().all())
    source_keys = {
        (source.user_id, source.resource_type, source.resource_id): source
        for source in sources
    }
    processed: set[tuple[int, str, int]] = set()
    to_reindex: list[tuple[int, str, int]] = []

    for resource in graph_resources:
        key = (resource["user_id"], resource["resource_type"], resource["resource_id"])
        if await _resource_exists(
            db,
            user_id=key[0],
            resource_type=key[1],
            resource_id=key[2],
        ) and key in source_keys:
            continue
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
        exists = await _resource_exists(
            db,
            user_id=key[0],
            resource_type=key[1],
            resource_id=key[2],
        )
        if not exists:
            await graph_store.delete_resource_memory(
                user_id=key[0],
                resource_type=key[1],
                resource_id=key[2],
            )
            await db.delete(source)
            changes += 1
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
    for user_id, resource_type, resource_id in to_reindex:
        try:
            await _schedule_reindex(
                db,
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
        except Exception:
            logger.exception(
                "Failed to schedule brain reindex for %s/%s", resource_type, resource_id
            )
    return changes


async def reconcile_orphans(db: AsyncSession | None = None) -> int:
    if db is not None:
        return await _reconcile_orphans_in_session(db)
    async with async_session() as session:
        return await _reconcile_orphans_in_session(session)


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
