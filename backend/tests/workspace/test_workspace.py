"""RAG state tests that remain after virtual workspace nodes were removed."""

from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import FileDocument
from src.services.workspace import rag_service
from src.services.workspace.blog.blog_service import create_post

TEST_USER_ID = 1


@pytest.mark.asyncio
async def test_add_to_ai_knowledge_is_idempotent(db_session: AsyncSession):
    first = await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=42
    )
    second = await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=42
    )

    assert first.id == second.id
    assert second.index_status == "pending"


@pytest.mark.asyncio
async def test_mark_indexed_and_stale(db_session: AsyncSession):
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=7
    )
    indexed = await rag_service.mark_indexed(
        db_session, TEST_USER_ID, "blog_post", 7, version="fingerprint"
    )
    stale = await rag_service.mark_stale(db_session, TEST_USER_ID, "blog_post", 7)

    assert indexed.indexed_version == "fingerprint"
    assert stale is not None and stale.index_status == "stale"


@pytest.mark.asyncio
async def test_ai_knowledge_hides_soft_deleted_blog(db_session: AsyncSession):
    post = await create_post(
        db_session,
        {"title": "Private", "slug": "private", "content": "body"},
        TEST_USER_ID,
    )
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="blog_post", resource_id=post.id
    )
    post.deleted_at = datetime.now()
    await db_session.commit()

    assert await rag_service.list_ai_knowledge(db_session, TEST_USER_ID) == []


@pytest.mark.asyncio
async def test_ai_knowledge_hides_soft_deleted_file(db_session: AsyncSession):
    document = FileDocument(
        collection_name="user_1",
        user_id="1",
        original_name="private.pdf",
        file_path="private.store",
        chunk_content="",
        meta="",
    )
    db_session.add(document)
    await db_session.commit()
    await rag_service.add_to_ai_knowledge(
        db_session, TEST_USER_ID, resource_type="file", resource_id=document.id
    )
    document.deleted_at = datetime.now()
    await db_session.commit()

    assert await rag_service.list_ai_knowledge(db_session, TEST_USER_ID) == []
