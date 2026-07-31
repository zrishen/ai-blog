"""File library schemas."""

from datetime import datetime

from pydantic import BaseModel


class FileDocumentResponse(BaseModel):
    id: int
    collection_name: str
    original_name: str
    file_path: str
    chunk_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class FileDocumentListResponse(BaseModel):
    documents: list[FileDocumentResponse]


class FileDocumentUpdate(BaseModel):
    original_name: str | None = None


class FileCollectionResponse(BaseModel):
    name: str
    document_count: int
