"""知识库路由。"""

import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import KBDocument, get_db, async_session
from src.schemas.conversation import MessageResponse
from src.schemas.knowledge_base import KBDocumentResponse
from src.services.file_service import save_file, vectorize_and_store
from src.services.vector_store import get_collection_count, list_collections, delete_collection

router = APIRouter()


@router.post("/kb/documents")
async def upload_to_kb(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a file to the knowledge base (vectorized)."""
    try:
        stored_name, original_name = await save_file(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Use a collection name based on the original file name
    safe_name = Path(original_name).stem.replace(" ", "_")
    count = await get_collection_count(safe_name)
    collection_name = f"{safe_name}_{count + 1}" if count > 0 else safe_name

    # Vectorize and store
    try:
        chunks = await vectorize_and_store(stored_name, collection_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vectorization failed: {str(e)}")

    # Persist metadata to database
    doc = KBDocument(
        collection_name=collection_name,
        original_name=original_name,
        file_path=stored_name,
        chunk_content=f"{len(chunks)} chunks",
        meta="",
        created_at=datetime.utcnow(),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return {
        "id": doc.id,
        "collection_name": collection_name,
        "original_name": original_name,
        "chunk_count": len(chunks),
        "created_at": doc.created_at,
    }


@router.get("/kb/documents")
async def list_kb_documents(db: AsyncSession = Depends(get_db)):
    """List all knowledge base documents."""
    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(KBDocument).order_by(KBDocument.created_at.desc())
        )
        docs = result.scalars().all()

    return {
        "documents": [
            KBDocumentResponse(
                id=d.id,
                collection_name=d.collection_name,
                original_name=d.original_name,
                file_path=d.file_path,
                chunk_count=await get_collection_count(d.collection_name),
                created_at=d.created_at,
            )
            for d in docs
        ]
    }


@router.delete("/kb/documents/{doc_id}")
async def delete_kb_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a knowledge base document (from DB and vector store)."""
    async with async_session() as session:
        doc = await session.get(KBDocument, doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        collection_name = doc.collection_name
        await session.delete(doc)
        await session.commit()

    # Delete from vector store
    await delete_collection(collection_name)

    return {"status": "ok"}


@router.get("/kb/collections")
async def list_kb_collections():
    """List all vector store collections."""
    collections = await list_collections()
    result = []
    for name in collections:
        count = await get_collection_count(name)
        if count > 0:
            result.append({"name": name, "document_count": count})

    return result


@router.delete("/kb/collections/{name}")
async def delete_kb_collection(name: str):
    """Delete an entire collection from the vector store."""
    deleted = await delete_collection(name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Also remove from DB
    async with async_session() as session:
        from sqlalchemy import delete as sql_delete
        await session.execute(
            sql_delete(KBDocument).where(KBDocument.collection_name == name)
        )
        await session.commit()

    return {"status": "ok"}
