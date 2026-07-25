"""文件上传 + 文件库路由（文档/分类管理）。"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import logging
import os
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Form, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import FileDocument, get_db
from src.database.models import FileCategory as FileCategoryModel, User
from src.schemas.file_base import (
    FileCategoryCreate,
    FileCategoryUpdate,
    FileCategoryResponse,
    FileCategoryTreeResponse,
    FileCollectionResponse,
    FileDocumentListResponse,
    FileDocumentResponse,
    FileDocumentUpdate,
    SetCategoryRequest,
)
from src.schemas.files import FileUploadResponse
from src.schemas.file_processing import FileProcessingJobResponse
from src.services.file.file_processing_service import (
    FileProcessingActiveError,
    create_or_reuse_upload_job,
    fail_staging_job,
    get_job,
    list_jobs,
    mark_upload_queued,
    schedule_job,
)
from src.services.file.file_service import (
    MAX_FILE_SIZE,
    _get_extension,
    _validate_file,
    get_user_upload_dir,
    is_hidden_soft_deleted_file,
    save_file,
)
from src.services.rag.vector_store import delete_document_chunks
from src.utils.auth import get_current_user
from src.utils.slug import slugify


logger = logging.getLogger(__name__)

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
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


@router.get("/public/uploads/{username}/{filename}")
async def get_public_uploaded_image(username: str, filename: str):
    """Serve a user-uploaded blog image without auth."""
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}:
        raise HTTPException(status_code=403, detail="Only images can be public")

    user_dir = get_user_upload_dir(username)
    file_path = user_dir / filename
    resolved = file_path.resolve()
    if not str(resolved).startswith(str(user_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream"),
    )


@router.get("/uploads/{filename}")
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

    user_dir = get_user_upload_dir(user.id)
    file_path = user_dir / filename
    resolved = file_path.resolve()
    if not str(resolved).startswith(str(user_dir.resolve())):
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
    from src.services.rag.embedding_service import get_embedding_collection_suffix

    return f"user_{user_id}_file{get_embedding_collection_suffix()}"


def _is_user_collection(name: str, user_id: int) -> bool:
    return name.startswith(f"user_{user_id}_")


async def _get_owned_category(db: AsyncSession, category_id: int, user_id: int) -> FileCategoryModel | None:
    cat = await db.get(FileCategoryModel, category_id)
    if not cat or cat.user_id != user_id:
        return None
    return cat


async def _ensure_category_owner(db: AsyncSession, category_id: int | None, user_id: int):
    if category_id is None:
        return
    cat = await _get_owned_category(db, category_id, user_id)
    if not cat:
        raise HTTPException(status_code=400, detail="分类不存在")


# ---- 文件库分类 ----


@router.get("/files/categories")
async def list_file_categories(
    flat: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取当前用户的分类列表。flat=true 返回扁平列表，否则返回树形结构。"""
    result = await db.execute(
        select(FileCategoryModel)
        .where(FileCategoryModel.user_id == user.id)
        .order_by(FileCategoryModel.name)
    )
    categories = result.scalars().all()

    if flat:
        return [FileCategoryResponse.model_validate(c) for c in categories]

    cat_map: dict[int, FileCategoryTreeResponse] = {}
    roots: list[FileCategoryTreeResponse] = []

    for c in categories:
        node = FileCategoryTreeResponse.model_validate(c)
        node.children = []
        cat_map[c.id] = node

    for c in categories:
        node = cat_map[c.id]
        if c.parent_id and c.parent_id in cat_map:
            cat_map[c.parent_id].children.append(node)
        else:
            roots.append(node)

    return roots


@router.post("/files/categories", response_model=FileCategoryResponse, status_code=201)
async def create_file_category(
    data: FileCategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if data.parent_id:
        parent = await _get_owned_category(db, data.parent_id, user.id)
        if not parent:
            raise HTTPException(status_code=400, detail="父分类不存在")

    slug = slugify(data.name)
    cat = FileCategoryModel(
        name=data.name,
        slug=slug,
        description=data.description,
        parent_id=data.parent_id,
        user_id=user.id,
    )
    db.add(cat)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="分类已存在")
    await db.refresh(cat)
    return FileCategoryResponse.model_validate(cat)


