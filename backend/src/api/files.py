"""文件上传 + 文件库路由（文档/分类管理）。"""

from datetime import datetime, timezone
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
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
    FileDocumentUploadResponse,
    SetCategoryRequest,
)
from src.schemas.files import FileUploadResponse
from src.services.file_service import (
    get_user_upload_dir,
    is_hidden_soft_deleted_file,
    save_file,
    vectorize_and_store,
)
from src.services.vector_store import delete_document_chunks
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
        download_url=f"/api/uploads/{stored_name}",
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
    from src.services.embedding_service import get_embedding_collection_suffix

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


@router.delete("/files/categories/{category_id}")
async def delete_file_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cat = await _get_owned_category(db, category_id, user.id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.execute(
        update(FileDocument)
        .where(
            FileDocument.category_id == category_id,
            FileDocument.user_id == str(user.id),
            FileDocument.deleted_at.is_(None),
        )
        .values(category_id=None)
    )
    await db.execute(
        sql_delete(FileCategoryModel).where(FileCategoryModel.id == category_id, FileCategoryModel.user_id == user.id)
    )
    await db.commit()
    return {"status": "ok"}


# ---- 文件库文档 ----


@router.post("/files/documents", response_model=FileDocumentUploadResponse)
async def upload_to_file_library(
    file: UploadFile = File(...),
    category_id: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a file to the file library (vectorized)."""
    await _ensure_category_owner(db, category_id, user.id)

    try:
        stored_name, original_name = await save_file(file, allow_images=False, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    collection_name = _user_collection(user.id)
    try:
        logger.info(
            "File library upload vectorization started: user_id=%s original_name=%s stored_name=%s category_id=%s",
            user.id,
            original_name,
            stored_name,
            category_id,
        )
        chunks = await vectorize_and_store(
            stored_name,
            collection_name,
            original_name=original_name,
            category_id=category_id,
            user_id=user.id,
        )

        doc = FileDocument(
            collection_name=collection_name,
            user_id=str(user.id),
            original_name=original_name,
            file_path=stored_name,
            chunk_content=f"{len(chunks)} chunks",
            meta="",
            category_id=category_id,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        logger.info(
            "File library upload committed: user_id=%s doc_id=%s stored_name=%s chunks=%s",
            user.id,
            doc.id,
            stored_name,
            len(chunks),
        )

    except Exception as e:
        from src.services.file_service import delete_uploaded_file
        logger.exception(
            "File library upload vectorization failed: user_id=%s original_name=%s stored_name=%s category_id=%s",
            user.id,
            original_name,
            stored_name,
            category_id,
        )
        delete_uploaded_file(stored_name, user.id)
        raise HTTPException(status_code=500, detail=f"Vectorization failed: {str(e)}")

    return FileDocumentUploadResponse(
        id=doc.id,
        collection_name=collection_name,
        original_name=original_name,
        chunk_count=len(chunks),
        category_id=doc.category_id,
        created_at=doc.created_at,
    )


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
