"""workspace_lock per-user 跨进程文件锁单测（纯文件系统，无 DB）。"""

import asyncio

import pytest

from src.config import settings
from src.core.exceptions import ConflictError
from src.core.workspace_lock import workspace_lock


@pytest.mark.asyncio
async def test_release_allows_reacquire(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "workspace_root", str(tmp_path))
    async with workspace_lock(1):
        pass
    async with workspace_lock(1):
        pass


@pytest.mark.asyncio
async def test_concurrent_same_user_raises_conflict(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "workspace_root", str(tmp_path))
    started = asyncio.Event()
    proceed = asyncio.Event()

    async def hold() -> None:
        async with workspace_lock(1, timeout=0.4):
            started.set()
            await proceed.wait()

    holder = asyncio.create_task(hold())
    await started.wait()
    try:
        with pytest.raises(ConflictError):
            async with workspace_lock(1, timeout=0.4):
                pass
    finally:
        proceed.set()
        await holder


@pytest.mark.asyncio
async def test_different_users_do_not_block(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "workspace_root", str(tmp_path))
    async with workspace_lock(1, timeout=0.4):
        async with workspace_lock(2, timeout=0.4):
            pass
