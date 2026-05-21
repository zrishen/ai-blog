"""对话管理路由。"""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import Conversation, Message, get_db
from src.schemas.conversation import (
    ConversationCreate,
    ConversationListResponse,
    ConversationResponse,
    MessageResponse,
)
from src.services.conversation_service import (
    delete_conversation,
    list_conversations,
    get_messages,
)

router = APIRouter()


@router.get("/conversations", response_model=ConversationListResponse)
async def get_conversations(db: AsyncSession = Depends(get_db)):
    convs = await list_conversations()
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
):
    conv = Conversation(title=data.title, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse(
        id=conv.id, title=conv.title, created_at=conv.created_at, updated_at=conv.updated_at
    )


@router.delete("/conversations/{conversation_id}")
async def remove_conversation(conversation_id: int):
    await delete_conversation(conversation_id)
    return {"status": "ok"}


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
async def get_conversation_messages(conversation_id: int, db: AsyncSession = Depends(get_db)):
    msgs = await get_messages(conversation_id)
    return [
        MessageResponse(
            id=m.id,
            conversation_id=m.conversation_id,
            role=m.role,
            content=m.content,
            image_url=m.image_url,
            file_url=m.file_url,
            token_count=m.token_count,
            created_at=m.created_at,
        )
        for m in msgs
    ]
