"""用户服务 —— 系统用户管理等。"""

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import User
from src.utils.auth import hash_password


async def ensure_system_user(db: AsyncSession) -> User:
    """确保系统用户 ai-blog 存在（不可登录）。"""
    stmt = select(User).where(User.username == "ai-blog")
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(
        username="ai-blog",
        password_hash=hash_password(secrets.token_urlsafe(32)),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
