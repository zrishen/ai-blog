"""订阅模型：兑换码 + 订阅周用量（按 token 周额度计量）。"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow


class RedemptionCode(Base):
    """兑换码：激活或续期订阅；一次性使用（兑换后 is_used=True，记录 used_by_user_id / used_at）。"""

    __tablename__ = "redemption_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    used_by_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_admin_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)


class SubscriptionWeeklyUsage(Base):
    """订阅周用量：按 user + ISO 周（period_yw，如 "2026-W30"）累加 token；周一 00:00 (UTC+8) 自然切周。"""

    __tablename__ = "subscription_weekly_usage"
    __table_args__ = (UniqueConstraint("user_id", "period_yw", name="uq_subscription_weekly_usage_user_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    period_yw: Mapped[str] = mapped_column(String(10), nullable=False)
    tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
