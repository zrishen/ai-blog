"""状态检查路由。"""

from datetime import datetime, timezone

from fastapi import APIRouter

from src.core.config import settings
from src.services.file_service import UPLOAD_DIR

router = APIRouter()


@router.get("/status")
async def check_status():
    """All backend components health check: database, uploads, vector store."""
    status = {
        "status": "ok",
        "model": settings.model_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "components": {},
    }

    # Check database
    try:
        from sqlalchemy import text
        from src.database.engine import engine

        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.commit()
        status["components"]["database"] = "ok"
    except Exception as e:
        status["components"]["database"] = f"error: {str(e)}"
        status["status"] = "degraded"

    # Check upload directory
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        file_count = len(list(UPLOAD_DIR.glob("*")))
        status["components"]["uploads"] = f"ok ({file_count} files)"
    except Exception as e:
        status["components"]["uploads"] = f"error: {str(e)}"
        status["status"] = "degraded"

    # Check vector store
    try:
        from src.services.vector_store import list_collections

        collections = await list_collections()
        status["components"]["vector_store"] = f"ok ({len(collections)} collections)"
    except Exception as e:
        status["components"]["vector_store"] = f"error: {str(e)}"
        status["status"] = "degraded"

    return status
