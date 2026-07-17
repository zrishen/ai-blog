"""共享测试 fixtures。"""

import os

# 在 src.config 首次实例化 Settings 之前注入测试用 jwt_secret，
# 保证 CI / 未配置 .env 的环境也能启动并签发 Token（此值仅用于测试，不保护任何真实系统）。
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-not-for-production")

import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import settings
from src.database.models import Base
from src.main import app

# 内存数据库，每个测试隔离
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# 让 _resolve_username 也走 :memory: 回退分支（用 str(user_id) 命名目录），
# 避免 unit test 的目录命名受真实 SQLite 文件里 user 数据影响。
settings.database_url = TEST_DATABASE_URL

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionLocal() as session:
        yield session


# 覆盖依赖
from src.database.engine import get_db
from src.utils.auth import get_current_user

app.dependency_overrides[get_db] = override_get_db


async def override_get_current_user():
    from sqlalchemy import select
    from src.database.models import User

    async with TestSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == "testuser"))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(username="testuser", password_hash="mock")
            session.add(user)
            await session.commit()
        return user


app.dependency_overrides[get_current_user] = override_get_current_user


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """每个测试前创建表，测试后清理。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionLocal() as session:
        yield session
