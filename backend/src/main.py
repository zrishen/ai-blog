"""FastAPI 应用入口：仅 app 装配（实例 + 中间件 + 路由）。启动逻辑见 bootstrap.py。"""

from contextlib import asynccontextmanager
import logging
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.routes import router
from src.bootstrap import startup
from src.config import settings
from src.core.exceptions import DomainError

http_logger = logging.getLogger("http.access")


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

app.include_router(router, prefix="/api/v1")


@app.middleware("http")
async def _log_http_request(request: Request, call_next):
    """Write application-level HTTP access records independently of Uvicorn."""
    started_at = perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        http_logger.exception(
            "%s %s failed after %.3fs",
            request.method,
            request.url.path,
            perf_counter() - started_at,
        )
        raise

    if request.url.path != "/health":
        http_logger.info(
            "%s %s %s %.3fs",
            request.method,
            request.url.path,
            response.status_code,
            perf_counter() - started_at,
        )
    return response


@app.exception_handler(DomainError)
async def _domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    """领域异常统一翻译为 JSON 响应（{code, message}）。

    service 层抛 DomainError 时无需 api 层 try/except；现有 HTTPException 行为不变。
    """
    return JSONResponse(status_code=exc.status, content=exc.to_payload())


@app.get("/health")
async def health():
    return {"status": "ok", "model": settings.model_name}
