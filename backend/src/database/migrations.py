from src.database.models import Base
from src.database.session import engine


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
