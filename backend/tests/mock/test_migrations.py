"""旧 SQLite 软删除字段迁移测试。"""

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from src.database import migrations


@pytest.mark.asyncio
async def test_init_db_adds_deleted_columns_and_indexes_idempotently(tmp_path, monkeypatch):
    database_path = tmp_path / "legacy.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path}")
    monkeypatch.setattr(migrations, "engine", engine)

    async with engine.begin() as connection:
        await connection.execute(
            text("CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)")
        )
        await connection.execute(
            text("CREATE TABLE file_documents (id INTEGER PRIMARY KEY, user_id VARCHAR NOT NULL)")
        )
        await connection.execute(
            text("CREATE TABLE blog_posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)")
        )

    await migrations.init_db()
    await migrations.init_db()

    async with engine.connect() as connection:
        def inspect_schema(sync_connection):
            inspector = inspect(sync_connection)
            return {
                table: {
                    "columns": {column["name"] for column in inspector.get_columns(table)},
                    "indexes": {index["name"] for index in inspector.get_indexes(table)},
                }
                for table in ("conversations", "file_documents", "blog_posts")
            }

        schema = await connection.run_sync(inspect_schema)

    assert "deleted_at" in schema["conversations"]["columns"]
    assert "ix_conversations_user_deleted" in schema["conversations"]["indexes"]
    assert "deleted_at" in schema["file_documents"]["columns"]
    assert "ix_file_documents_user_deleted" in schema["file_documents"]["indexes"]
    assert "deleted_at" in schema["blog_posts"]["columns"]
    assert "ix_blog_posts_user_deleted" in schema["blog_posts"]["indexes"]

    await engine.dispose()
