"""File upload and restore processing job schemas."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


FileProcessingJobType = Literal["upload", "restore", "index"]
FileProcessingJobStatus = Literal["staging", "queued", "running", "succeeded", "failed"]


class FileProcessingJobResponse(BaseModel):
    id: str
    job_type: FileProcessingJobType
    status: FileProcessingJobStatus
    current_stage: str
    progress_model_version: str
    progress_percent: int
    progress_json: dict[str, Any]
    client_request_id: str
    source_document_id: int | None = None
    result_document_id: int | None = None
    original_name: str
    target_resource_type: str | None = None
    target_resource_id: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None

    model_config = {"from_attributes": True}
