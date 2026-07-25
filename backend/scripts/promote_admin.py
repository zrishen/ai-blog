"""提升用户为管理员（首个 admin 引导）。

用法::

    cd backend && uv run python scripts/promote_admin.py <username>
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# 允许 `python scripts/promote_admin.py` 直接运行时找到 src 包
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from src.database.models import User
from src.database.session import async_session

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("promote_admin")


async def promote(username: str) -> None:
    async with async_session() as db:
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user is None:
            logger.error("用户不存在: %s", username)
            raise SystemExit(1)
        if user.is_admin:
            logger.info("用户已是管理员: %s (id=%s)，无需操作", username, user.id)
            return
        user.is_admin = True
        await db.commit()
        logger.info("已提升为管理员: %s (id=%s)", username, user.id)


def main() -> None:
    parser = argparse.ArgumentParser(description="提升用户为管理员")
    parser.add_argument("username", help="目标用户名")
    args = parser.parse_args()
    asyncio.run(promote(args.username))


if __name__ == "__main__":
    main()
