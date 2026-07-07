"""对话管理路由。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import Conversation, get_db
from src.database.models import Message, User
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
    prefixes = ("[检索到的参考内容]", "[知识库检索结果]")
    if not stripped.startswith(prefixes):
        return content
    marker = "[用户问题]"
    if marker not in stripped:
        return content
    return stripped.rsplit(marker, 1)[1].strip()


def _is_displayable_history_message(message: Message) -> bool:
    if message.role not in {"user", "assistant"}:
        return False
    if message.role == "assistant" and not (message.content or "").strip() and message.tool_calls:
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
    return [
        MessageResponse(
            id=m.id,
            conversation_id=m.conversation_id,
            role=m.role,
            content=_display_content_for_message(m.role, m.content),
            image_url=m.image_url,
            file_url=m.file_url,
            token_count=m.token_count,
            created_at=m.created_at,
        )
        for m in msgs
        if _is_displayable_history_message(m)
    ]
