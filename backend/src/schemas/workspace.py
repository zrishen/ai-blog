"""Filesystem-native workspace and AI-knowledge request/response schemas."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from src.schemas.file_processing import FileProcessingJobResponse

EntryName = Annotated[str, Field(max_length=300)]
WorkspacePath = Annotated[str, Field(max_length=500)]


class FolderCreate(BaseModel):
    name: EntryName
    parent_path: WorkspacePath | None = None


class EntryPatch(BaseModel):
    path: WorkspacePath
    name: EntryName


class EntryMove(BaseModel):
    path: WorkspacePath
    target_path: WorkspacePath | None = None


class EntryDelete(BaseModel):
    path: WorkspacePath


class WorkspaceEntryResponse(BaseModel):
    path: str
    name: str
    kind: str
    resource_type: str | None = None
    resource_id: int | None = None
    blog_status: str | None = None


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
    indexed_version: str | None = None
    collection_name: str
    error_message: str | None = None
    indexed_at: datetime | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class RagJoinResponse(BaseModel):
    rag_source: RagSourceResponse
    job: FileProcessingJobResponse | None = None
