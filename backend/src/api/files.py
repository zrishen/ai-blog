"""文件上传 + 文件库路由（文档/分类管理）。"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import logging
import os
import uuid

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, UploadFile, File, Form, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core.exceptions import OwnershipError
from src.database.engine import FileDocument, get_db
from src.database.models import BlogPost, BlogPostRevision, User
from src.schemas.file_base import (
    FileCollectionResponse,
    FileDocumentListResponse,
    FileDocumentResponse,
    FileDocumentUpdate,
)
from src.schemas.files import FileUploadResponse
from src.schemas.file_processing import FileProcessingJobResponse
from src.services.workspace.file.file_processing_service import (
    FileProcessingActiveError,
    cancel_jobs_for_resource,
    create_or_reuse_upload_job,
    fail_staging_job,
    get_job,
    list_jobs,
    mark_upload_queued,
    schedule_job,
)
from src.services.workspace.file.file_service import (
    MAX_FILE_SIZE,
    _get_extension,
    _validate_file,
    get_uploaded_file_path,
    get_user_upload_dir,
    is_hidden_soft_deleted_file,
    matches_magic,
    save_file,
)
from src.services.memory.graph_store import delete_document_chunks, delete_resource_memory
from src.utils.auth import decode_access_token, get_current_user, verify_refresh_token


logger = logging.getLogger(__name__)

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".pdf": "application/pdf",
}

router = APIRouter()


# ---- 文件上传 ----


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Upload a file (docx, xlsx, pdf). Returns stored filename and preview info."""
    try:
        stored_name, original_name = await save_file(file, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FileUploadResponse(
        stored_name=stored_name,
        original_name=original_name,
        download_url=f"/api/v1/uploads/{stored_name}",
    )


async def _find_published_post_referencing_image(
    db: AsyncSession,
    filename: str,
    username: str | None = None,
) -> BlogPost | None:
    """返回引用了该 filename 的已发布文章（status=published、未删、published revision 的
    content/cover_image 含 filename）；无则 None。

    公开图片只在"已被已发布文章引用"时才可访问，避免草稿/未关联/已删文章图片泄露。
    filename 是 stored_name（uuid.ext，全局唯一），用 contains 子串匹配即可。
    """
    stmt = select(BlogPost).join(
        BlogPostRevision, BlogPost.published_revision_id == BlogPostRevision.id
    )
    if username is not None:
        stmt = stmt.join(User, User.id == BlogPost.user_id).where(User.username == username)
    stmt = stmt.where(
        BlogPost.status == "published",
        BlogPost.deleted_at.is_(None),
        or_(
            BlogPostRevision.content.contains(filename),
            BlogPostRevision.cover_image.contains(filename),
        ),
    ).limit(1)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _find_owner_post_referencing_image(
    db: AsyncSession, filename: str, user_id: int
) -> BlogPost | None:
    """该用户任意未删除文章（工作副本 content/cover_image 含 filename）。

    用于作者本人查看：草稿图片只在工作副本，发布后的编辑视图也在工作副本。
    """
    stmt = select(BlogPost).where(
        BlogPost.user_id == user_id,
        BlogPost.deleted_at.is_(None),
        or_(
            BlogPost.content.contains(filename),
            BlogPost.cover_image.contains(filename),
        ),
    ).limit(1)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_optional_viewer(
    authorization: str | None = Header(default=None),
    refresh_token: str | None = Cookie(default=None, alias=settings.refresh_cookie_name),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """公开图片接口的可选认证：access header 或 refresh cookie 任一识别出登录用户。

    供"作者本人查看自己草稿图片"使用——<img> 无法带 access header，但同源会带 refresh cookie。
    """
    if authorization and authorization.lower().startswith("bearer "):
        payload = decode_access_token(authorization[7:])
        if payload and payload.get("sub"):
            user = await db.get(User, int(payload["sub"]))
            if user is not None:
                return user
    if refresh_token:
        user = await verify_refresh_token(refresh_token, db)
        if user is not None:
            return user
    return None


@router.get("/public/uploads/{username}/{filename}")
async def get_public_uploaded_image(
    username: str,
    filename: str,
    viewer: User | None = Depends(get_optional_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Serve a user-uploaded blog image. Author sees own images; others need a published reference."""
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        raise HTTPException(status_code=403, detail="Only images can be public")

    # 作者本人（带凭证）放行自己目录的图片；否则仅"被已发布文章引用"才公开
    owner_id = viewer.id if viewer is not None and viewer.username == username else None
    if owner_id is None:
        post = await _find_published_post_referencing_image(db, filename, username=username)
        if post is None:
            raise HTTPException(status_code=404, detail="File not found")
        owner_id = post.user_id

    try:
        file_path = get_uploaded_file_path(owner_id, filename)
    except (OwnershipError, ValueError):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream"),
    )


@router.get("/blog/cover/{filename}")
async def get_blog_cover(
    filename: str,
    viewer: User | None = Depends(get_optional_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Serve a cover image. Published covers are public; draft covers only visible to the author."""
    if Path(filename).name != filename:
        raise HTTPException(status_code=403, detail="Access denied")

    # 已发布文章引用 → 任何人可见；否则仅当请求者是引用该图的草稿文章作者时可见
    post = await _find_published_post_referencing_image(db, filename)
    if post is None and viewer is not None:
        post = await _find_owner_post_referencing_image(db, filename, viewer.id)
    if post is None:
        raise HTTPException(status_code=404, detail="Cover image not found")

    try:
        file_path = get_uploaded_file_path(post.user_id, filename)
    except (OwnershipError, ValueError):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Cover image not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream"),
    )


@router.get("/uploads/{filename:path}")
async def get_uploaded_file(filename: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Serve an uploaded file (requires authentication).

    软删隔离：若 filename 是已软删的 FileDocument.file_path，则拒绝下载；
    非文件库记录（聊天附件等）不受影响。
    """
    if await is_hidden_soft_deleted_file(
        db,
        filename=filename,
        user_id=user.id,
        username=user.username,
    ):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        file_path = get_uploaded_file_path(user.id, filename)
    except (OwnershipError, ValueError):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream"),
    )


# ---- 文件库辅助 ----


def _user_collection(user_id: int) -> str:
    from src.services.infra.embeddings.embedding_service import get_embedding_collection_suffix

    return f"user_{user_id}_file{get_embedding_collection_suffix()}"


def _is_user_collection(name: str, user_id: int) -> bool:
    return name.startswith(f"user_{user_id}_")


# ---- 文件库文档 ----


@router.post(
    "/files/documents",
    response_model=FileProcessingJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_to_file_library(
    file: UploadFile = File(...),
    auto_index: Optional[bool] = Form(None),
    x_file_request_id: str = Header(..., alias="X-File-Request-Id"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stage a file upload and enqueue durable background vectorization."""
    try:
        request_id = str(uuid.UUID(x_file_request_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="X-File-Request-Id must be a UUID") from exc

    original_name = file.filename or "file"
    error = _validate_file(original_name, file.size, file.content_type, allow_images=False)
    if error:
        raise HTTPException(status_code=400, detail=error)

    user_dir = get_user_upload_dir(user.id)
    processing_dir = user_dir / ".processing"
    processing_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"uploads/{uuid.uuid4().hex}{_get_extension(original_name)}"
    collection_name = _user_collection(user.id)
    try:
        job, created = await create_or_reuse_upload_job(
            db,
            user_id=user.id,
            client_request_id=request_id,
            original_name=original_name,
            stored_name=stored_name,
            collection_name=collection_name,
            processing_dir=processing_dir,
            auto_index=bool(auto_index),
        )
    except FileProcessingActiveError as exc:
        raise HTTPException(
            status_code=409,
            detail="FILE_PROCESSING_ACTIVE: 已有文件正在上传或处理",
        ) from exc
    if not created:
        return FileProcessingJobResponse.model_validate(job)

    staging_path = Path(job.staging_path)
    final_path = get_uploaded_file_path(user.id, stored_name, mode="write")
    total = 0
    output = None
    moved_to_final = False
    try:
        output = await asyncio.to_thread(staging_path.open, "xb")
        checked_magic = False
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            if not checked_magic:
                if not matches_magic(original_name, chunk):
                    raise ValueError("文件内容与扩展名不符")
                checked_magic = True
            total += len(chunk)
            if total > MAX_FILE_SIZE:
                raise ValueError("File exceeds 100MB limit")
            await asyncio.to_thread(output.write, chunk)
        if total == 0:
            raise ValueError("Uploaded file is empty")
        await asyncio.to_thread(output.flush)
        await asyncio.to_thread(os.fsync, output.fileno())
        await asyncio.to_thread(output.close)
        output = None
        await asyncio.to_thread(os.replace, staging_path, final_path)
        moved_to_final = True
        await mark_upload_queued(db, job)
    except asyncio.CancelledError:
        if output is not None:
            await asyncio.to_thread(output.close)
        await asyncio.to_thread(staging_path.unlink, missing_ok=True)
        if moved_to_final:
            await asyncio.to_thread(final_path.unlink, missing_ok=True)
        await fail_staging_job(
            db,
            job,
            error_code="UPLOAD_CANCELLED",
            error_message="Upload request was cancelled",
        )
        raise
    except ValueError as exc:
        if output is not None:
            await asyncio.to_thread(output.close)
        await asyncio.to_thread(staging_path.unlink, missing_ok=True)
        await fail_staging_job(
            db,
            job,
            error_code="INVALID_UPLOAD",
            error_message=str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if output is not None:
            await asyncio.to_thread(output.close)
        await asyncio.to_thread(staging_path.unlink, missing_ok=True)
        if moved_to_final:
            await asyncio.to_thread(final_path.unlink, missing_ok=True)
        await fail_staging_job(
            db,
            job,
            error_code="STAGING_FAILED",
            error_message=str(exc),
        )
        raise HTTPException(status_code=500, detail="Upload staging failed") from exc

    schedule_job(job.id)
    return FileProcessingJobResponse.model_validate(job)


@router.get("/files/processing-jobs/{job_id}", response_model=FileProcessingJobResponse)
async def get_file_processing_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await get_job(db, job_id=job_id, user_id=user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Processing job not found")
    return FileProcessingJobResponse.model_validate(job)


@router.get("/files/processing-jobs", response_model=list[FileProcessingJobResponse])
async def list_file_processing_jobs(
    active_only: bool = Query(False),
    client_request_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    jobs = await list_jobs(
        db,
        user_id=user.id,
        active_only=active_only,
        client_request_id=client_request_id,
    )
    return [FileProcessingJobResponse.model_validate(job) for job in jobs]


@router.get("/files/documents", response_model=FileDocumentListResponse)
async def list_file_documents(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all file library documents."""
    stmt = select(FileDocument).where(
        FileDocument.user_id == str(user.id),
        FileDocument.deleted_at.is_(None),
    ).order_by(FileDocument.created_at.desc())
    result = await db.execute(stmt)
    docs = result.scalars().all()

    documents = []
    for d in docs:
        chunk_count = 0
        if d.chunk_content:
            parts = d.chunk_content.split()
            if parts and parts[0].isdigit():
                chunk_count = int(parts[0])
        documents.append(FileDocumentResponse(
            id=d.id,
            collection_name=d.collection_name,
            original_name=d.original_name,
            file_path=d.file_path,
            chunk_count=chunk_count,
            created_at=d.created_at,
        ))

    return FileDocumentListResponse(documents=documents)


@router.patch("/files/documents/{doc_id}")
async def update_file_document(
    doc_id: int,
    data: FileDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update editable fields of a file document (currently original_name)."""
    result = await db.execute(
        select(FileDocument).where(
            FileDocument.id == doc_id,
            FileDocument.user_id == str(user.id),
            FileDocument.deleted_at.is_(None),
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if data.original_name is not None:
        trimmed = data.original_name.strip()
        if not trimmed:
            raise HTTPException(status_code=400, detail="original_name must not be empty")
        doc.original_name = trimmed
    await db.commit()
    return {"status": "ok"}


@router.delete("/files/documents/{doc_id}")
async def delete_file_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Soft-delete a file library document after removing its graph chunks."""
    result = await db.execute(
        select(FileDocument).where(
            FileDocument.id == doc_id,
            FileDocument.user_id == str(user.id),
            FileDocument.deleted_at.is_(None),
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not _is_user_collection(doc.collection_name, user.id):
        raise HTTPException(status_code=404, detail="Document not found")

    # Step 1: DB 软删，使其立刻对用户不可见
    doc.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    # 进回收站即取消该资源进行中的索引任务，避免后台 job 继续跑完
    await cancel_jobs_for_resource(
        db, user_id=user.id, resource_type="file", resource_id=doc_id
    )

    collection_name = doc.collection_name
    stored_name = doc.file_path
    try:
        await delete_document_chunks(collection_name, stored_name)
        await delete_resource_memory(user_id=user.id, resource_type="file", resource_id=doc_id)
    except Exception:
        logger.exception(
            "File library soft-delete vector cleanup failed: doc_id=%s stored_name=%s",
            doc_id,
            stored_name,
        )
        # commit 已发生，重查后清 deleted_at 再 commit。不 rollback：commit 后无 pending 可回滚，
        # 且 rollback 后立即 get 在 NullPool+asyncpg 下触发 MissingGreenlet
        fresh = await db.get(FileDocument, doc_id)
        if fresh is not None and fresh.deleted_at is not None:
            fresh.deleted_at = None
            await db.commit()
        raise HTTPException(status_code=500, detail="Vector cleanup failed; document remains active")
    return {"status": "ok"}


@router.get("/files/collections", response_model=list[FileCollectionResponse])
async def list_file_collections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List collections that contain current user's active documents."""
    result = await db.execute(
        select(FileDocument.collection_name, func.count(FileDocument.id))
        .where(
            FileDocument.user_id == str(user.id),
            FileDocument.deleted_at.is_(None),
        )
        .group_by(FileDocument.collection_name)
        .order_by(FileDocument.collection_name)
    )
    return [
        FileCollectionResponse(name=name, document_count=count)
        for name, count in result.all()
    ]


@router.delete("/files/collections/{name}")
async def delete_file_collection(
    name: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Move all active documents in a collection to the recycle bin."""
    if not _is_user_collection(name, user.id):
        raise HTTPException(status_code=404, detail="Collection not found")

    result = await db.execute(
        select(FileDocument).where(
            FileDocument.collection_name == name,
            FileDocument.user_id == str(user.id),
            FileDocument.deleted_at.is_(None),
        )
    )
    documents = result.scalars().all()
    if not documents:
        raise HTTPException(status_code=404, detail="Collection not found")

    deleted_count = 0
    for doc in documents:
        doc.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        await cancel_jobs_for_resource(
            db, user_id=user.id, resource_type="file", resource_id=doc.id
        )
        try:
            await delete_document_chunks(name, doc.file_path)
            await delete_resource_memory(user_id=user.id, resource_type="file", resource_id=doc.id)
        except Exception:
            logger.exception(
                "File collection soft-delete vector cleanup failed: collection=%s doc_id=%s",
                name,
                doc.id,
            )
            # commit 已发生，重查后清 deleted_at 再 commit（理由同 delete_file_document）
            fresh = await db.get(FileDocument, doc.id)
            if fresh is not None and fresh.deleted_at is not None:
                fresh.deleted_at = None
                await db.commit()
            raise HTTPException(
                status_code=500,
                detail=f"Vector cleanup failed after moving {deleted_count} documents to trash",
            )
        deleted_count += 1

    return {"status": "ok"}
