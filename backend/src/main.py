from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.config import settings
from src.logging_config import setup_logging
from src.database.migrations import init_db
from src.database.session import async_session

logger = logging.getLogger(__name__)

async def startup():
    setup_logging()
    await init_db()

    from src.services.file_processing_service import reconcile_jobs
    await reconcile_jobs()

    from src.services.user_service import ensure_system_user
    from src.services.official_intro_service import build_intro_post_payload
    from src.services.blog_service import ensure_intro_post

    async with async_session() as session:
        user = await ensure_system_user(session)
        intro_payload = build_intro_post_payload()
        await ensure_intro_post(session, intro_payload, user.id)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await startup()
    yield


app = FastAPI(title="ai-blog", version="0.1.0", lifespan=lifespan)

# 同源部署（前端走 /api 相对路径）留空即可；跨域部署需通过 CORS_ALLOW_ORIGINS 显式指定 origin，
# 因为浏览器规范拒绝 credentials 模式下使用通配 "*" origin。
_cors_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "model": settings.model_name}
