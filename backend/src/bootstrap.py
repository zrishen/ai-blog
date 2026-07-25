"""应用启动编排：日志、DB 迁移、处理任务对账、系统用户/intro 文章、本地 embedding 预热。

从 main.py 抽出，使 main.py 仅保留 app 装配（FastAPI 实例 + 中间件 + 路由）。
"""

import logging

from src.config import settings
from src.database.migrations import init_db
from src.database.session import async_session
from src.logging_config import setup_logging

logger = logging.getLogger(__name__)


async def startup() -> None:
    setup_logging()
    await init_db()

    from src.services.file.file_processing_service import reconcile_jobs
    await reconcile_jobs()

    from src.services.blog.blog_service import ensure_intro_post
    from src.services.user.official_intro_service import build_intro_post_payload
    from src.services.user.user_service import ensure_system_user

    async with async_session() as session:
        user = await ensure_system_user(session)
        intro_payload = build_intro_post_payload()
        await ensure_intro_post(session, intro_payload, user.id)

    # 本地 embedding 模型后台预热：provider=local 时启动即起后台线程下载加载，不阻塞 startup；
    # 下载期间若来 RAG 请求，_get_local_model 的锁会等加载完，避免重复下载。
    if settings.embedding_provider == "local":
        import threading
        from src.services.rag.embedding_service import _get_local_model

        def _preload_local_model() -> None:
            try:
                _get_local_model()
            except Exception:
                logger.exception("Failed to preload local embedding model; will retry on first use.")

        threading.Thread(target=_preload_local_model, daemon=True, name="embedding-preload").start()
