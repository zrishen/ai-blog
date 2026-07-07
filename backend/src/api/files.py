"""文件上传路由。"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}

from src.database.models import User
from src.schemas.files import FileUploadResponse
from src.services.file_service import get_user_upload_dir, save_file
from src.utils.auth import get_current_user

router = APIRouter()


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Upload a file (docx, xlsx, pdf). Returns stored filename and preview info."""
    try:
        stored_name, original_name = await save_file(file, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FileUploadResponse(
        stored_name=stored_name,
        original_name=original_name,
        download_url=f"/api/uploads/{stored_name}",
    )


@router.get("/public/uploads/{username}/{filename}")
async def get_public_uploaded_image(username: str, filename: str):
    """Serve a user-uploaded blog image without auth."""
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}:
        raise HTTPException(status_code=403, detail="Only images can be public")

    user_dir = get_user_upload_dir(username)
    file_path = user_dir / filename
    resolved = file_path.resolve()
    if not str(resolved).startswith(str(user_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream"),
    )


@router.get("/uploads/{filename}")
async def get_uploaded_file(filename: str, user: User = Depends(get_current_user)):
    """Serve an uploaded file (requires authentication)."""
    user_dir = get_user_upload_dir(user.id)
    file_path = user_dir / filename
    resolved = file_path.resolve()
    if not str(resolved).startswith(str(user_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=MEDIA_TYPES.get(file_path.suffix.lower(), "application/octet-stream"),
    )
