"""Alembic 迁移测试：init_db（alembic upgrade head）在全新 PG 上建完整 schema + 幂等。"""

import pytest
from sqlalchemy import inspect
from testcontainers.postgres import PostgresContainer

from src.config import settings


@pytest.mark.asyncio
async def test_init_db_builds_full_schema_and_is_idempotent(monkeypatch):
    """全新 PG 上跑两次 init_db()（alembic upgrade head），断言关键表/列存在 + 幂等不报错。"""
    with PostgresContainer("postgres:16-alpine") as pg:
        host = pg.get_container_host_ip()
        port = pg.get_exposed_port(5432)
        url = f"postgresql+asyncpg://test:test@{host}:{port}/test"
        monkeypatch.setattr(settings, "database_url", url)

        from sqlalchemy.ext.asyncio import create_async_engine

        from src.database.migrations import init_db

        await init_db()  # 首次：建表 + alembic_version
        await init_db()  # 再次：幂等

        eng = create_async_engine(url)
        try:
            def check(conn):
                insp = inspect(conn)
                tables = set(insp.get_table_names())
                assert {
                    "users", "conversations", "messages", "blog_posts", "blog_post_revisions",
                    "file_documents", "file_processing_jobs", "redemption_codes",
                    "subscription_weekly_usage", "workspace_nodes", "rag_sources",
                    "platform_plugins", "llm_settings", "public_chat_daily_usage",
                }.issubset(tables)
                # 旧幂等迁移概念已并入 baseline（models 含全部列）
                conv_cols = {c["name"] for c in insp.get_columns("conversations")}
                assert {"deleted_at", "summary", "summary_until_message_id"}.issubset(conv_cols)
                users_cols = {c["name"] for c in insp.get_columns("users")}
                assert {"is_admin", "is_super_admin", "subscription_expires_at"}.issubset(users_cols)
                assert "alembic_version" in tables
            async with eng.connect() as conn:
                await conn.run_sync(check)
        finally:
            await eng.dispose()
