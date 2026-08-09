"""用户目录命名翻译：user_id → username。

目录用 username 命名便于人工维护。主库是 PostgreSQL(asyncpg)，无法在同步路径直接查，
故启动时全量加载 user_id → username 到内存缓存，`resolve_username` 同步查缓存；
注册/改名时 `refresh_user_in_cache` 保持新鲜。缓存 miss（如测试未 warm）回退 str(user_id)。
"""

import logging
from pathlib import PurePosixPath, PureWindowsPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import User

logger = logging.getLogger(__name__)

# user_id → username 内存缓存：bootstrap 启动 warm，注册/改名 refresh
_username_cache: dict[int, str] = {}

_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_WINDOWS_FORBIDDEN_CHARS = frozenset('<>:"/\\|?*')


def validate_user_directory_name(username: str) -> str:
    """Return a username only when it is safe as one cross-platform path segment.

    Usernames are intentionally human-readable workspace directory names.  Validate
    even values read from the DB/cache so legacy or manually inserted rows cannot
    turn an owner root into a path outside the configured storage root.
    """
    if not isinstance(username, str) or not username:
        raise ValueError("用户名不能为空")
    if username in {".", ".."} or username != username.strip() or username.endswith("."):
        raise ValueError("用户名不能作为安全目录名")
    if any(ord(char) < 32 or char in _WINDOWS_FORBIDDEN_CHARS for char in username):
        raise ValueError("用户名包含目录不支持的字符")

    posix = PurePosixPath(username)
    windows = PureWindowsPath(username)
    if posix.parts != (username,) or windows.parts != (username,) or windows.drive or windows.root:
        raise ValueError("用户名必须是单个目录名")

    if username.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise ValueError("用户名是 Windows 保留设备名")
    return username


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
