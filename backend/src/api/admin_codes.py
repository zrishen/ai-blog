"""管理员兑换码管理 API：生成 / 列表 / 作废。所有端点需 require_admin。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.database.models import User
from src.database.session import async_session
from src.services.admin.codes_service import list_codes, revoke_code
from src.services.subscription import create_codes
from src.utils.auth import require_admin

router = APIRouter(prefix="/admin/codes", tags=["admin"])


class GenerateCodesRequest(BaseModel):
    count: int = Field(..., ge=1, le=100)
    duration_days: int = Field(..., ge=1, le=365)
    note: str | None = None


class GenerateCodesResponse(BaseModel):
    codes: list[str]


class CodeItem(BaseModel):
    id: int
    code: str
    duration_days: int
    is_used: bool
    used_by_user_id: int | None = None
    created_at: datetime
    note: str | None = None


class ListCodesResponse(BaseModel):
    items: list[CodeItem]
    offset: int
    limit: int


@router.post("/", response_model=GenerateCodesResponse)
async def generate_codes(
    payload: GenerateCodesRequest,
    user: User = Depends(require_admin),
) -> GenerateCodesResponse:
    """批量生成兑换码，返回明文码列表（仅这一次可见）。"""
    async with async_session() as db:
        codes = await create_codes(
            db,
            count=payload.count,
            duration_days=payload.duration_days,
            created_by_admin_id=user.id,
            note=payload.note,
        )
    return GenerateCodesResponse(codes=codes)


@router.get("/", response_model=ListCodesResponse)
async def list_codes_endpoint(
    used: bool | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    _: User = Depends(require_admin),
) -> ListCodesResponse:
    """兑换码列表（按 created_at desc，支持 used 筛选与分页）。"""
    async with async_session() as db:
        codes = await list_codes(db, used=used, offset=offset, limit=limit)
    return ListCodesResponse(
        items=[
            CodeItem(
                id=c.id,
                code=c.code,
                duration_days=c.duration_days,
                is_used=c.is_used,
                used_by_user_id=c.used_by_user_id,
                created_at=c.created_at,
                note=c.note,
            )
            for c in codes
        ],
        offset=offset,
        limit=limit,
    )


@router.delete("/{code_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_code_endpoint(
    code_id: int,
    _: User = Depends(require_admin),
) -> None:
    """作废未使用的兑换码（删除）。已使用的码不可作废。"""
    async with async_session() as db:
        try:
            await revoke_code(db, code_id)
        except LookupError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
