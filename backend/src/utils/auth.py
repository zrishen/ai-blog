"""Auth utilities: password hashing, access/refresh tokens, dependencies.

access token 短期 JWT；refresh token 明文仅签发时返回一次，DB 只存 SHA-256 哈希。
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

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
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "username": username,
        "type": "access",
        "exp": now + timedelta(seconds=settings.access_token_expire_seconds),
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_preview_token(user_id: int, filename: str) -> str:
    """签发预览专用弱权限 token（type=preview，绑定 filename）。

    用于 PDF iframe 等必须把凭证放 URL 的场景：泄露后仅能预览该用户该文件，
    无法调用其它需认证接口，filename 绑定也防越权预览其它文件。
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "preview",
        "filename": filename,
        "exp": now + timedelta(seconds=settings.preview_token_expire_seconds),
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(UTC).replace(tzinfo=None)


async def create_refresh_token(user_id: int, db: AsyncSession) -> str:
    """生成新的 refresh token，DB 存哈希，返回明文（仅此一次交给 cookie）。"""
    raw = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=_hash_refresh_token(raw),
            expires_at=_naive_utc(datetime.now(UTC) + timedelta(seconds=settings.refresh_token_expire_seconds)),
        )
    )
    await db.commit()
    return raw


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload


def decode_preview_token(token: str, expected_filename: str) -> dict | None:
    """校验预览 token：签名有效 + type=preview + filename 绑定一致。"""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "preview":
        return None
    if payload.get("filename") != expected_filename:
        return None
    return payload


async def verify_refresh_token(raw: str | None, db: AsyncSession) -> User | None:
    """用 cookie 里的明文 refresh 查 DB 哈希，校验未过期、未吊销，返回所属用户。"""
    if not raw:
        return None
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw)))
    record = result.scalar_one_or_none()
    if record is None or record.revoked_at is not None:
        return None
    if record.expires_at < _naive_utc(datetime.now(UTC)):
        return None
    user = await db.get(User, record.user_id)
    return user


async def revoke_refresh_token(raw: str | None, db: AsyncSession) -> None:
    """登出时吊销对应 refresh token 记录。"""
    if not raw:
        return
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw)))
    record = result.scalar_one_or_none()
    if record is not None and record.revoked_at is None:
        record.revoked_at = _naive_utc(datetime.now(UTC))
        await db.commit()


async def find_refresh_token(raw: str | None, db: AsyncSession) -> RefreshToken | None:
    """按明文查 refresh 记录（含已吊销），供 /refresh 做轮换 / 重用检测。"""
    if not raw:
        return None
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_refresh_token(raw)))
    return result.scalar_one_or_none()


async def revoke_all_user_refresh_tokens(user_id: int, db: AsyncSession) -> None:
    """吊销该用户所有未吊销的 refresh token（重用检测 / 退出所有设备用）。"""
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
    )
    now = _naive_utc(datetime.now(UTC))
    for record in result.scalars().all():
        record.revoked_at = now
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
) -> User | None:
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
