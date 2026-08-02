"""共享测试 fixtures。testcontainers PostgreSQL（与生产同引擎）。"""

import os

# 在 src.config 首次实例化 Settings 之前注入测试用 jwt_secret，
# 保证 CI / 未配置 .env 的环境也能启动并签发 Token（此值仅用于测试，不保护任何真实系统）。
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-not-for-production")
os.environ.setdefault("REGISTRATION_INVITE_CODE", "test-invite-code")
os.environ.setdefault("LLM_SETTINGS_ENCRYPTION_KEY", "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=")

import asyncio
import json
from types import SimpleNamespace
from typing import AsyncGenerator
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from testcontainers.postgres import PostgresContainer

from src.config import settings
import src.database.engine as database_engine_module
import src.database.session as database_session_module
from src.database.engine import get_db
from src.database.models import Base
from src.main import app
from src.utils.auth import get_current_user

# 由 session 级 _pg fixture 赋值（testcontainers PostgreSQL，与生产同引擎）
engine = None
TestSessionLocal = None


@pytest.fixture(scope="session")
def _pg():
    """session 级 PostgreSQL 容器，赋值 module-level engine / TestSessionLocal / settings.database_url。"""
    original_session_engine = database_session_module.engine
    original_session_factory = database_session_module.async_session
    original_engine_export = database_engine_module.engine
    original_session_export = database_engine_module.async_session
    with PostgresContainer("postgres:16-alpine") as pg:
        host = pg.get_container_host_ip()
        port = pg.get_exposed_port(5432)
        url = f"postgresql+asyncpg://test:test@{host}:{port}/test"
        settings.database_url = url  # user_dir 等也指向测试 PG
        global engine, TestSessionLocal
        engine = create_async_engine(url, echo=False, poolclass=NullPool)
        TestSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        database_session_module.engine = engine
        database_session_module.async_session = TestSessionLocal
        database_engine_module.engine = engine
        database_engine_module.async_session = TestSessionLocal
        yield url
    database_session_module.engine = original_session_engine
    database_session_module.async_session = original_session_factory
    database_engine_module.engine = original_engine_export
    database_engine_module.async_session = original_session_export


@pytest.fixture(scope="session", autouse=True)
def _require_pg(_pg):
    """确保测试 PG 引擎在所有测试前就绪。"""
    yield


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionLocal() as session:
        # 测试连接禁用 FK/触发器：测试套件多处直接插入子记录而不先建父记录。
        # session_replication_role=replica 仅用于测试数据库。
        await session.execute(text("SET session_replication_role = replica"))
        yield session


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
def event_loop(_pg):
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_database(_pg):
    """每个测试前建表，测试后清表（testcontainers PG）。"""
    async with engine.begin() as conn:
        # 测试用户使用 replica 角色以禁用 FK/触发器。NullPool 每次连接会新建会话，
        # 因而所有测试 session（含 file_processing_service 后台 mock session）均会继承该设置。
        # 仅作用于测试库，生产 PostgreSQL 的 FK 正常启用。
        await conn.execute(text("ALTER USER test SET session_replication_role = replica"))
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
        await session.execute(text("SET session_replication_role = replica"))
        yield session


async def _fake_get_user_llm_settings(db, user_id):
    """模拟登录用户已配置自有 API 密钥，避免 chat/research service 触发无 key 拒绝。"""
    return SimpleNamespace(
        protocol="openai",
        base_url="https://example.com/v1",
        api_key="test-key",
        model_name="test-model",
    )


@pytest.fixture(autouse=True)
def mock_external_services():
    """自动 mock 所有外部服务。"""
    with patch("src.api.chat.stream_chat", side_effect=mock_stream_chat), \
         patch("src.services.file.file_processing_service.async_session", TestSessionLocal), \
         patch("src.services.llm.llm_settings_service.get_user_llm_settings", new=_fake_get_user_llm_settings), \
         patch("src.services.chat.orchestrator.get_user_llm_settings", new=_fake_get_user_llm_settings), \
         patch("src.api.files.schedule_job", return_value=None), \
         patch("src.api.trash.schedule_job", return_value=None, create=True), \
         patch("src.services.file.file_processing_service.schedule_job", return_value=None), \
         patch("src.services.trash.trash_service.schedule_job", return_value=None), \
         patch("src.services.file.file_processing_service.vectorize_and_store", return_value=[]), \
         patch("src.api.files.delete_document_chunks", return_value=True), \
         patch("src.services.memory.graph_store.add_document_chunks", return_value=None), \
         patch("src.services.memory.graph_store.search_documents", return_value=[]), \
         patch("src.services.memory.graph_store.delete_document_chunks", return_value=True), \
         patch("src.services.memory.graph_store.ping", return_value=True), \
         patch("src.services.rag.embedding_service.get_embeddings", return_value=[[0.1] * 384]), \
         patch("src.services.trash.trash_service.delete_document_chunks", return_value=True):
        yield


async def mock_stream_chat(
    user_message=None,
    conversation_id=None,
    user_id=None,
    user_image_url=None,
    user_file_url=None,
    attachment_ids=None,
    thinking_mode="normal",
    context=None,
    **kwargs,
):
    """模拟流式聊天响应。"""
    yield "\0ROUNDDELTA\0" + json.dumps({"round_id": 1, "delta": "你好！这是一个测试回复。"})
    yield "\0ROUNDEND\0" + json.dumps({
        "round_id": 1,
        "classification": "final",
        "text": "你好！这是一个测试回复。",
        "loop_step_index": None,
    })
    yield "\n\n\0DONE\0\n" + json.dumps({
        "type": "done",
        "conversation_id": conversation_id or 1,
        "message_id": 1,
    })
