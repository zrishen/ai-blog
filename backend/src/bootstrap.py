"""Application startup orchestration."""

import logging

from src.config import settings
from src.database.migrations import init_db
from src.database.session import async_session
from src.logging_config import setup_logging

logger = logging.getLogger(__name__)


async def _ensure_initial_admin(session) -> None:
    username = (settings.initial_admin_username or "").strip()
    if not username:
        return

    from sqlalchemy import select

    from src.database.models import User

    user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None:
        logger.warning("Configured initial admin does not exist: %s", username)
        return
    if not user.is_admin:
        user.is_admin = True
        await session.commit()


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
    await init_db()

    from src.services.file.file_processing_service import reconcile_jobs
    from src.services.blog.blog_service import ensure_intro_post
    from src.services.user.official_intro_service import build_intro_post_payload
    from src.services.user.user_service import ensure_system_user

    await reconcile_jobs()
    async with async_session() as session:
        user = await ensure_system_user(session)
        await ensure_intro_post(session, build_intro_post_payload(), user.id)
        await _ensure_super_admin(session)
        await _ensure_initial_admin(session)

    if settings.embedding_provider == "local":
        import threading

        from src.services.rag.embedding_service import _get_local_model

        def _preload_local_model() -> None:
            try:
                _get_local_model()
            except Exception:
                logger.exception("Failed to preload local embedding model; will retry on first use.")

        threading.Thread(target=_preload_local_model, daemon=True, name="embedding-preload").start()
