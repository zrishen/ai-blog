from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import Conversation, Message
from src.database.session import async_session
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _get_session(session: AsyncSession | None):
    if session is not None:
        yield session
    else:
        async with async_session() as s:
            yield s


async def list_conversations(user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        result = await s.execute(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(desc(Conversation.updated_at))
            .limit(50)
        )
        return result.scalars().all()


async def get_conversation(conversation_id: int, user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        result = await s.execute(
            select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
        )
        return result.scalar_one_or_none()


async def delete_conversation(conversation_id: int, user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        conv = await s.get(Conversation, conversation_id)
        if conv and conv.user_id == user_id:
            await s.delete(conv)
            if session is None:
                await s.commit()


async def get_messages(conversation_id: int, user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        conv = await s.get(Conversation, conversation_id)
        if conv is None:
            logger.warning("获取对话消息失败：会话不存在 conversation_id=%s user=%s", conversation_id, user_id)
            return []
        if conv.user_id != user_id:
            logger.warning(
                "获取对话消息失败：用户无权访问 conversation_id=%s user=%s owner=%s",
                conversation_id,
                user_id,
                conv.user_id,
            )
            return []
        result = await s.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at, Message.id)
        )
        return result.scalars().all()


async def add_message_pair(
    conversation_id: int | None,
    user_id: int,
    user_content: str,
    user_tokens: int,
    assistant_content: str,
    assistant_tokens: int,
    user_image_url: str | None = None,
    user_file_url: str | None = None,
    assistant_reasoning_content: str | None = None,
    assistant_thinking_content: str | None = None,
    assistant_tool_events: list[dict] | None = None,
    assistant_loop_steps: list[str] | None = None,
    assistant_thinking_duration_ms: int | None = None,
    assistant_thinking_mode: str | None = None,
    session: AsyncSession | None = None,
) -> tuple[int, Message]:
    async with _get_session(session) as s:
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if not conversation_id:
            conv = Conversation(title="New Chat", user_id=user_id, created_at=now, updated_at=now)
            s.add(conv)
            await s.flush()
            conversation_id = conv.id
        else:
            conv = await s.get(Conversation, conversation_id)
            if conv is None or conv.user_id != user_id:
                conv = Conversation(title="New Chat", user_id=user_id, created_at=now, updated_at=now)
                s.add(conv)
                await s.flush()
                conversation_id = conv.id

        conv = await s.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = now

        s.add(Message(
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
            reasoning_content=assistant_reasoning_content,
            thinking_content=assistant_thinking_content,
            tool_events=assistant_tool_events,
            loop_steps=assistant_loop_steps,
            thinking_duration_ms=assistant_thinking_duration_ms,
            thinking_mode=assistant_thinking_mode,
            created_at=now,
        )
        s.add(assistant_msg)
        if session is None:
            await s.commit()
        await s.refresh(assistant_msg)
        return conversation_id, assistant_msg


async def update_conversation_title(conversation_id: int, user_id: int, title: str, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        conv = await s.get(Conversation, conversation_id)
        if conv and conv.user_id == user_id:
            short = title.replace("\n", " ").strip()[:50] or "New Chat"
            conv.title = short
            conv.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if session is None:
                await s.commit()


async def save_agent_messages(
    conversation_id: int,
    user_id: int,
    messages: list[AIMessage | ToolMessage | HumanMessage],
    session: AsyncSession | None = None,
) -> None:
    """保存 agent 执行过程中的完整消息序列（含 tool_calls / tool results）。"""
    async with _get_session(session) as s:
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        conv = await s.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = now

        for msg in messages:
            if isinstance(msg, HumanMessage):
                s.add(Message(
                    conversation_id=conversation_id,
                    role="user",
                    content=msg.content or "",
                    created_at=now,
                ))
            elif isinstance(msg, AIMessage):
                tool_calls_data = None
                if msg.tool_calls:
                    tool_calls_data = [
                        {"id": tc["id"], "name": tc["name"], "args": tc["args"]}
                        for tc in msg.tool_calls
                    ]
                s.add(Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=msg.content or "",
                    tool_calls=tool_calls_data,
                    token_count=0,
                    created_at=now,
                ))
            elif isinstance(msg, ToolMessage):
                s.add(Message(
                    conversation_id=conversation_id,
                    role="tool",
                    content=str(msg.content),
                    tool_call_id=msg.tool_call_id,
                    token_count=0,
                    created_at=now,
                ))

        if session is None:
            await s.commit()
