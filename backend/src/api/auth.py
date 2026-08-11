"""Auth API routes: register, login, refresh, logout, me.

access token 短期 JWT 走响应体；refresh token 走 HttpOnly cookie（仅 /api/v1/auth 下携带），/refresh 换新、/logout 吊销。
"""

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.database.models import User
from src.utils.auth import (
    create_access_token,
    create_refresh_token,
    find_refresh_token,
    get_current_user,
    hash_password,
    revoke_all_user_refresh_tokens,
    revoke_refresh_token,
    verify_password,
)
from src.utils.rate_limit import check_rate_limit
from src.utils.user_dir import validate_user_directory_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_REFRESH_COOKIE = settings.refresh_cookie_name
_REFRESH_PATH = "/api/v1/auth"


class AuthRequest(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=4, max_length=100)


class RegisterRequest(AuthRequest):
    invite_code: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=8, max_length=100)

    @field_validator("username")
    @classmethod
    def _validate_workspace_directory_name(cls, value: str) -> str:
        return validate_user_directory_name(value)

    @model_validator(mode="after")
    def _validate_password_strength(self) -> "RegisterRequest":
        if not re.search(r"[A-Za-z]", self.password) or not re.search(r"\d", self.password):
            raise ValueError("密码至少 8 位，且需同时包含字母和数字")
        return self


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


def _resolve_cookie_secure(request: Request) -> bool:
    """refresh cookie 的 secure：配置显式覆盖优先；未设则按请求协议推导。

    防 HTTP 生产漏配——运维无需配置，HTTPS 部署自动 secure，本地 HTTP 自动可写。
    反向代理终止 TLS 时上游 scheme 可能仍是 http，读 X-Forwarded-Proto 兜底。
    """
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    if request.url.scheme == "https":
        return True
    forwarded = request.headers.get("x-forwarded-proto", "")
    return forwarded.split(",")[0].strip() == "https"


def _set_refresh_cookie(response: Response, request: Request, raw_token: str) -> None:
    response.set_cookie(
        _REFRESH_COOKIE,
        raw_token,
        httponly=True,
        secure=_resolve_cookie_secure(request),
        samesite=settings.cookie_samesite,
        max_age=settings.refresh_token_expire_seconds,
        path=_REFRESH_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path=_REFRESH_PATH)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _client_ip(request: Request) -> str:
    """取客户端 IP，仅用于日志/限流（反代场景读到的是上游 IP）。"""
    return request.client.host if request.client else "unknown"


def _enforce_auth_rate_limit(request: Request, action: str) -> None:
    """per-IP 滑动窗口频率限制：防登录撞库与注册/邀请码暴力尝试，超限返 429。"""
    ip = _client_ip(request)
    limit = (
        settings.auth_login_rate_limit if action == "login" else settings.auth_register_rate_limit
    )
    bucket = f"{action}:{ip}"
    if not check_rate_limit(
        bucket, limit=limit, window_seconds=settings.auth_rate_limit_window_seconds
    ):
        logger.warning("auth rate limited action=%s ip=%s", action, ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="操作过于频繁，请稍后再试",
        )


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    _enforce_auth_rate_limit(request, "register")
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

    # 入门文章 best-effort：失败仅记日志不阻断注册，避免「用户已建、注册接口 500」的半注册状态
    try:
        await _seed_intro_article(db, user.id)
    except Exception:
        logger.exception("为新用户创建入门文章失败 user_id=%s", user.id)

    access = create_access_token(user.id, user.username)
    refresh = await create_refresh_token(user.id, db)
    _set_refresh_cookie(response, request, refresh)
    logger.info("register ok username=%s ip=%s user_id=%s", body.username, _client_ip(request), user.id)
    return AuthResponse(access_token=access, user=_user_payload(user))


async def _seed_intro_article(db: AsyncSession, user_id: int):
    """为新注册用户创建一篇入门文章（来自官方介绍模板）。"""
    from src.services.workspace.blog.blog_service import create_post
    from src.services.accounts.user.official_intro_service import build_intro_post_payload

    intro_data = build_intro_post_payload()
    await create_post(db, intro_data, user_id)


@router.post("/login")
async def login(
    body: AuthRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    _enforce_auth_rate_limit(request, "login")
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        logger.warning("login fail username=%s ip=%s", body.username, _client_ip(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    access = create_access_token(user.id, user.username)
    refresh = await create_refresh_token(user.id, db)
    _set_refresh_cookie(response, request, refresh)
    logger.info("login ok username=%s ip=%s user_id=%s", body.username, _client_ip(request), user.id)
    return AuthResponse(access_token=access, user=_user_payload(user))


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=_REFRESH_COOKIE),
):
    """用 cookie refresh 换新 access，并轮换 refresh（旧 token 即时吊销、下发新 token）。

    重用检测带宽限期：被吊销的 refresh 在宽限期内被重用，视为多标签页近同时刷新的合法
    并发竞态，宽容换新；超宽限期才判定 token 被窃取，吊销该用户全部 refresh。
    """
    record = await find_refresh_token(refresh_token, db)
    now = _now_utc()
    if record is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已过期，请重新登录")
    if record.revoked_at is not None:
        reused_age = now - record.revoked_at
        if reused_age > timedelta(seconds=settings.refresh_rotation_grace_seconds):
            # 旧 token 在宽限期外被重用 → 判定 token 被窃取，强制全设备登出
            logger.warning(
                "refresh reuse detected user_id=%s reused_age=%.0fs grace=%ss revoke=all",
                record.user_id,
                reused_age.total_seconds(),
                settings.refresh_rotation_grace_seconds,
            )
            await revoke_all_user_refresh_tokens(record.user_id, db)
            _clear_refresh_cookie(response)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效，请重新登录")
        # 宽限期内重用 → 多标签页并发刷新竞态，宽容换新（落到下方轮换）
    elif record.expires_at < now:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已过期，请重新登录")

    user = await db.get(User, record.user_id)
    if user is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已过期，请重新登录")

    # 轮换：吊销当前 token（宽容换新时已吊销则跳过）+ 签发新 refresh
    if record.revoked_at is None:
        record.revoked_at = now
        await db.commit()
    new_refresh = await create_refresh_token(user.id, db)
    _set_refresh_cookie(response, request, new_refresh)
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
