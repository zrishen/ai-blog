"""Auth API routes: register, login, refresh, logout, me.

- access token：短期 JWT，通过响应体返回，客户端存内存。
- refresh token：不透明随机串，通过 HttpOnly cookie 下发，仅随 /api/auth/* 请求携带；
  /refresh 用它换新 access；/logout 吊销服务端记录并清 cookie。
  路由前缀 /api/v1/auth。
"""

import logging
import secrets

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.database.models import User
from src.utils.auth import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    revoke_refresh_token,
    verify_password,
    verify_refresh_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_REFRESH_COOKIE = settings.refresh_cookie_name
_REFRESH_PATH = "/api/v1/auth"


class AuthRequest(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=4, max_length=100)


class RegisterRequest(AuthRequest):
    invite_code: str = Field(min_length=1, max_length=256)


class AuthResponse(BaseModel):
    access_token: str
    user: dict


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": user.is_admin,
        "is_super_admin": user.is_super_admin,
    }


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        _REFRESH_COOKIE,
        raw_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.refresh_token_expire_seconds,
        path=_REFRESH_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path=_REFRESH_PATH)


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    expected_invite_code = settings.registration_invite_code.strip()
    supplied_invite_code = body.invite_code.strip()
    if not expected_invite_code or not secrets.compare_digest(supplied_invite_code, expected_invite_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="邀请码无效或注册未开放",
        )

    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # 并发注册竞态：两个请求都通过上面的存在性检查，commit 时唯一约束触发
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")
    await db.refresh(user)

    # 入门文章为 best-effort：失败时仅记日志、不阻断注册，用户仍可正常登录，
    # 文章可由后台或下次登录补建，避免「用户已建、注册接口 500」的半注册状态。
    try:
        await _seed_intro_article(db, user.id)
    except Exception:
        logger.exception("为新用户创建入门文章失败 user_id=%s", user.id)

    access = create_access_token(user.id, user.username)
    refresh = await create_refresh_token(user.id, db)
    _set_refresh_cookie(response, refresh)
    return AuthResponse(access_token=access, user=_user_payload(user))


async def _seed_intro_article(db: AsyncSession, user_id: int):
    """为新注册用户创建一篇入门文章（来自官方介绍模板）。"""
    from src.services.blog.blog_service import create_post
    from src.services.user.official_intro_service import build_intro_post_payload

    intro_data = build_intro_post_payload()
    await create_post(db, intro_data, user_id)


@router.post("/login")
async def login(body: AuthRequest, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    access = create_access_token(user.id, user.username)
    refresh = await create_refresh_token(user.id, db)
    _set_refresh_cookie(response, refresh)
    return AuthResponse(access_token=access, user=_user_payload(user))


@router.post("/refresh")
async def refresh(
    response: Response,
    db: AsyncSession = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=_REFRESH_COOKIE),
):
    """用 HttpOnly cookie 里的 refresh token 换取新的 access token。"""
    user = await verify_refresh_token(refresh_token, db)
    if user is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已过期，请重新登录")
    access = create_access_token(user.id, user.username)
    return AuthResponse(access_token=access, user=_user_payload(user))


@router.post("/logout")
async def logout(
    response: Response,
    db: AsyncSession = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=_REFRESH_COOKIE),
):
    """吊销服务端 refresh token 记录并清除 cookie。"""
    await revoke_refresh_token(refresh_token, db)
    _clear_refresh_cookie(response)
    return {"status": "ok"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {**_user_payload(user), "created_at": user.created_at.isoformat()}
