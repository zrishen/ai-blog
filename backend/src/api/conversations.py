"""对话管理路由。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import Conversation, get_db
from src.database.models import ChatAttachment, Message, User
from src.schemas.chat_attachment import ChatAttachmentResponse
from src.schemas.conversation import (
    ConversationCreate,
    ConversationListResponse,
    ConversationResponse,
    MessageResponse,
)
from src.database.engine import (
    delete_conversation,
    list_conversations,
    get_messages,
)
from src.utils.auth import get_current_user

router = APIRouter()


def _display_content_for_message(role: str, content: str) -> str:
    if role != "user":
        return content
    stripped = content.lstrip()
    prefixes = ("[检索到的参考内容]", "[文件库检索结果]")
    if not stripped.startswith(prefixes):
        return content
    marker = "[用户问题]"
    if marker not in stripped:
        return content
    return stripped.rsplit(marker, 1)[1].strip()


def _is_displayable_history_message(message: Message) -> bool:
    if message.role not in {"user", "assistant"}:
        return False
    # 中间轮 AIMessage（有 tool_calls 且无思考元数据）不显示，只用于上下文重建
    if message.role == "assistant" and message.tool_calls and not message.thinking_duration_ms:
        return False
    return True


@router.get("/conversations", response_model=ConversationListResponse)
async def get_conversations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    convs = await list_conversations(user.id, session=db)
    return ConversationListResponse(
        conversations=[
            ConversationResponse(
                id=c.id,
                title=c.title,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in convs
        ]
    )


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    data: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = Conversation(
        title=data.title,
        user_id=user.id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse(
        id=conv.id, title=conv.title, created_at=conv.created_at, updated_at=conv.updated_at
    )


@router.delete("/conversations/{conversation_id}")
async def remove_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await delete_conversation(conversation_id, user.id, session=db)
    await db.commit()
    return {"status": "ok"}


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
async def get_conversation_messages(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    msgs = await get_messages(conversation_id, user.id, session=db)
    message_ids = [message.id for message in msgs]
    attachment_rows = []
    if message_ids:
        attachment_rows = list(
            (
                await db.execute(
                    select(ChatAttachment)
                    .where(
                        ChatAttachment.user_id == user.id,
                        ChatAttachment.message_id.in_(message_ids),
                        ChatAttachment.status == "attached",
                    )
                    .order_by(ChatAttachment.message_id, ChatAttachment.position)
                )
            ).scalars().all()
        )
    attachments_by_message: dict[int, list[ChatAttachmentResponse]] = {}
    for attachment in attachment_rows:
        if attachment.message_id is None:
            continue
        attachments_by_message.setdefault(attachment.message_id, []).append(
            ChatAttachmentResponse.from_attachment(attachment)
        )

    return [
        MessageResponse(
            id=m.id,
            conversation_id=m.conversation_id,
            role=m.role,
            content=_display_content_for_message(m.role, m.content),
            image_url=m.image_url,
            file_url=m.file_url,
            attachments=attachments_by_message.get(m.id, []),
            token_count=m.token_count,
            created_at=m.created_at,
            reasoningContent=m.reasoning_content,
            thinkingContent=m.thinking_content,
            toolEvents=m.tool_events,
            loopSteps=m.loop_steps,
            thinkingDurationMs=m.thinking_duration_ms,
            thinkingMode=m.thinking_mode,
        )
        for m in msgs
        if _is_displayable_history_message(m)
    ]
