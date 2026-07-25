"""认证模型：用户 + refresh token。"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from .base import Base, _utcnow


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class RefreshToken(Base):
    """Refresh token 记录：只存 SHA-256 哈希，支持吊销与过期。

    明文 token 只在签发时返回一次给客户端（HttpOnly cookie），DB 不保存明文，
    因此即便 DB 泄露，攻击者也无法直接复用 refresh token。
    """

    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    revoked_at = Column(DateTime, nullable=True)
