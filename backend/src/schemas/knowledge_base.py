"""Knowledge base schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class KBCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None


class KBCategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None


class KBCategoryResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class KBCategoryTreeResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    created_at: datetime
    children: list["KBCategoryTreeResponse"] = []

    model_config = {"from_attributes": True}


class KBDocumentResponse(BaseModel):
    id: int
    collection_name: str
    original_name: str
    file_path: str
    chunk_count: int
    category_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class KBDocumentListResponse(BaseModel):
    documents: list[KBDocumentResponse]


class SetCategoryRequest(BaseModel):
    category_id: int | None


class KBDocumentUploadResponse(BaseModel):
    id: int
    collection_name: str
    original_name: str
    chunk_count: int
    category_id: Optional[int] = None
    created_at: datetime


class KBCollectionResponse(BaseModel):
    name: str
    document_count: int
