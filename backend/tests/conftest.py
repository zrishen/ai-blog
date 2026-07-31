"""共享测试 fixtures。"""

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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import settings
from src.database.engine import get_db
from src.database.models import Base
from src.main import app
from src.utils.auth import get_current_user

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
         patch("src.services.rag.vector_store.list_collections", return_value=[]), \
         patch("src.services.rag.vector_store.search", return_value=[]), \
         patch("src.services.rag.vector_store.delete_document_chunks", return_value=True), \
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
