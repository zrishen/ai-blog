from datetime import datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings
from src.database.models import Base, Conversation, KBDocument, Message

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_image_url()
    await _migrate_file_url()
    await _migrate_kb_documents()
    await _migrate_mcp_servers()
    # 自动种子内置工具
    async with async_session() as session:
        from src.services.mcp_config import seed_default_tools
        await seed_default_tools(session)


async def _migrate_image_url():
    from sqlalchemy import text
    async with engine.connect() as conn:
        result = await conn.execute(text("PRAGMA table_info(messages)"))
        columns = [row[1] for row in result.fetchall()]
        if "image_url" not in columns:
            await conn.execute(text("ALTER TABLE messages ADD COLUMN image_url TEXT"))
            await conn.commit()


async def _migrate_file_url():
    from sqlalchemy import text
    async with engine.connect() as conn:
        result = await conn.execute(text("PRAGMA table_info(messages)"))
        columns = [row[1] for row in result.fetchall()]
        if "file_url" not in columns:
            await conn.execute(text("ALTER TABLE messages ADD COLUMN file_url TEXT"))
            await conn.commit()


async def _migrate_mcp_servers():
    from sqlalchemy import text
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_servers'"))
        tables = [row[0] for row in result.fetchall()]
        if "mcp_servers" not in tables:
            await conn.execute(text("""
                CREATE TABLE mcp_servers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    server_type TEXT NOT NULL,
                    tools JSON,
                    command TEXT,
                    args TEXT,
                    env_vars TEXT,
                    url TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            await conn.commit()


async def _migrate_kb_documents():
    from sqlalchemy import text
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='kb_documents'"))
        tables = [row[0] for row in result.fetchall()]
        if "kb_documents" not in tables:
            await conn.execute(text("""
                CREATE TABLE kb_documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    collection_name TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    chunk_content TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            await conn.commit()


async def list_conversations():
    async with async_session() as session:
        result = await session.execute(
            select(Conversation)
            .order_by(desc(Conversation.updated_at))
            .limit(50)
        )
        return result.scalars().all()


async def get_conversation(conversation_id: int):
    async with async_session() as session:
        result = await session.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        return result.scalar_one_or_none()


async def delete_conversation(conversation_id: int):
    async with async_session() as session:
        conv = await session.get(Conversation, conversation_id)
        if conv:
            await session.delete(conv)
            await session.commit()


async def get_messages(conversation_id: int):
    async with async_session() as session:
        result = await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at)
        )
        return result.scalars().all()


async def add_message_pair(
    conversation_id: int | None,
    user_content: str,
    user_tokens: int,
    assistant_content: str,
    assistant_tokens: int,
    user_image_url: str | None = None,
    user_file_url: str | None = None,
) -> tuple[int, Message]:
    async with async_session() as session:
        now = datetime.utcnow()

        if not conversation_id:
            conv = Conversation(title="New Chat", created_at=now, updated_at=now)
            session.add(conv)
            await session.flush()
            conversation_id = conv.id

        conv = await session.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = now

        session.add(Message(
            conversation_id=conversation_id,
            role="user",
            content=user_content,
            image_url=user_image_url,
            file_url=user_file_url,
            token_count=user_tokens,
            created_at=now,
        ))
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            token_count=assistant_tokens,
            created_at=now,
        )
        session.add(assistant_msg)
        await session.commit()
        await session.refresh(assistant_msg)
        return conversation_id, assistant_msg


async def update_conversation_title(conversation_id: int, title: str):
    async with async_session() as session:
        conv = await session.get(Conversation, conversation_id)
        if conv:
            short = title.replace("\n", " ").strip()[:50] or "New Chat"
            conv.title = short
            conv.updated_at = datetime.utcnow()
            await session.commit()
