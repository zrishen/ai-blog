import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.config import settings
from src.logging_config import setup_logging
from src.database.migrations import init_db
from src.database.session import async_session

logger = logging.getLogger(__name__)

app = FastAPI(title="ai-blog", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.on_event("startup")
async def startup():
    setup_logging()
    await init_db()

    from src.services.user_service import ensure_system_user
    from src.services.official_intro_service import build_intro_post_payload
    from src.services.blog_service import ensure_intro_post
    from src.services.markdown_blog_service import sync_all_files_to_db, sync_db_posts_to_files

    async with async_session() as session:
        user = await ensure_system_user(session)
        intro_payload = build_intro_post_payload()
        await ensure_intro_post(session, intro_payload, user.id)

        synced = await sync_all_files_to_db(session)
        migrated = await sync_db_posts_to_files(session)
        logger.info("Markdown → DB 全量同步完成: %d", synced)
        logger.info("DB-only → Markdown 迁移完成: %d", migrated)


@app.get("/health")
async def health():
    return {"status": "ok", "model": settings.model_name}
