"""数据库初始化 + 幂等迁移（SQLite 兼容）。

策略：使用 `Base.metadata.create_all` 创建缺失的表/列/索引（SQLAlchemy 对新增表会自动建；
对已存在表中新增的列不会自动加列，所以这里手写幂等 ALTER TABLE / CREATE INDEX）。
"""

import logging

from sqlalchemy import inspect, text

from src.database.models import Base
from src.database.session import engine
from src.utils.secret_crypto import encrypt_secret, is_encrypted_secret

logger = logging.getLogger(__name__)


_IDEMPOTENT_COLUMNS = {
    "conversations": [
        ("deleted_at", "DATETIME"),
        ("summary", "TEXT"),
        ("summary_until_message_id", "INTEGER"),
    ],
    "file_documents": [("deleted_at", "DATETIME")],
    "file_processing_jobs": [
        ("auto_index", "BOOLEAN NOT NULL DEFAULT 0"),
        ("target_resource_type", "VARCHAR(20)"),
        ("target_resource_id", "INTEGER"),
    ],
    "blog_posts": [
        ("deleted_at", "DATETIME"),
        ("published_revision_id", "INTEGER"),
    ],
    "chat_attachments": [
        ("position", "INTEGER"),
        ("extracted_text", "TEXT"),
        ("extraction_truncated", "BOOLEAN NOT NULL DEFAULT 0"),
    ],
    "users": [
        ("is_admin", "BOOLEAN NOT NULL DEFAULT 0"),
        ("is_super_admin", "BOOLEAN NOT NULL DEFAULT 0"),
        ("subscription_expires_at", "DATETIME"),
    ],
}

_IDEMPOTENT_INDEXES = {
    "ix_conversations_user_deleted": ("conversations", ["user_id", "deleted_at"], False),
    "ix_file_documents_user_deleted": ("file_documents", ["user_id", "deleted_at"], False),
    "ix_blog_posts_user_deleted": ("blog_posts", ["user_id", "deleted_at"], False),
    "ix_blog_posts_published_revision": ("blog_posts", ["published_revision_id"], False),
    "ix_file_processing_jobs_user_status": ("file_processing_jobs", ["user_id", "status"], False),
    "ix_file_processing_jobs_heartbeat": ("file_processing_jobs", ["heartbeat_at"], False),
    "ix_file_processing_jobs_source_document": ("file_processing_jobs", ["source_document_id"], False),
    "uq_file_processing_jobs_active_key": ("file_processing_jobs", ["active_key"], True),
    "uq_file_processing_jobs_user_request": ("file_processing_jobs", ["user_id", "client_request_id"], True),
    "uq_chat_attachments_message_position": ("chat_attachments", ["message_id", "position"], True),
}


def _column_exists(inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _index_exists(inspector, table: str, index_name: str) -> bool:
    return any(idx["name"] == index_name for idx in inspector.get_indexes(table))


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # 开发阶段不保留旧的“用户自定义 MCP”记录。新模型没有引用该表，
        # 因而可幂等删除，避免任何用户旧配置再次成为可执行入口。
        await conn.execute(text("DROP TABLE IF EXISTS mcp_servers"))

        def _apply_idempotent(conn_sync):
            insp = inspect(conn_sync)
            for table, columns in _IDEMPOTENT_COLUMNS.items():
                if not insp.has_table(table):
                    continue
                for column, coltype in columns:
                    if not _column_exists(insp, table, column):
                        conn_sync.execute(
                            text(f'ALTER TABLE {table} ADD COLUMN {column} {coltype}')
                        )
                        logger.info("Migration: added column %s.%s", table, column)

            for index_name, (table, cols, unique) in _IDEMPOTENT_INDEXES.items():
                if not insp.has_table(table):
                    continue
                if not _index_exists(insp, table, index_name):
                    cols_sql = ", ".join(cols)
                    unique_sql = "UNIQUE " if unique else ""
                    conn_sync.execute(
                        text(f'CREATE {unique_sql}INDEX IF NOT EXISTS {index_name} ON {table} ({cols_sql})')
                    )
                    logger.info("Migration: created index %s on %s", index_name, table)

        await conn.run_sync(_apply_idempotent)

        rows = (await conn.execute(
            text("SELECT id, api_key FROM llm_settings WHERE api_key IS NOT NULL AND api_key != ''")
        )).mappings().all()
        migrated_count = 0
        for row in rows:
            if is_encrypted_secret(row["api_key"]):
                continue
            await conn.execute(
                text("UPDATE llm_settings SET api_key = :api_key WHERE id = :id"),
                {"api_key": encrypt_secret(row["api_key"]), "id": row["id"]},
            )
            migrated_count += 1
        if migrated_count:
            logger.info("Migration: encrypted %d legacy LLM API keys", migrated_count)
