"""bootstrap 初始管理员引导测试：_ensure_super_admin 幂等提升指定用户。"""

import pytest
from sqlalchemy import select

from src.bootstrap import _ensure_super_admin
from src.config import settings
from src.database.models import User
from src.utils.auth import verify_password


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
