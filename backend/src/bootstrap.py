"""Application startup orchestration."""

import logging

from src.config import settings
from src.database.migrations import init_db
from src.database.session import async_session
from src.logging_config import setup_logging
from src.observability.sentry import init_sentry

logger = logging.getLogger(__name__)


async def _ensure_super_admin(session) -> None:
    username = (settings.super_admin_username or "").strip()
    password = settings.super_admin_password or ""
    if not username and not password:
        return
    if not username or not password:
        logger.error("SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must be set together")
        return

    from sqlalchemy import select

    from src.database.models import User
    from src.utils.auth import hash_password

    user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None:
        session.add(User(
            username=username,
            password_hash=hash_password(password),
            is_admin=True,
            is_super_admin=True,
        ))
        await session.commit()
        return
    if not user.is_admin or not user.is_super_admin:
        user.is_admin = True
        user.is_super_admin = True
        await session.commit()


async def startup() -> None:
    setup_logging()
    # 须在 setup_logging 之后：setup_logging 会 root.handlers.clear()，
    # 早于它初始化会让 Sentry 的 LoggingHandler 被清掉。
    init_sentry()
    await init_db()

    from src.services.workspace.file.file_processing_service import reconcile_jobs
    from src.services.workspace.blog.blog_service import ensure_intro_post
    from src.services.accounts.user.official_intro_service import build_intro_post_payload
    from src.services.accounts.user.user_service import ensure_system_user

    await reconcile_jobs()

    from src.services.workspace.workspace_reconcile_service import reconcile_all_workspaces

    try:
        await reconcile_all_workspaces()
    except Exception:
        logger.exception("workspace reconcile on startup failed")

    async with async_session() as session:
        user = await ensure_system_user(session)
        await ensure_intro_post(session, build_intro_post_payload(), user.id)
        await _ensure_super_admin(session)

    # FalkorDB 承载 RAG 向量；初始化空图以支持空态读取。
    from src.services.memory import graph_store

    graph_ready = await graph_store.ping()
    if not graph_ready:
        logger.error("FalkorDB ping failed——向量检索与 AI 大脑不可用")
    else:
        try:
            await graph_store.ensure_graph()
        except Exception:
            graph_ready = False
            logger.exception("FalkorDB graph initialization failed")

    # AI 大脑灰度开启时启动维护任务；维护失败不阻止应用提供其余能力。
    if settings.memory_enabled and graph_ready:
        from src.services.memory import jobs

        logger.info("FalkorDB brain connected: graph=%s", settings.falkordb_graph_name)
        try:
            await jobs.run_maintenance()
        except Exception:
            logger.exception("FalkorDB maintenance startup run failed")
        jobs.schedule_maintenance()

    if settings.embedding_provider == "local":
        import threading

        from src.services.infra.embeddings.embedding_service import _get_local_model

        def _preload_local_model() -> None:
            try:
                _get_local_model()
            except Exception:
                logger.exception("Failed to preload local embedding model; will retry on first use.")

        threading.Thread(target=_preload_local_model, daemon=True, name="embedding-preload").start()
