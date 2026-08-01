"""用户目录命名翻译：user_id → username。

目录用 username 命名便于人工维护；同步查询 SQLite 解析，查不到（如测试内存 DB）回退 str(user_id)。
"""

import logging
import sqlite3
from functools import lru_cache

from src.config import settings

logger = logging.getLogger(__name__)


def _sqlite_db_path() -> str | None:
    url = settings.database_url
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return None


@lru_cache(maxsize=1024)
def resolve_username(user_id: int | str) -> str:
    """user_id → username，找不到回退到 str(user_id)。"""
    if isinstance(user_id, str):
        # 已经是字符串（如 FileDocument.user_id），可能是历史 username 直接传入
        return user_id

    db_path = _sqlite_db_path()
    if not db_path or db_path == ":memory:":
        return str(user_id)

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        logger.debug("resolve_username 查询失败，回退到 str(user_id): user_id=%s", user_id, exc_info=True)

    return str(user_id)
