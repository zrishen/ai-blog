"""兑换码管理 service：列表查询 + 作废（admin 后台用）；生成/激活在 services.subscription。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import RedemptionCode


async def list_codes(
    db: AsyncSession,
    *,
    used: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[RedemptionCode]:
    """查询兑换码列表：按 created_at desc，used 筛选（None 不过滤）+ offset/limit 分页。"""
    stmt = select(RedemptionCode).order_by(RedemptionCode.created_at.desc())
    if used is not None:
        stmt = stmt.where(RedemptionCode.is_used == used)
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def revoke_code(db: AsyncSession, code_id: int) -> None:
    """作废兑换码 = 删除未使用的码；码不存在抛 LookupError，已使用抛 ValueError（保留审计痕迹）。"""
    code = await db.get(RedemptionCode, code_id)
    if code is None:
        raise LookupError("兑换码不存在")
    if code.is_used:
        raise ValueError("已使用的兑换码不能作废")
    await db.delete(code)
    await db.commit()
