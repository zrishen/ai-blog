import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from langchain_core.messages import AIMessage, ToolMessage
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import ChatAttachment, Conversation, Message
from src.database.session import async_session

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
            .where(Conversation.user_id == user_id, Conversation.deleted_at.is_(None))
            .order_by(desc(Conversation.updated_at))
            .limit(50)
        )
        return result.scalars().all()


async def get_conversation(conversation_id: int, user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        result = await s.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.user_id == user_id,
                Conversation.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()


async def delete_conversation(conversation_id: int, user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        result = await s.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.user_id == user_id,
                Conversation.deleted_at.is_(None),
            )
        )
        conv = result.scalar_one_or_none()
        if conv is None:
            return
        conv.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        if session is None:
            await s.commit()


async def get_messages(conversation_id: int, user_id: int, session: AsyncSession | None = None):
    async with _get_session(session) as s:
        result = await s.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.user_id == user_id,
                Conversation.deleted_at.is_(None),
            )
        )
        conv = result.scalar_one_or_none()
        if conv is None:
            logger.warning("获取对话消息失败：会话不存在 conversation_id=%s user=%s", conversation_id, user_id)
            return []
        result = await s.execute(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at, Message.id)
        )
        return result.scalars().all()


async def update_conversation_title(
    conversation_id: int, user_id: int, title: str, session: AsyncSession | None = None
):
    async with _get_session(session) as s:
        conv = await s.get(Conversation, conversation_id)
        if conv and conv.user_id == user_id and conv.deleted_at is None:
            short = title.replace("\n", " ").strip()[:50] or "New Chat"
            conv.title = short
            conv.updated_at = datetime.now(UTC).replace(tzinfo=None)
            if session is None:
                await s.commit()


def _message_text(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else str(content)
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
            text = block.get("text", block.get("content", ""))
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


async def save_chat_turn(
    conversation_id: int | None,
    user_id: int,
    user_content: str,
    user_tokens: int,
    process_messages: list[AIMessage | ToolMessage],
    final_content: str,
    final_tokens: int,
    user_image_url: str | None = None,
    user_file_url: str | None = None,
    attachment_claim_token: str | None = None,
    attachment_ids: list[str] | None = None,
    final_reasoning_content: str | None = None,
    final_tool_events: list[dict] | None = None,
    final_loop_steps: list[str] | None = None,
    final_thinking_duration_ms: int | None = None,
    final_thinking_mode: str | None = None,
) -> tuple[int, Message, Message]:
    async with async_session() as s:
        async with s.begin():
            now = datetime.now(UTC).replace(tzinfo=None)
            conv = await s.get(Conversation, conversation_id) if conversation_id else None
            if conv is None or conv.user_id != user_id or conv.deleted_at is not None:
                conv = Conversation(title="New Chat", user_id=user_id, created_at=now, updated_at=now)
                s.add(conv)
                await s.flush()
            else:
                conv.updated_at = now

            ordered_attachment_ids = attachment_ids or []
            claimed_attachments: list[ChatAttachment] = []
            if attachment_claim_token:
                claimed_attachments = list(
                    (
                        await s.execute(
                            select(ChatAttachment).where(
                                ChatAttachment.user_id == user_id,
                                ChatAttachment.claim_token == attachment_claim_token,
                                ChatAttachment.status == "claimed",
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                by_id = {item.attachment_id: item for item in claimed_attachments}
                if set(by_id) != set(ordered_attachment_ids):
                    raise ValueError("Claimed attachments no longer match this message")
                claimed_attachments = [by_id[item] for item in ordered_attachment_ids]
                user_image_url = next(
                    (
                        f"/api/v1/chat/attachments/{item.attachment_id}/content"
                        for item in claimed_attachments
                        if item.media_type.startswith("image/")
                    ),
                    user_image_url,
                )
                user_file_url = next(
                    (
                        f"/api/v1/chat/attachments/{item.attachment_id}/content"
                        for item in claimed_attachments
                        if not item.media_type.startswith("image/")
                    ),
                    user_file_url,
                )

            user_message = Message(
                conversation_id=conv.id,
                role="user",
                content=user_content,
                image_url=user_image_url,
                file_url=user_file_url,
                token_count=user_tokens,
                created_at=now,
            )
            s.add(user_message)
            await s.flush()

            if claimed_attachments:
                for position, attachment in enumerate(claimed_attachments):
                    attachment.message_id = user_message.id
                    attachment.position = position
                    attachment.status = "attached"
                    attachment.attached_at = now
                    attachment.updated_at = now

            for msg in process_messages:
                if isinstance(msg, AIMessage):
                    tool_calls_data = [
                        {"id": tc["id"], "name": tc["name"], "args": tc["args"]} for tc in (msg.tool_calls or [])
                    ] or None
                    s.add(
                        Message(
                            conversation_id=conv.id,
                            role="assistant",
                            content=_message_text(msg.content),
                            tool_calls=tool_calls_data,
                            token_count=0,
                            created_at=now,
                        )
                    )
                elif isinstance(msg, ToolMessage):
                    s.add(
                        Message(
                            conversation_id=conv.id,
                            role="tool",
                            content=_message_text(msg.content),
                            tool_call_id=msg.tool_call_id,
                            token_count=0,
                            created_at=now,
                        )
                    )

            final_message = Message(
                conversation_id=conv.id,
                role="assistant",
                content=final_content,
                token_count=final_tokens,
                reasoning_content=final_reasoning_content,
                tool_events=final_tool_events,
                loop_steps=final_loop_steps,
                thinking_duration_ms=final_thinking_duration_ms,
                thinking_mode=final_thinking_mode,
                created_at=now,
            )
            s.add(final_message)
            await s.flush()
            conversation_id = conv.id

        return conversation_id, user_message, final_message
