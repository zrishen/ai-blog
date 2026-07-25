"""SQLAlchemy 声明式基类 + UTC 时间戳工具。"""

from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


def _utcnow() -> datetime:
    """Naive UTC datetime, replaces deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass
