"""文件预览路由（docx/xlsx → HTML，PDF → inline）。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.services.file_service import convert_to_html, get_user_upload_dir, is_hidden_soft_deleted_file
from src.utils.auth import decode_token

logger = logging.getLogger(__name__)

router = APIRouter()
_preview_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_preview_user(
    header_token: str | None = Depends(_preview_oauth2_scheme),
    query_token: str | None = Query(default=None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = header_token or query_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user = await db.get(User, int(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


@router.get("/preview/{filename:path}")
async def preview_file(
    filename: str,
    user: User = Depends(get_preview_user),
    db: AsyncSession = Depends(get_db),
):
    """预览文件内容。docx/xlsx 返回 HTML，PDF 直接渲染。需要认证。"""
    if await is_hidden_soft_deleted_file(
        db,
        filename=filename,
        user_id=user.id,
        username=user.username,
    ):
        raise HTTPException(status_code=404, detail="File not found")

    user_dir = get_user_upload_dir(user.id)
    path = user_dir / filename
    resolved = path.resolve()
    if not str(resolved).startswith(str(user_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    ext = path.suffix.lower()

    if ext in (".docx", ".xlsx"):
        html_content = await convert_to_html(filename, user_id=user.id)
        full_html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  .file-preview-document {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 8px; line-height: 1.6; }}
  .file-preview-document h1, .file-preview-document h2, .file-preview-document h3 {{ color: #333; }}
  .file-preview-document table {{ width: 100%; border-collapse: collapse; margin: 10px 0; }}
  .file-preview-document th {{ background: #f5f5f5; text-align: left; }}
  .file-preview-document td, .file-preview-document th {{ padding: 8px; border: 1px solid #ddd; }}
  .file-preview-document .docx-preview, .file-preview-document .xlsx-preview {{ width: 100%; max-width: none; margin: 0; }}
</style></head><body><div class="file-preview-document">{html_content}</div></body></html>"""
        return HTMLResponse(content=full_html)

    elif ext == ".pdf":
        return FileResponse(
            path,
            media_type="application/pdf",
            filename=path.name,
            content_disposition_type="inline",
        )

    raise HTTPException(status_code=400, detail=f"Preview not supported for {ext}")
