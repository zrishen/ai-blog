"""Per-user 跨进程文件锁：串行化同一用户的 workspace 写操作。

锁文件位于 <workspace_root>/.locks/<user_id>.lock，与用户内容树隔离；
portalocker 文件锁随进程退出由 OS 自动释放，崩溃不泄漏。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import portalocker

from src.config import settings
from src.core.exceptions import ConflictError

DEFAULT_TIMEOUT = 3.0


def _lock_path(user_id: int) -> Path:
    root = Path(settings.workspace_root) / ".locks"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{user_id}.lock"


@asynccontextmanager
async def workspace_lock(user_id: int, *, timeout: float = DEFAULT_TIMEOUT):
    lock = portalocker.Lock(str(_lock_path(user_id)), timeout=timeout)
    try:
        await asyncio.to_thread(lock.acquire)
    except portalocker.LockException as exc:
        raise ConflictError("Workspace is busy, retry later") from exc
    try:
        yield
    finally:
        await asyncio.to_thread(lock.release)
