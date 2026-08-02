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

    try:
        from sqlalchemy import text
        from src.database.engine import engine

        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.commit()
    except Exception as e:
        db_status = f"error: {str(e)}"
        overall_status = "degraded"

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

    try:
        from src.services.memory import graph_store

        if not await graph_store.ping():
            raise RuntimeError("FalkorDB unreachable")
        vector_status = "ok (FalkorDB)"
    except Exception as e:
        vector_status = f"error: {str(e)}"
        overall_status = "degraded"

    brain_status = "disabled"
    if settings.memory_enabled:
        try:
            from src.services.memory import graph_store

            brain_status = "ok" if await graph_store.ping() else "error: falkordb unreachable"
            if brain_status != "ok":
                overall_status = "degraded"
        except Exception as e:
            brain_status = f"error: {str(e)}"
            overall_status = "degraded"

    return StatusResponse(
        status=overall_status,
        model=settings.model_name,
        timestamp=datetime.now(timezone.utc).isoformat(),
        components=StatusComponents(
            database=db_status,
            uploads=uploads_status,
            vector_store=vector_status,
            brain=brain_status,
        ),
    )
