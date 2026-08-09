"""Persistent per-IP daily rate limit for anonymous public chat."""

from datetime import datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import PublicChatDailyUsage

CHINA_TIMEZONE = timezone(timedelta(hours=8))


async def consume_public_chat_request(
    db: AsyncSession,
    ip_address: str,
    *,
    now: datetime | None = None,
) -> int | None:
    """Consume one request and return today's count, or None if the quota is exhausted."""
    current = now or datetime.now(CHINA_TIMEZONE)
    usage_date = current.astimezone(CHINA_TIMEZONE).date()
    timestamp = current.astimezone(timezone.utc).replace(tzinfo=None)

    statement = (
        pg_insert(PublicChatDailyUsage)
        .values(
            ip_address=ip_address,
            usage_date=usage_date,
            request_count=1,
            created_at=timestamp,
            updated_at=timestamp,
        )
        .on_conflict_do_update(
            index_elements=["ip_address", "usage_date"],
            set_={
                "request_count": PublicChatDailyUsage.request_count + 1,
                "updated_at": timestamp,
            },
            where=PublicChatDailyUsage.request_count < settings.public_chat_daily_ip_limit,
        )
        .returning(PublicChatDailyUsage.request_count)
    )
    result = await db.execute(statement)
    request_count = result.scalar_one_or_none()
    await db.commit()
    return request_count
