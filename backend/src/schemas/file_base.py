"""File library schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class FileCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None


class FileCategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None


class FileCategoryResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FileCategoryTreeResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    created_at: datetime
    children: list["FileCategoryTreeResponse"] = []

    model_config = {"from_attributes": True}


class FileDocumentResponse(BaseModel):
    id: int
    collection_name: str
    original_name: str
    file_path: str
    chunk_count: int
    category_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FileDocumentListResponse(BaseModel):
    documents: list[FileDocumentResponse]


class SetCategoryRequest(BaseModel):
    category_id: int | None


class FileDocumentUpdate(BaseModel):
    original_name: str | None = None


class FileDocumentUploadResponse(BaseModel):
    id: int
    collection_name: str
    original_name: str
    chunk_count: int
    category_id: Optional[int] = None
    created_at: datetime


class FileCollectionResponse(BaseModel):
    name: str
    document_count: int
