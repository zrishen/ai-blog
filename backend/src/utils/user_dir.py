"""用户目录命名翻译：user_id → username。

目录用 username 命名便于人工维护。主库是 PostgreSQL(asyncpg)，无法在同步路径直接查，
故启动时全量加载 user_id → username 到内存缓存，`resolve_username` 同步查缓存；
注册/改名时 `refresh_user_in_cache` 保持新鲜。缓存 miss（如测试未 warm）回退 str(user_id)。
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import User

logger = logging.getLogger(__name__)

# user_id → username 内存缓存：bootstrap 启动 warm，注册/改名 refresh
_username_cache: dict[int, str] = {}


def resolve_username(user_id: int | str) -> str:
    """user_id → username，缓存 miss 回退 str(user_id)。字符串直接返回（已是 username）。"""
    if isinstance(user_id, str):
        return user_id
    return _username_cache.get(user_id) or str(user_id)


async def warm_username_cache(db: AsyncSession) -> int:
    """全量加载 user_id → username 到缓存（bootstrap 启动调），返回加载数。"""
    rows = (await db.execute(select(User.id, User.username))).all()
    _username_cache.clear()
    for uid, uname in rows:
        if uname:
            _username_cache[uid] = uname
    return len(_username_cache)


async def refresh_user_in_cache(db: AsyncSession, user_id: int) -> None:
    """单用户刷新（注册/改名后调）；用户已删则从缓存移除。"""
    uname = (await db.execute(select(User.username).where(User.id == user_id))).scalar_one_or_none()
    if uname:
        _username_cache[user_id] = uname
    else:
        _username_cache.pop(user_id, None)
