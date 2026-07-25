"""Auth utilities: password hashing, access/refresh tokens, dependencies.

- access token：短期 JWT（payload 带 type=access），客户端存内存，用于接口鉴权。
- refresh token：不透明随机串，DB 只存 SHA-256 哈希，客户端放 HttpOnly cookie，
  用于换取新 access token；可吊销、可过期。
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.engine import get_db
from src.database.models import RefreshToken, User

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
_optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: int, username: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "type": "access",
        "exp": now + timedelta(seconds=settings.access_token_expire_seconds),
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


async def create_refresh_token(user_id: int, db: AsyncSession) -> str:
    """生成新的 refresh token，DB 存哈希，返回明文（仅此一次交给 cookie）。"""
    raw = secrets.token_urlsafe(48)
    db.add(RefreshToken(
        user_id=user_id,
        token_hash=_hash_refresh_token(raw),
        expires_at=_naive_utc(datetime.now(timezone.utc) + timedelta(seconds=settings.refresh_token_expire_seconds)),
    ))
    await db.commit()
    return raw


def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload


async def verify_refresh_token(raw: str | None, db: AsyncSession) -> Optional[User]:
    """用 cookie 里的明文 refresh 查 DB 哈希，校验未过期、未吊销，返回所属用户。"""
    if not raw:
        return None
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw))
    )
    record = result.scalar_one_or_none()
    if record is None or record.revoked_at is not None:
        return None
    if record.expires_at < _naive_utc(datetime.now(timezone.utc)):
        return None
    user = await db.get(User, record.user_id)
    return user


async def revoke_refresh_token(raw: str | None, db: AsyncSession) -> None:
    """登出时吊销对应 refresh token 记录。"""
    if not raw:
        return
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw))
    )
    record = result.scalar_one_or_none()
    if record is not None and record.revoked_at is None:
        record.revoked_at = _naive_utc(datetime.now(timezone.utc))
        await db.commit()


async def get_current_user(
    token: str = Depends(_oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user = await db.get(User, int(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


async def get_optional_user(
    token: str | None = Depends(_optional_oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """可选认证：与 get_current_user 逻辑相同但不抛 401，未认证时返回 None。"""
    if not token:
        return None

    payload = decode_access_token(token)
    if payload is None:
        return None

    user_id = payload.get("sub")
    if user_id is None:
        return None

    user = await db.get(User, int(user_id))
    if user is None:
        return None
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """后台守卫：普通管理员和超级管理员均可访问。"""
    if not user.is_admin and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    """超级管理员守卫：仅用于管理员角色授权与撤销。"""
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要超级管理员权限")
    return user
