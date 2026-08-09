"""Tests for explicit, no-scheduler blog-document promotion preparation."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.config import settings
from src.core import path_guard
from src.database.models import BlogPost, RagSource, User
from src.services.workspace.blog.blog_document_backfill_service import backfill_blog_post_document
from src.services.workspace.blog.blog_document_promotion_service import (
    preflight_blog_document_promotion,
    run_blog_document_promotion_batch,
)


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    monkeypatch.setattr(path_guard, "resolve_username", lambda user_id: f"owner-{user_id}")
    return root


def _session_factory(db: AsyncSession) -> async_sessionmaker[AsyncSession]:
    assert db.bind is not None
    return async_sessionmaker(db.bind, class_=AsyncSession, expire_on_commit=False)


async def _add_user(db: AsyncSession, user_id: int, username: str) -> User:
    user = User(id=user_id, username=username, password_hash="hash")
    db.add(user)
    await db.flush()
    return user


def _post(*, user_id: int, slug: str, state: str = "legacy", deleted: bool = False) -> BlogPost:
    return BlogPost(
        user_id=user_id,
        title=slug.replace("-", " ").title(),
        slug=slug,
        content=f"{slug} body",
        status="draft",
        author="Owner",
        created_at=datetime(2025, 2, 3, 4, 5, 6),
        content_storage_state=state,
        deleted_at=datetime(2025, 2, 4) if deleted else None,
    )


@pytest.mark.asyncio
async def test_preflight_reports_invalid_and_normalized_username_blockers_and_state_completeness(
    db_session: AsyncSession,
):
    await _add_user(db_session, 71, "valid-user")
    await _add_user(db_session, 72, "bad/name")
    await _add_user(db_session, 73, "Cafe\u0301")
    await _add_user(db_session, 74, "Café")
    db_session.add_all(
        [
            _post(user_id=71, slug="legacy"),
            _post(user_id=71, slug="verified", state="verified"),
            _post(user_id=71, slug="error", state="error"),
            _post(user_id=71, slug="deleted", deleted=True),
        ]
    )
    await db_session.commit()

    preflight = await preflight_blog_document_promotion(db_session)

    assert preflight.total_active_posts == 3
    assert (preflight.legacy_posts, preflight.verified_posts, preflight.error_posts) == (1, 1, 1)
    assert not preflight.is_complete
    assert {blocker.code for blocker in preflight.blockers} == {
        "invalid_username",
        "normalized_username_collision",
    }
    collision = next(blocker for blocker in preflight.blockers if blocker.code == "normalized_username_collision")
    assert collision.user_ids == (73, 74)


@pytest.mark.asyncio
async def test_promotion_batch_stops_before_processing_an_identity_blocker(
    db_session: AsyncSession,
    workspace: Path,
):
    owner = await _add_user(db_session, 75, "unsafe/name")
    post = _post(user_id=owner.id, slug="blocked")
    db_session.add(post)
    await db_session.commit()

    result = await run_blog_document_promotion_batch(_session_factory(db_session), limit=10)
    await db_session.refresh(post)

    assert result.blocked
    assert result.scanned == result.processed == 0
    assert result.next_id is None
    assert post.content_storage_state == "legacy"
    assert not (workspace / "owner-75" / "posts" / "blocked.md").exists()


@pytest.mark.asyncio
async def test_promotion_batch_is_resumable_skips_errors_and_only_stales_sha_rag_sources(
    db_session: AsyncSession,
    workspace: Path,
):
    owner = await _add_user(db_session, 76, "promotion-owner")
    legacy = _post(user_id=owner.id, slug="legacy")
    verified = _post(user_id=owner.id, slug="verified")
    errored = _post(user_id=owner.id, slug="error", state="error")
    chunk_count_version = _post(user_id=owner.id, slug="chunk-count")
    pending = _post(user_id=owner.id, slug="pending")
    stale = _post(user_id=owner.id, slug="stale")
    failed = _post(user_id=owner.id, slug="failed")
    deleted = _post(user_id=owner.id, slug="deleted", deleted=True)
    db_session.add_all([legacy, verified, errored, chunk_count_version, pending, stale, failed, deleted])
    await db_session.commit()

    await backfill_blog_post_document(db_session, post_id=verified.id, user_id=owner.id)
    db_session.add_all(
        [
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=legacy.id,
                index_status="active",
                indexed_version="0" * 64,
                collection_name="user_76_blog",
            ),
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=verified.id,
                index_status="active",
                indexed_version=verified.content_sha256,
                collection_name="user_76_blog",
            ),
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=errored.id,
                index_status="active",
                indexed_version="f" * 64,
                collection_name="user_76_blog",
            ),
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=chunk_count_version.id,
                index_status="active",
                indexed_version="2",
                collection_name="user_76_blog",
            ),
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=pending.id,
                index_status="pending",
                indexed_version="e" * 64,
                collection_name="user_76_blog",
            ),
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=stale.id,
                index_status="stale",
                indexed_version="d" * 64,
                collection_name="user_76_blog",
            ),
            RagSource(
                user_id=owner.id,
                resource_type="blog_post",
                resource_id=failed.id,
                index_status="failed",
                indexed_version="c" * 64,
                collection_name="user_76_blog",
            ),
        ]
    )
    await db_session.commit()

    factory = _session_factory(db_session)
    first = await run_blog_document_promotion_batch(factory, limit=2)

    assert not first.blocked
    assert (first.scanned, first.processed, first.exported, first.reverified) == (2, 2, 1, 1)
    assert first.skipped_error == first.failed == 0
    assert first.next_id == verified.id
    assert first.stale_marked == 1

    await db_session.refresh(legacy)
    legacy_source = (
        await db_session.execute(select(RagSource).where(RagSource.resource_id == legacy.id))
    ).scalar_one()
    assert legacy.content_storage_state == "verified"
    assert legacy_source is not None and legacy_source.index_status == "stale"
    assert (workspace / "owner-76" / "posts" / "legacy.md").exists()

    second = await run_blog_document_promotion_batch(factory, cursor=first.next_id, limit=10)

    assert second.next_id is None
    assert (second.scanned, second.processed, second.exported, second.reverified) == (5, 4, 4, 0)
    assert second.skipped_error == 1
    assert second.failed == second.stale_marked == 0
    await db_session.refresh(chunk_count_version)
    chunk_count_source = (
        await db_session.execute(select(RagSource).where(RagSource.resource_id == chunk_count_version.id))
    ).scalar_one()
    assert chunk_count_version.content_storage_state == "verified"
    assert chunk_count_source.index_status == "active"
    for post, expected_status in ((pending, "pending"), (stale, "stale"), (failed, "failed")):
        source = (
            await db_session.execute(select(RagSource).where(RagSource.resource_id == post.id))
        ).scalar_one()
        assert source.index_status == expected_status
