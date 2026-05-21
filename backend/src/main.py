from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.core.config import settings
from src.core.logging_config import setup_logging
from src.database.engine import init_db

app = FastAPI(title="AI Assistant", version="0.1.0")

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


@app.get("/health")
async def health():
    return {"status": "ok", "model": settings.model_name}
