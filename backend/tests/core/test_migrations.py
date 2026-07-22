"""旧 SQLite 软删除字段迁移测试。"""

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from src.database import migrations
from src.database.models import Base
from src.utils.secret_crypto import decrypt_secret, is_encrypted_secret


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
                for table in (
                    "conversations",
                    "file_documents",
                    "blog_posts",
                    "file_processing_jobs",
                    "chat_attachments",
                )
            }

        schema = await connection.run_sync(inspect_schema)

    assert "deleted_at" in schema["conversations"]["columns"]
    assert "ix_conversations_user_deleted" in schema["conversations"]["indexes"]
    assert "deleted_at" in schema["file_documents"]["columns"]
    assert "ix_file_documents_user_deleted" in schema["file_documents"]["indexes"]
    assert "deleted_at" in schema["blog_posts"]["columns"]
    assert "ix_blog_posts_user_deleted" in schema["blog_posts"]["indexes"]
    assert {
        "ix_file_processing_jobs_user_status",
        "ix_file_processing_jobs_heartbeat",
        "ix_file_processing_jobs_source_document",
        "uq_file_processing_jobs_active_key",
        "uq_file_processing_jobs_user_request",
    }.issubset(schema["file_processing_jobs"]["indexes"])
    assert {
        "position",
        "extracted_text",
        "extraction_truncated",
    }.issubset(schema["chat_attachments"]["columns"])
    assert "uq_chat_attachments_message_position" in schema["chat_attachments"]["indexes"]

    await engine.dispose()


@pytest.mark.asyncio
async def test_init_db_encrypts_legacy_llm_api_keys_idempotently(tmp_path, monkeypatch):
    database_path = tmp_path / "legacy-key.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path}")
    monkeypatch.setattr(migrations, "engine", engine)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(
            text("INSERT INTO users (id, username, password_hash) VALUES (1, 'legacy', 'hash')")
        )
        await connection.execute(
            text(
                "INSERT INTO llm_settings (id, user_id, protocol, api_key) "
                "VALUES (1, 1, 'openai', 'legacy-plain-key')"
            )
        )

    await migrations.init_db()
    async with engine.connect() as connection:
        first_value = (await connection.execute(
            text("SELECT api_key FROM llm_settings WHERE id = 1")
        )).scalar_one()

    await migrations.init_db()
    async with engine.connect() as connection:
        second_value = (await connection.execute(
            text("SELECT api_key FROM llm_settings WHERE id = 1")
        )).scalar_one()

    assert is_encrypted_secret(first_value)
    assert decrypt_secret(first_value) == "legacy-plain-key"
    assert second_value == first_value

    await engine.dispose()
