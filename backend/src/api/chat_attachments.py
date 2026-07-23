"""Thin HTTP routes for AI chat attachment staging."""

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.chat_attachment import ChatAttachmentResponse
from src.services.chat_attachment_service import (
    ChatAttachmentNotFoundError,
    ChatAttachmentStateError,
    ChatAttachmentTooLargeError,
    ChatAttachmentValidationError,
    create_or_reuse_attachment,
    delete_pending_attachment,
    get_attachment_content,
)
from src.utils.auth import get_current_user

router = APIRouter(prefix="/chat/attachments", tags=["chat-attachments"])


@router.post("", response_model=ChatAttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_chat_attachment(
    file: UploadFile = File(...),
    draft_key: str | None = Form(None),
    attachment_id: str = Header(..., alias="X-Attachment-Id"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        attachment = await create_or_reuse_attachment(
            db,
            upload=file,
            attachment_id=attachment_id,
            user_id=user.id,
            draft_key=draft_key,
        )
    except ChatAttachmentTooLargeError as exc:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc)) from exc
    except ChatAttachmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ChatAttachmentResponse.from_attachment(attachment)


@router.get("/{attachment_id}/content", response_class=FileResponse)
async def read_chat_attachment_content(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        attachment, path = await get_attachment_content(
            db,
            attachment_id=attachment_id,
            user_id=user.id,
        )
    except ChatAttachmentNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return FileResponse(
        path=str(path),
        filename=attachment.original_name,
        media_type=attachment.media_type,
    )


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        await delete_pending_attachment(
            db,
            attachment_id=attachment_id,
            user_id=user.id,
        )
    except ChatAttachmentNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ChatAttachmentStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
