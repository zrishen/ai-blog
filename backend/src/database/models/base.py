"""SQLAlchemy 声明式基类 + UTC 时间戳工具。"""

from datetime import UTC, datetime

from sqlalchemy.orm import DeclarativeBase


def _utcnow() -> datetime:
    """Naive UTC datetime, replaces deprecated datetime.utcnow()."""
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass
