"""知识库路由（文档 + 分类管理）。"""

from datetime import datetime
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, update, delete as sql_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import KBDocument, get_db
from src.database.models import KBCategory as KBCategoryModel
from src.schemas.knowledge_base import (
    KBCategoryCreate,
    KBCategoryUpdate,
    KBCategoryResponse,
    KBCategoryTreeResponse,
    KBCollectionResponse,
    KBDocumentListResponse,
    KBDocumentResponse,
    KBDocumentUploadResponse,
    SetCategoryRequest,
)
from src.database.models import User
from src.services.file_service import save_file, vectorize_and_store
from src.services.vector_store import (
    delete_collection,
    delete_document_chunks,
    get_collection_count,
    list_collections,
)
from src.utils.auth import get_current_user
from src.utils.slug import slugify


logger = logging.getLogger(__name__)


def _user_collection(user_id: int) -> str:
    from src.services.embedding_service import get_embedding_collection_suffix

    return f"user_{user_id}_kb{get_embedding_collection_suffix()}"


def _is_user_collection(name: str, user_id: int) -> bool:
    return name.startswith(f"user_{user_id}_")


async def _get_owned_category(db: AsyncSession, category_id: int, user_id: int) -> KBCategoryModel | None:
    cat = await db.get(KBCategoryModel, category_id)
    if not cat or cat.user_id != user_id:
        return None
    return cat


async def _ensure_category_owner(db: AsyncSession, category_id: int | None, user_id: int):
    if category_id is None:
        return
    cat = await _get_owned_category(db, category_id, user_id)
    if not cat:
        raise HTTPException(status_code=400, detail="分类不存在")


router = APIRouter()


# ---- KB Categories ----


