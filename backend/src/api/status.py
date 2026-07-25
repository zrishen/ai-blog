"""状态检查路由。"""

from datetime import datetime, timezone

from fastapi import APIRouter

from src.config import settings
from src.schemas.status import StatusComponents, StatusResponse
from src.services.file.file_service import UPLOAD_DIR

router = APIRouter()


@router.get("/status", response_model=StatusResponse)
async def check_status():
    """All backend components health check: database, uploads, vector store."""
    db_status = "ok"
    uploads_status = "ok"
    vector_status = "ok"
    overall_status = "ok"

    # Check database
    try:
        from sqlalchemy import text
        from src.database.engine import engine

        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.commit()
    except Exception as e:
        db_status = f"error: {str(e)}"
        overall_status = "degraded"

    # Check upload directory
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        file_count = sum(
            len(list(d.glob("*")))
            for d in UPLOAD_DIR.iterdir()
            if d.is_dir()
        )
        uploads_status = f"ok ({file_count} files)"
    except Exception as e:
        uploads_status = f"error: {str(e)}"
        overall_status = "degraded"

    # Check vector store
    try:
        from src.services.rag.vector_store import list_collections

        collections = await list_collections()
        vector_status = f"ok ({len(collections)} collections)"
    except Exception as e:
        vector_status = f"error: {str(e)}"
        overall_status = "degraded"

    return StatusResponse(
        status=overall_status,
        model=settings.model_name,
        timestamp=datetime.now(timezone.utc).isoformat(),
        components=StatusComponents(
            database=db_status,
            uploads=uploads_status,
            vector_store=vector_status,
        ),
    )
