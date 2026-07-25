"""兑换码管理 API 测试：生成 / 列表（含 used 筛选）/ 作废 + require_admin 守卫。

service 层用 db_session 直测（admin 端点体用 async_session，测试环境无表）；
require_admin 守卫用独立 sub-app 挂载 router 验证（admin_codes_router 由 wire agent 注册到 routes.py）。
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.api.admin_codes import router as admin_codes_router
from src.database.models import RedemptionCode, User
from src.services.admin.codes_service import list_codes, revoke_code
from src.services.subscription import create_codes
from src.utils.auth import get_current_user


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


# --- service 层：生成 + 列表 ---


@pytest.mark.asyncio
async def test_create_codes_then_list_all(db_session):
    admin = User(username="admin_gen", password_hash="h", is_admin=True)
    db_session.add(admin)
    await db_session.commit()

    codes = await create_codes(
        db_session, count=3, duration_days=30, created_by_admin_id=admin.id, note="batch1"
    )
    assert len(codes) == 3
    assert len(set(codes)) == 3  # 唯一

    listed = await list_codes(db_session)
    assert len(listed) == 3
    assert {c.code for c in listed} == set(codes)
    assert all(c.duration_days == 30 for c in listed)
    assert all(c.note == "batch1" for c in listed)
    assert all(c.created_by_admin_id == admin.id for c in listed)


@pytest.mark.asyncio
async def test_list_codes_order_desc_and_used_filter(db_session):
    admin = User(username="admin_list", password_hash="h", is_admin=True)
    db_session.add(admin)
    await db_session.commit()

    now = _naive_utc(datetime.now(timezone.utc))
    old_unused = RedemptionCode(
        code="OLDUNUSED", duration_days=30, is_used=False,
        created_at=now - timedelta(days=2), created_by_admin_id=admin.id,
    )
    new_unused = RedemptionCode(
        code="NEWUNUSED", duration_days=30, is_used=False,
        created_at=now, created_by_admin_id=admin.id,
    )
    mid_used = RedemptionCode(
        code="MIDUSED", duration_days=30, is_used=True, used_by_user_id=admin.id,
        used_at=now, created_at=now - timedelta(days=1), created_by_admin_id=admin.id,
    )
    db_session.add_all([old_unused, new_unused, mid_used])
    await db_session.commit()

    # 全部：created_at desc → NEW, MID, OLD
    all_codes = await list_codes(db_session)
    assert [c.code for c in all_codes] == ["NEWUNUSED", "MIDUSED", "OLDUNUSED"]

    # used=True → 仅 MID
    used_only = await list_codes(db_session, used=True)
    assert [c.code for c in used_only] == ["MIDUSED"]

    # used=False → NEW, OLD（desc）
    unused_only = await list_codes(db_session, used=False)
    assert [c.code for c in unused_only] == ["NEWUNUSED", "OLDUNUSED"]


@pytest.mark.asyncio
async def test_list_codes_pagination(db_session):
    admin = User(username="admin_page", password_hash="h", is_admin=True)
    db_session.add(admin)
    await db_session.commit()

    base = _naive_utc(datetime.now(timezone.utc))
    for i in range(3):
        db_session.add(RedemptionCode(
            code=f"PG{i}", duration_days=10, is_used=False,
            created_at=base - timedelta(days=i), created_by_admin_id=admin.id,
        ))
    await db_session.commit()

    page1 = await list_codes(db_session, offset=0, limit=2)
    page2 = await list_codes(db_session, offset=2, limit=2)
    assert len(page1) == 2
    assert len(page2) == 1
    assert {c.code for c in page1}.isdisjoint({c.code for c in page2})
    assert {c.code for c in page1} | {c.code for c in page2} == {"PG0", "PG1", "PG2"}


# --- service 层：作废 ---


@pytest.mark.asyncio
async def test_revoke_code_unused_success(db_session):
    code = RedemptionCode(code="REVOKEOK", duration_days=30, is_used=False)
    db_session.add(code)
    await db_session.commit()
    cid = code.id

    await revoke_code(db_session, cid)
    assert await db_session.get(RedemptionCode, cid) is None  # 已删除


@pytest.mark.asyncio
async def test_revoke_code_used_raises_value_error(db_session):
    code = RedemptionCode(code="REVOKEUSED", duration_days=30, is_used=True)
    db_session.add(code)
    await db_session.commit()

    with pytest.raises(ValueError, match="已使用"):
        await revoke_code(db_session, code.id)
    # 已使用的码保留（审计痕迹），不删除
    assert await db_session.get(RedemptionCode, code.id) is not None


@pytest.mark.asyncio
async def test_revoke_code_not_found_raises_lookup_error(db_session):
    with pytest.raises(LookupError):
        await revoke_code(db_session, 99999)


# --- 集成：require_admin 守卫 ---
# admin_codes_router 由 wire agent 注册到 routes.py；此处用独立 sub-app 挂载 router，
# 不依赖全局注册顺序，验证所有端点的 require_admin 守卫（非 admin 一律 403）。


@pytest.mark.asyncio
async def test_admin_codes_endpoints_require_admin():
    non_admin = User(username="plain", password_hash="h", is_admin=False)

    async def _as_plain():
        return non_admin

    sub_app = FastAPI()
    sub_app.include_router(admin_codes_router, prefix="/api/v1")
    sub_app.dependency_overrides[get_current_user] = _as_plain

    transport = ASGITransport(app=sub_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r_post = await ac.post("/api/v1/admin/codes/", json={"count": 5, "duration_days": 30})
        r_get = await ac.get("/api/v1/admin/codes/")
        r_del = await ac.delete("/api/v1/admin/codes/1")
    assert r_post.status_code == 403
    assert r_get.status_code == 403
    assert r_del.status_code == 403
