"""订阅模型：兑换码 + 订阅周用量（按 token 周额度计量）。"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)

from .base import Base, _utcnow


class RedemptionCode(Base):
    """兑换码：激活或续期订阅。

    一次性使用：兑换后 is_used=True，记录 used_by_user_id / used_at。
    续期策略（service 层）：未过期则 expires_at+duration，已过期则 now+duration。
    """

    __tablename__ = "redemption_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(64), unique=True, nullable=False, index=True)
    duration_days = Column(Integer, nullable=False)
    is_used = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    used_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    used_at = Column(DateTime, nullable=True)
    created_by_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class SubscriptionWeeklyUsage(Base):
    """订阅周用量：按 user + ISO 周（period_yw，如 "2026-W30"）累加 token。

    周一 00:00 (UTC+8) 重置 = period_yw 自然变化（新周新行）。
    累加用 SQLite upsert（on_conflict_do_update），范式同 PublicChatDailyUsage。
    """

    __tablename__ = "subscription_weekly_usage"
    __table_args__ = (
        UniqueConstraint("user_id", "period_yw", name="uq_subscription_weekly_usage_user_period"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    period_yw = Column(String(10), nullable=False)
    tokens_used = Column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)
