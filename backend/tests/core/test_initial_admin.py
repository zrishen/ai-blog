"""bootstrap 初始管理员引导测试：_ensure_initial_admin 幂等提升指定用户。"""

import pytest
from sqlalchemy import select

from src.bootstrap import _ensure_initial_admin
from src.config import settings
from src.database.models import User


@pytest.mark.asyncio
async def test_initial_admin_promotes_existing_user(db_session, monkeypatch):
    monkeypatch.setattr(settings, "initial_admin_username", "bootstrap-admin")
    db_session.add(User(username="bootstrap-admin", password_hash="h", is_admin=False))
    await db_session.commit()

    await _ensure_initial_admin(db_session)

    result = await db_session.execute(select(User).where(User.username == "bootstrap-admin"))
    assert result.scalar_one().is_admin is True


@pytest.mark.asyncio
async def test_initial_admin_idempotent_when_already_admin(db_session, monkeypatch):
    monkeypatch.setattr(settings, "initial_admin_username", "already-admin")
    db_session.add(User(username="already-admin", password_hash="h", is_admin=True))
    await db_session.commit()

    await _ensure_initial_admin(db_session)  # 已是 admin，幂等不报错

    result = await db_session.execute(select(User).where(User.username == "already-admin"))
    assert result.scalar_one().is_admin is True


@pytest.mark.asyncio
async def test_initial_admin_skips_when_user_missing(db_session, monkeypatch):
    monkeypatch.setattr(settings, "initial_admin_username", "ghost")
    # 用户不存在 → 仅跳过，不报错不阻断
    await _ensure_initial_admin(db_session)


@pytest.mark.asyncio
async def test_initial_admin_noop_when_unset(db_session):
    # initial_admin_username 为空/None → 不处理
    await _ensure_initial_admin(db_session)
