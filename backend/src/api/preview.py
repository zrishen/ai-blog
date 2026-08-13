"""文件预览路由（docx/xlsx → HTML，PDF → inline）。"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.core.exceptions import OwnershipError
from src.database.engine import get_db
from src.database.models import User
from src.services.workspace.file.file_service import (
    convert_to_html,
    get_uploaded_file_path,
    is_hidden_soft_deleted_file,
)
from src.utils.auth import (
    create_preview_token,
    decode_access_token,
    decode_preview_token,
    get_current_user,
)

router = APIRouter()
_preview_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_preview_user(
    filename: str,
    header_token: str | None = Depends(_preview_oauth2_scheme),
    query_token: str | None = Query(default=None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """header 走普通 access token（docx/xlsx 经 apiFetch 携带）；
    query 必须是绑定 filename 的 preview token（PDF iframe 场景，无法带 header）。"""
    if header_token:
        payload = decode_access_token(header_token)
    elif query_token:
        payload = decode_preview_token(query_token, expected_filename=filename)
    else:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user = await db.get(User, int(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


@router.get("/preview/token")
async def issue_preview_token(
    filename: str = Query(...),
    user: User = Depends(get_current_user),
):
    """签发预览专用弱权限 token（type=preview，绑定 filename）。

    前端用它拼 ?token= 供 PDF iframe 加载；泄露后仅能预览该用户该文件。
    """
    token = create_preview_token(user.id, filename)
    return {"token": token, "expires_in": settings.preview_token_expire_seconds}


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

    try:
        path = get_uploaded_file_path(user.id, filename)
    except (OwnershipError, ValueError) as exc:
        raise HTTPException(status_code=403, detail="Access denied") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    ext = path.suffix.lower()

    if ext in (".docx", ".xlsx"):
        html_content = await convert_to_html(filename, user_id=user.id)
        full_html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  .file-preview-document {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 8px;
    line-height: 1.6;
  }}
  .file-preview-document h1, .file-preview-document h2, .file-preview-document h3 {{ color: #333; }}
  .file-preview-document table {{ width: 100%; border-collapse: collapse; margin: 10px 0; }}
  .file-preview-document th {{ background: #f5f5f5; text-align: left; }}
  .file-preview-document td, .file-preview-document th {{ padding: 8px; border: 1px solid #ddd; }}
  .file-preview-document .docx-preview,
  .file-preview-document .xlsx-preview {{ width: 100%; max-width: none; margin: 0; }}
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