@router.put("/files/categories/{category_id}", response_model=FileCategoryResponse)
async def update_file_category(
    category_id: int,
    data: FileCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cat = await _get_owned_category(db, category_id, user.id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if "parent_id" in data.model_fields_set and data.parent_id is not None:
        if data.parent_id == category_id:
            raise HTTPException(status_code=400, detail="不能将分类设为自己的子分类")
        parent = await _get_owned_category(db, data.parent_id, user.id)
        if not parent:
            raise HTTPException(status_code=400, detail="父分类不存在")
        # 禁止把节点移到自己的后代之下，否则会形成父子环，使遍历/删除无限循环
        descendant_ids = await _collect_descendant_category_ids(db, category_id, user.id)
        if data.parent_id in descendant_ids:
            raise HTTPException(status_code=400, detail="不能将分类移到自己的子分类下")

    if "name" in data.model_fields_set:
        cat.name = data.name
        cat.slug = slugify(data.name)
    if "description" in data.model_fields_set:
        cat.description = data.description
    if "parent_id" in data.model_fields_set:
        cat.parent_id = data.parent_id
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="分类已存在")
    await db.refresh(cat)
    return FileCategoryResponse.model_validate(cat)


async def _collect_descendant_category_ids(
    db: AsyncSession, root_id: int, user_id: int
) -> list[int]:
    """收集 root_id 及其所有后代分类的 id（含自身），BFS 遍历。"""
    rows = await db.execute(
        select(FileCategoryModel.id, FileCategoryModel.parent_id).where(
            FileCategoryModel.user_id == user_id
        )
    )
    children_map: dict[int | None, list[int]] = {}
    for cat_id, parent_id in rows.all():
        children_map.setdefault(parent_id, []).append(cat_id)

    result: list[int] = [root_id]
    queue = [root_id]
    visited: set[int] = {root_id}
    while queue:
        current = queue.pop(0)
        for child_id in children_map.get(current, []):
            if child_id in visited:
                # 环保护：历史坏数据可能存在父子环，已访问的节点不再入队，避免无限循环
                continue
            visited.add(child_id)
            result.append(child_id)
            queue.append(child_id)
    return result


@router.delete("/files/categories/{category_id}")
async def delete_file_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cat = await _get_owned_category(db, category_id, user.id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    descendant_ids = await _collect_descendant_category_ids(db, category_id, user.id)

    docs_result = await db.execute(
        select(FileDocument).where(
            FileDocument.category_id.in_(descendant_ids),
            FileDocument.user_id == str(user.id),
            FileDocument.deleted_at.is_(None),
        )
    )
    docs = docs_result.scalars().all()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if docs:
        await db.execute(
            update(FileDocument)
            .where(
                FileDocument.id.in_([d.id for d in docs]),
                FileDocument.deleted_at.is_(None),
            )
            .values(deleted_at=now, category_id=None)
        )
        await db.commit()
        for doc in docs:
            try:
                await delete_document_chunks(doc.collection_name, doc.file_path)
            except Exception:
                logger.exception(
                    "Category delete chroma cleanup failed (best-effort): doc_id=%s stored_name=%s",
                    doc.id,
                    doc.file_path,
                )

    await db.execute(
        sql_delete(FileCategoryModel).where(
            FileCategoryModel.id.in_(descendant_ids),
            FileCategoryModel.user_id == user.id,
        )
    )
    await db.commit()
    return {"status": "ok"}


# ---- 文件库文档 ----


@router.post(
    "/files/documents",
    response_model=FileProcessingJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_to_file_library(
    file: UploadFile = File(...),
    category_id: Optional[int] = Form(None),
    x_file_request_id: str = Header(..., alias="X-File-Request-Id"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stage a file upload and enqueue durable background vectorization."""
    await _ensure_category_owner(db, category_id, user.id)
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
    stored_name = f"{uuid.uuid4().hex}{_get_extension(original_name)}"
    collection_name = _user_collection(user.id)
    try:
        job, created = await create_or_reuse_upload_job(
            db,
            user_id=user.id,
            client_request_id=request_id,
            original_name=original_name,
            stored_name=stored_name,
            collection_name=collection_name,
            category_id=category_id,
            processing_dir=processing_dir,
        )
    except FileProcessingActiveError as exc:
        raise HTTPException(
            status_code=409,
            detail="FILE_PROCESSING_ACTIVE: 已有文件正在上传或处理",
        ) from exc
    if not created:
        return FileProcessingJobResponse.model_validate(job)

    staging_path = Path(job.staging_path)
    final_path = user_dir / stored_name
    total = 0
    output = None
    moved_to_final = False
    try:
        output = await asyncio.to_thread(staging_path.open, "xb")
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
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
    category_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all file library documents, optionally filtered by category."""
    await _ensure_category_owner(db, category_id, user.id)

    stmt = select(FileDocument).where(
        FileDocument.user_id == str(user.id),
        FileDocument.deleted_at.is_(None),
    ).order_by(FileDocument.created_at.desc())
    if category_id is not None:
        stmt = stmt.where(FileDocument.category_id == category_id)
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
            category_id=d.category_id,
            created_at=d.created_at,
        ))

    return FileDocumentListResponse(documents=documents)


@router.patch("/files/documents/{doc_id}/category")
async def set_document_category(
    doc_id: int,
    data: SetCategoryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Set or clear a document's category."""
    await _ensure_category_owner(db, data.category_id, user.id)
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
    doc.category_id = data.category_id
    await db.commit()
    return {"status": "ok"}


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
    """Soft-delete a file library document (hide immediately; Chroma cleanup deferred)."""
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

    collection_name = doc.collection_name
    stored_name = doc.file_path
    try:
        await delete_document_chunks(collection_name, stored_name)
    except Exception:
        logger.exception(
            "File library soft-delete chroma cleanup failed: doc_id=%s stored_name=%s",
            doc_id,
            stored_name,
        )
        # commit 已发生，session 内 doc 状态不可靠；重查后清 deleted_at 再 commit
        await db.rollback()
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
        try:
            await delete_document_chunks(name, doc.file_path)
        except Exception:
            logger.exception(
                "File collection soft-delete chroma cleanup failed: collection=%s doc_id=%s",
                name,
                doc.id,
            )
            await db.rollback()
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
