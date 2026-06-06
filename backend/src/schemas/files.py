from pydantic import BaseModel


class FileUploadResponse(BaseModel):
    stored_name: str
    original_name: str
    download_url: str
