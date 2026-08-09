"""Filesystem-native workspace and AI-knowledge request/response schemas."""

from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field

from src.schemas.file_processing import FileProcessingJobResponse

EntryName = Annotated[str, Field(max_length=300)]
WorkspacePath = Annotated[str, Field(max_length=500)]


class FolderCreate(BaseModel):
    name: EntryName
    parent_path: Optional[WorkspacePath] = None


class EntryPatch(BaseModel):
    path: WorkspacePath
    name: EntryName


class EntryMove(BaseModel):
    path: WorkspacePath
    target_path: Optional[WorkspacePath] = None


class EntryDelete(BaseModel):
    path: WorkspacePath


class WorkspaceEntryResponse(BaseModel):
    path: str
    name: str
    kind: str
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None
    blog_status: Optional[str] = None


class WorkspaceTreeResponse(BaseModel):
    entries: list[WorkspaceEntryResponse]


class RagJoinRequest(BaseModel):
    resource_type: str
    resource_id: int


class RagSourceResponse(BaseModel):
    id: int
    resource_type: str
    resource_id: int
    index_status: str
    indexed_version: Optional[str] = None
    collection_name: str
    error_message: Optional[str] = None
    indexed_at: Optional[datetime] = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class RagJoinResponse(BaseModel):
    rag_source: RagSourceResponse
    job: Optional[FileProcessingJobResponse] = None
