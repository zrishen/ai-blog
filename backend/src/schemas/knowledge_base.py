"""Knowledge base schemas."""

from datetime import datetime

from pydantic import BaseModel


class KBDocumentResponse(BaseModel):
    id: int
    collection_name: str
    original_name: str
    file_path: str
    chunk_count: int
    created_at: datetime


class KBDocumentsListResponse(BaseModel):
    documents: list[KBDocumentResponse]


class CollectionResponse(BaseModel):
    name: str
    document_count: int
