"""数据库初始化：走 Alembic 版本化迁移。

`init_db` 执行 `alembic upgrade head`（0001 create_all baseline + 0002 加密旧明文 key）。
schema 唯一源是 `src.database.models.Base.metadata`；baseline 用 metadata.create_all，
后续结构变更走 `alembic revision --autogenerate` 生成增量 revision。
"""

import asyncio
import logging

from alembic.config import Config

from alembic import command
from src.config import BASE_DIR

logger = logging.getLogger(__name__)


def _alembic_config() -> Config:
    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "alembic"))
    return cfg


async def init_db() -> None:
    """执行 Alembic 迁移到 head（同步命令放线程，避免阻塞事件循环）。"""
    cfg = _alembic_config()
    await asyncio.to_thread(command.upgrade, cfg, "head")
