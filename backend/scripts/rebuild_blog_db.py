"""一次性脚本：删除并重建 SQLite + ChromaDB，然后扫描博客 .md 文件回填 BlogPost。

用法：
    cd backend
    .venv/Scripts/python.exe -m scripts.rebuild_blog_db

说明：
    1. 备份当前 SQLite 文件为 .bak.<timestamp>
    2. 删除 chroma_db 目录（旧向量失效，反正 DB 整个重建）
    3. Base.metadata.drop_all + init_db() 重建空表
    4. 扫描 data/content/blog/{username}/*.md，按目录名创建/复用 User，调用 sync_file_to_db 回填
"""

import asyncio
import logging
import secrets
import shutil
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

# 确保可以从 backend/ 目录直接运行
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings  # noqa: E402
from src.database.models import Base, BlogPost, User  # noqa: E402
from src.database.session import async_session, engine  # noqa: E402
from src.database.migrations import init_db  # noqa: E402
from src.services.markdown_blog_service import sync_file_to_db  # noqa: E402
from src.utils.auth import hash_password  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("rebuild_blog_db")


async def _get_or_create_user(db, username: str) -> User:
    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(username=username, password_hash=hash_password(secrets.token_urlsafe(32)))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("新建用户 username=%s id=%s", username, user.id)
    return user


async def _rebuild_schema() -> None:
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        await conn.run_sync(Base.metadata.drop_all)
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
    await init_db()
    logger.info("DB schema 已重建")


async def _restore_posts() -> int:
    content_dir = Path(settings.blog_content_dir)
    if not content_dir.exists():
        logger.warning("博客目录不存在：%s，跳过文章回填", content_dir)
        return 0

    restored = 0
    async with async_session() as db:
        for user_dir in sorted(content_dir.iterdir()):
            if not user_dir.is_dir():
                continue
            username = user_dir.name
            user = await _get_or_create_user(db, username)

            for md_file in sorted(user_dir.glob("*.md")):
                slug = md_file.stem
                try:
                    post = await sync_file_to_db(slug, db, user_id=user.id)
                except Exception:
                    logger.exception("同步失败 slug=%s user=%s", slug, username)
                    continue
                if post is None:
                    logger.warning("未读到文章内容 slug=%s user=%s", slug, username)
                    continue
                restored += 1
                logger.info("已恢复 slug=%s user=%s post_id=%s", slug, username, post.id)
    return restored


def _backup_sqlite() -> Path | None:
    url = settings.database_url
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if url.startswith(prefix):
            db_path = Path(url[len(prefix):])
            if db_path.exists():
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = db_path.with_suffix(db_path.suffix + f".bak.{ts}")
                shutil.copy2(db_path, backup)
                logger.info("已备份 SQLite：%s → %s", db_path, backup)
                return backup
            break
    logger.info("未找到 SQLite 文件，跳过备份")
    return None


def _wipe_chroma() -> None:
    chroma_path = Path(settings.chroma_db_path)
    if chroma_path.exists():
        shutil.rmtree(chroma_path)
        logger.info("已删除 ChromaDB 目录：%s", chroma_path)
    else:
        logger.info("ChromaDB 目录不存在，跳过")


async def main() -> None:
    logger.info("=== 开始重建 DB ===")
    _backup_sqlite()
    _wipe_chroma()
    await _rebuild_schema()

    # 恢复用户名缓存（drop_all 后 users 表已清空）
    try:
        from src.utils.user_dir import invalidate_username_cache
        invalidate_username_cache()
    except Exception:
        pass

    count = await _restore_posts()
    logger.info("=== 重建完成，共恢复 %d 篇文章 ===", count)

    # 统计数据
    async with async_session() as db:
        users = (await db.execute(select(User))).scalars().all()
        posts = (await db.execute(select(BlogPost))).scalars().all()
        logger.info("最终统计：用户 %d 个，文章 %d 篇", len(users), len(posts))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
