"""平台插件与用户启用关系：MCP 运行配置只属于平台管理员，用户仅保存是否启用（数据模型层隔离）。"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

from .base import Base, _utcnow


class PlatformPlugin(Base):
    __tablename__ = "platform_plugins"

    id = Column(Integer, primary_key=True, autoincrement=True)
    slug = Column(String(80), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=False, default="")
    icon = Column(String(40), nullable=False, default="Blocks")
    transport = Column(String(20), nullable=False)
    command = Column(Text, nullable=True)
    args = Column(Text, nullable=True)
    env_vars = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    tools = Column(JSON, nullable=True)
    permission_level = Column(String(20), nullable=False, default="read")
    is_published = Column(Boolean, nullable=False, default=False)
    created_by_admin_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class UserPlugin(Base):
    __tablename__ = "user_plugins"
    __table_args__ = (UniqueConstraint("user_id", "plugin_id", name="uq_user_plugins_user_plugin"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    plugin_id = Column(Integer, ForeignKey("platform_plugins.id"), nullable=False, index=True)
    is_enabled = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