@router.get("/kb/categories")
async def list_kb_categories(
    flat: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取当前用户的分类列表。flat=true 返回扁平列表，否则返回树形结构。"""
    result = await db.execute(
        select(KBCategoryModel)
        .where(KBCategoryModel.user_id == user.id)
        .order_by(KBCategoryModel.name)
    )
    categories = result.scalars().all()

    if flat:
        return [KBCategoryResponse.model_validate(c) for c in categories]

    cat_map: dict[int, KBCategoryTreeResponse] = {}
    roots: list[KBCategoryTreeResponse] = []

    for c in categories:
        node = KBCategoryTreeResponse.model_validate(c)
        node.children = []
        cat_map[c.id] = node

    for c in categories:
        node = cat_map[c.id]
        if c.parent_id and c.parent_id in cat_map:
            cat_map[c.parent_id].children.append(node)
        else:
            roots.append(node)

    return roots


@router.post("/kb/categories", response_model=KBCategoryResponse, status_code=201)
async def create_kb_category(
    data: KBCategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if data.parent_id:
        parent = await _get_owned_category(db, data.parent_id, user.id)
        if not parent:
            raise HTTPException(status_code=400, detail="父分类不存在")

    slug = slugify(data.name)
    cat = KBCategoryModel(
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
    return KBCategoryResponse.model_validate(cat)


@router.put("/kb/categories/{category_id}", response_model=KBCategoryResponse)
async def update_kb_category(
    category_id: int,
    data: KBCategoryUpdate,
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
    return KBCategoryResponse.model_validate(cat)


@router.delete("/kb/categories/{category_id}")
async def delete_kb_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cat = await _get_owned_category(db, category_id, user.id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.execute(
        update(KBDocument)
        .where(KBDocument.category_id == category_id, KBDocument.user_id == str(user.id))
        .values(category_id=None)
    )
    await db.execute(
        sql_delete(KBCategoryModel).where(KBCategoryModel.id == category_id, KBCategoryModel.user_id == user.id)
    )
    await db.commit()
    return {"status": "ok"}


# ---- KB Documents ----


@router.post("/kb/documents", response_model=KBDocumentUploadResponse)
async def upload_to_kb(
    file: UploadFile = File(...),
    category_id: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a file to the knowledge base (vectorized)."""
    await _ensure_category_owner(db, category_id, user.id)

    try:
        stored_name, original_name = await save_file(file, allow_images=False, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    collection_name = _user_collection(user.id)
    try:
        logger.info(
            "KB upload vectorization started: user_id=%s original_name=%s stored_name=%s category_id=%s",
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
            user_id=str(user.id),
        )

        doc = KBDocument(
            collection_name=collection_name,
            user_id=str(user.id),
            original_name=original_name,
            file_path=stored_name,
            chunk_content=f"{len(chunks)} chunks",
            meta="",
            category_id=category_id,
            created_at=datetime.utcnow(),
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        logger.info(
            "KB upload committed: user_id=%s doc_id=%s stored_name=%s chunks=%s",
            user.id,
            doc.id,
            stored_name,
            len(chunks),
        )

    except Exception as e:
        from src.services.file_service import delete_uploaded_file
        logger.exception(
            "KB upload vectorization failed: user_id=%s original_name=%s stored_name=%s category_id=%s",
            user.id,
            original_name,
            stored_name,
            category_id,
        )
        delete_uploaded_file(stored_name, user.id)
        raise HTTPException(status_code=500, detail=f"Vectorization failed: {str(e)}")

    return KBDocumentUploadResponse(
        id=doc.id,
        collection_name=collection_name,
        original_name=original_name,
        chunk_count=len(chunks),
        category_id=doc.category_id,
        created_at=doc.created_at,
    )


@router.get("/kb/documents", response_model=KBDocumentListResponse)
async def list_kb_documents(
    category_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all knowledge base documents, optionally filtered by category."""
    await _ensure_category_owner(db, category_id, user.id)

    stmt = select(KBDocument).where(KBDocument.user_id == str(user.id)).order_by(KBDocument.created_at.desc())
    if category_id is not None:
        stmt = stmt.where(KBDocument.category_id == category_id)
    result = await db.execute(stmt)
    docs = result.scalars().all()

    documents = []
    for d in docs:
        chunk_count = 0
        if d.chunk_content:
            parts = d.chunk_content.split()
            if parts and parts[0].isdigit():
                chunk_count = int(parts[0])
        documents.append(KBDocumentResponse(
            id=d.id,
            collection_name=d.collection_name,
            original_name=d.original_name,
            file_path=d.file_path,
            chunk_count=chunk_count,
            category_id=d.category_id,
            created_at=d.created_at,
        ))

    return KBDocumentListResponse(documents=documents)


@router.patch("/kb/documents/{doc_id}/category")
async def set_document_category(
    doc_id: int,
    data: SetCategoryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Set or clear a document's category."""
    await _ensure_category_owner(db, data.category_id, user.id)
    doc = await db.get(KBDocument, doc_id)
    if not doc or doc.user_id != str(user.id):
        raise HTTPException(status_code=404, detail="Document not found")
    doc.category_id = data.category_id
    await db.commit()
    return {"status": "ok"}


@router.delete("/kb/documents/{doc_id}")
async def delete_kb_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a knowledge base document (from DB and vector store)."""
    doc = await db.get(KBDocument, doc_id)
    if not doc or doc.user_id != str(user.id):
        raise HTTPException(status_code=404, detail="Document not found")
    collection_name = doc.collection_name
    stored_name = doc.file_path
    if not _is_user_collection(collection_name, user.id):
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()

    await delete_document_chunks(collection_name, stored_name)
    return {"status": "ok"}


@router.get("/kb/collections", response_model=list[KBCollectionResponse])
async def list_kb_collections(user: User = Depends(get_current_user)):
    """List current user's vector store collections."""
    collections = [name for name in await list_collections() if _is_user_collection(name, user.id)]
    result = []
    for name in collections:
        count = await get_collection_count(name)
        if count > 0:
            result.append(KBCollectionResponse(name=name, document_count=count))
    return result


@router.delete("/kb/collections/{name}")
async def delete_kb_collection(
    name: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete one current-user collection from the vector store."""
    if not _is_user_collection(name, user.id):
        raise HTTPException(status_code=404, detail="Collection not found")
    deleted = await delete_collection(name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Collection not found")
    await db.execute(
        sql_delete(KBDocument).where(KBDocument.collection_name == name, KBDocument.user_id == str(user.id))
    )
    await db.commit()
    return {"status": "ok"}
