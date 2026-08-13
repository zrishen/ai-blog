"""平台插件与用户启用关系：MCP 运行配置只属于平台管理员，用户仅保存是否启用（数据模型层隔离）。"""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow


class PlatformPlugin(Base):
    __tablename__ = "platform_plugins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(40), nullable=False, default="Blocks")
    transport: Mapped[str] = mapped_column(String(20), nullable=False)
    command: Mapped[str | None] = mapped_column(Text, nullable=True)
    args: Mapped[str | None] = mapped_column(Text, nullable=True)
    env_vars: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    tools: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    permission_level: Mapped[str] = mapped_column(String(20), nullable=False, default="read")
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_admin_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)


class UserPlugin(Base):
    __tablename__ = "user_plugins"
    __table_args__ = (UniqueConstraint("user_id", "plugin_id", name="uq_user_plugins_user_plugin"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    plugin_id: Mapped[int] = mapped_column(Integer, ForeignKey("platform_plugins.id"), nullable=False, index=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
