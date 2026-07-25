"""兑换码生成 + 激活/续期测试。"""

from datetime import datetime, timedelta, timezone

import pytest

from src.database.models import User
from src.services.subscription import create_codes, generate_code, redeem


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def test_generate_code_length_and_alphabet():
    code = generate_code()
    assert len(code) == 12
    assert not any(c in code for c in "IO01")  # 不含歧义字符


@pytest.mark.asyncio
async def test_create_codes_batch_unique(db_session):
    admin = User(username="admin1", password_hash="h", is_admin=True)
    db_session.add(admin)
    await db_session.commit()

    codes = await create_codes(
        db_session, count=3, duration_days=30, created_by_admin_id=admin.id
    )
    assert len(codes) == 3
    assert len(set(codes)) == 3


@pytest.mark.asyncio
async def test_redeem_new_subscription(db_session):
    admin = User(username="admin2", password_hash="h")
    db_session.add(admin)
    await db_session.commit()
    codes = await create_codes(db_session, count=1, duration_days=30, created_by_admin_id=admin.id)

    user = User(username="u1", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    new_expires = await redeem(db_session, user_id=user.id, code_str=codes[0])
    assert new_expires is not None

    await db_session.refresh(user)
    assert user.subscription_expires_at is not None


@pytest.mark.asyncio
async def test_redeem_extends_active_subscription(db_session):
    admin = User(username="admin3", password_hash="h")
    db_session.add(admin)
    await db_session.commit()
    codes = await create_codes(db_session, count=1, duration_days=10, created_by_admin_id=admin.id)

    base = _naive_utc(datetime.now(timezone.utc) + timedelta(days=5))  # 未过期
    user = User(username="u2", password_hash="h", subscription_expires_at=base)
    db_session.add(user)
    await db_session.commit()

    new_expires = await redeem(db_session, user_id=user.id, code_str=codes[0])
    assert (new_expires - base).days == 10  # 叠加


@pytest.mark.asyncio
async def test_redeem_expired_starts_from_now(db_session):
    admin = User(username="admin4", password_hash="h")
    db_session.add(admin)
    await db_session.commit()
    codes = await create_codes(db_session, count=1, duration_days=7, created_by_admin_id=admin.id)

    past = _naive_utc(datetime.now(timezone.utc) - timedelta(days=1))
    user = User(username="u3", password_hash="h", subscription_expires_at=past)
    db_session.add(user)
    await db_session.commit()

    before = _naive_utc(datetime.now(timezone.utc))
    new_expires = await redeem(db_session, user_id=user.id, code_str=codes[0])
    assert new_expires > before
    assert (new_expires - before).days == 7  # now + 7（不是 past + 7）


@pytest.mark.asyncio
async def test_redeem_invalid_code_raises(db_session):
    user = User(username="u4", password_hash="h")
    db_session.add(user)
    await db_session.commit()

    with pytest.raises(ValueError, match="无效"):
        await redeem(db_session, user_id=user.id, code_str="NOTEXIST")


@pytest.mark.asyncio
async def test_redeem_used_code_raises(db_session):
    admin = User(username="admin5", password_hash="h")
    db_session.add(admin)
    await db_session.commit()
    codes = await create_codes(db_session, count=1, duration_days=30, created_by_admin_id=admin.id)

    user = User(username="u5", password_hash="h")
    db_session.add(user)
    await db_session.commit()
    await redeem(db_session, user_id=user.id, code_str=codes[0])

    user2 = User(username="u6", password_hash="h")
    db_session.add(user2)
    await db_session.commit()
    with pytest.raises(ValueError, match="已被使用"):
        await redeem(db_session, user_id=user2.id, code_str=codes[0])
