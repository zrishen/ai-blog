"""bootstrap 初始管理员引导测试：_ensure_initial_admin 幂等提升指定用户。"""

import pytest
from sqlalchemy import select

from src.bootstrap import _ensure_initial_admin, _ensure_super_admin
from src.config import settings
from src.database.models import User
from src.utils.auth import verify_password


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


@pytest.mark.asyncio
async def test_super_admin_creates_configured_account(db_session, monkeypatch):
    monkeypatch.setattr(settings, "super_admin_username", "root")
    monkeypatch.setattr(settings, "super_admin_password", "strong-password")

    await _ensure_super_admin(db_session)

    result = await db_session.execute(select(User).where(User.username == "root"))
    user = result.scalar_one()
    assert user.is_admin is True
    assert user.is_super_admin is True
    assert verify_password("strong-password", user.password_hash)


@pytest.mark.asyncio
async def test_super_admin_promotes_existing_user_without_resetting_password(db_session, monkeypatch):
    monkeypatch.setattr(settings, "super_admin_username", "existing")
    monkeypatch.setattr(settings, "super_admin_password", "configured-password")
    user = User(username="existing", password_hash="original-hash", is_admin=False)
    db_session.add(user)
    await db_session.commit()

    await _ensure_super_admin(db_session)

    await db_session.refresh(user)
    assert user.is_admin is True
    assert user.is_super_admin is True
    assert user.password_hash == "original-hash"


@pytest.mark.asyncio
async def test_super_admin_skips_when_credentials_are_incomplete(db_session, monkeypatch):
    monkeypatch.setattr(settings, "super_admin_username", "root")
    monkeypatch.setattr(settings, "super_admin_password", "")

    await _ensure_super_admin(db_session)

    result = await db_session.execute(select(User).where(User.username == "root"))
    assert result.scalar_one_or_none() is None
