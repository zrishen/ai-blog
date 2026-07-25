"""应用启动编排：日志、DB 迁移、处理任务对账、系统用户/intro 文章、本地 embedding 预热。

从 main.py 抽出，使 main.py 仅保留 app 装配（FastAPI 实例 + 中间件 + 路由）。
"""

import logging

from src.config import settings
from src.database.migrations import init_db
from src.database.session import async_session
from src.logging_config import setup_logging

logger = logging.getLogger(__name__)


async def _sync_all_blog_posts(session) -> None:
    """启动扫描 content/blog/<username>/，把 .md 同步进 DB（拾遗手动放入/备份恢复的文件）。

    幂等：sync_file_to_db 对已有记录更新、新文件创建。测试内存 DB 跳过（避免读生产目录污染）。
    """
    if ":memory:" in settings.database_url:
        return
    from pathlib import Path
    from sqlalchemy import select
    from src.database.models import User
    from src.services.blog.markdown_blog_service import sync_file_to_db

    content_dir = Path(settings.blog_content_dir)
    if not content_dir.exists():
        return
    synced = 0
    for user_dir in content_dir.iterdir():
        if not user_dir.is_dir():
            continue
        result = await session.execute(select(User).where(User.username == user_dir.name))
        user = result.scalar_one_or_none()
        if user is None:
            continue
        for md_file in sorted(user_dir.glob("*.md")):
            try:
                await sync_file_to_db(md_file.stem, session, user_id=user.id)
                synced += 1
            except Exception:
                logger.warning("启动扫描同步失败: %s", md_file, exc_info=True)
    if synced:
        logger.info("启动扫描：同步 %d 篇博客到 DB", synced)


async def _ensure_initial_admin(session) -> None:
    """INITIAL_ADMIN_USERNAME 指定的用户启动时幂等提升为 admin（Docker/部署引导首个 admin）。

    用户不存在仅警告不阻断；已为 admin 跳过。
    """
    username = settings.initial_admin_username
    if not username or not username.strip():
        return
    username = username.strip()
    from sqlalchemy import select

    from src.database.models import User

    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("INITIAL_ADMIN_USERNAME 指定的用户不存在: %s，跳过", username)
        return
    if user.is_admin:
        return
    user.is_admin = True
    await session.commit()
    logger.info("已将 %s 提升为初始管理员", username)


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
        await _sync_all_blog_posts(session)
        await _ensure_initial_admin(session)

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
