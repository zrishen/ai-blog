"""设置与计量模型：用户 LLM 设置 + 公开聊天日用量。"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, _utcnow


class LLMSettings(Base):
    __tablename__ = "llm_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_llm_settings_user_id"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    protocol = Column(String(20), nullable=False, default="openai")
    base_url = Column(Text, nullable=True)
    api_key = Column(Text, nullable=True)
    model_name = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class BlogSidebarSettings(Base):
    """博主博客主页左栏的自定义配置：AI 生成的 HTML + 内置项开关。"""

    __tablename__ = "blog_sidebar_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_blog_sidebar_settings_user_id"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    html = Column(Text, nullable=False, default="")
    show_tags = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class PublicChatDailyUsage(Base):
    __tablename__ = "public_chat_daily_usage"
    __table_args__ = (
        UniqueConstraint("ip_address", "usage_date", name="uq_public_chat_daily_usage_ip_date"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    ip_address = Column(String(64), nullable=False)
    usage_date = Column(Date, nullable=False)
    request_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)


class WebToolDailyUsage(Base):
    __tablename__ = "web_tool_daily_usage"
    __table_args__ = (
        UniqueConstraint("user_id", "usage_date", name="uq_web_tool_daily_usage_user_date"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    usage_date = Column(Date, nullable=False)
    request_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
