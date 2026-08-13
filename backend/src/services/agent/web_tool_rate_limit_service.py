"""Persistent per-user daily quota for the generic web tools."""

from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import WebToolDailyUsage

CHINA_TIMEZONE = timezone(timedelta(hours=8))


async def consume_web_tool_request(
    db: AsyncSession,
    user_id: int,
    *,
    now: datetime | None = None,
) -> int | None:
    """Consume one web-tool request and return today's count, or None when exhausted."""
    current = now or datetime.now(CHINA_TIMEZONE)
    usage_date = current.astimezone(CHINA_TIMEZONE).date()
    timestamp = current.astimezone(UTC).replace(tzinfo=None)

    statement = (
        pg_insert(WebToolDailyUsage)
        .values(
            user_id=user_id,
            usage_date=usage_date,
            request_count=1,
            created_at=timestamp,
            updated_at=timestamp,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "usage_date"],
            set_={
                "request_count": WebToolDailyUsage.request_count + 1,
                "updated_at": timestamp,
            },
            where=WebToolDailyUsage.request_count < settings.web_tool_daily_request_limit,
        )
        .returning(WebToolDailyUsage.request_count)
    )
    result = await db.execute(statement)
    request_count = result.scalar_one_or_none()
    await db.commit()
    return request_count
