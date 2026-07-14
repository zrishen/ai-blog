"""数据库初始化 + 幂等迁移（SQLite 兼容）。

策略：使用 `Base.metadata.create_all` 创建缺失的表/列/索引（SQLAlchemy 对新增表会自动建；
对已存在表中新增的列不会自动加列，所以这里手写幂等 ALTER TABLE / CREATE INDEX）。
"""

import logging

from sqlalchemy import inspect, text

from src.database.models import Base
from src.database.session import engine

logger = logging.getLogger(__name__)


_IDEMPOTENT_COLUMNS = {
    "conversations": ("deleted_at", "DATETIME"),
    "file_documents": ("deleted_at", "DATETIME"),
    "blog_posts": ("deleted_at", "DATETIME"),
}

_IDEMPOTENT_INDEXES = {
    "ix_conversations_user_deleted": ("conversations", ["user_id", "deleted_at"], False),
    "ix_file_documents_user_deleted": ("file_documents", ["user_id", "deleted_at"], False),
    "ix_blog_posts_user_deleted": ("blog_posts", ["user_id", "deleted_at"], False),
    "ix_file_processing_jobs_user_status": ("file_processing_jobs", ["user_id", "status"], False),
    "ix_file_processing_jobs_heartbeat": ("file_processing_jobs", ["heartbeat_at"], False),
    "ix_file_processing_jobs_source_document": ("file_processing_jobs", ["source_document_id"], False),
    "uq_file_processing_jobs_active_key": ("file_processing_jobs", ["active_key"], True),
    "uq_file_processing_jobs_user_request": ("file_processing_jobs", ["user_id", "client_request_id"], True),
}


def _column_exists(inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _index_exists(inspector, table: str, index_name: str) -> bool:
    return any(idx["name"] == index_name for idx in inspector.get_indexes(table))


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        def _apply_idempotent(conn_sync):
            insp = inspect(conn_sync)
            for table, (column, coltype) in _IDEMPOTENT_COLUMNS.items():
                if not insp.has_table(table):
                    continue
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
