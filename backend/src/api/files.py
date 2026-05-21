"""文件上传路由。"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from src.services.file_service import UPLOAD_DIR, save_file

router = APIRouter()


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file (docx, xlsx, pdf). Returns stored filename and preview info."""
    try:
        stored_name, original_name = await save_file(file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "stored_name": stored_name,
        "original_name": original_name,
        "download_url": f"/api/uploads/{stored_name}",
    }


@router.get("/uploads/{filename}")
async def get_uploaded_file(filename: str):
    """Serve an uploaded file."""
    from pathlib import Path

    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type="application/octet-stream",
    )
