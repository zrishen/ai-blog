"""Markdown 博客服务 — 文件 I/O + frontmatter 解析 + DB 同步。"""

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogCategory as BlogCategoryModel
from src.database.models import BlogPost as BlogPostModel
from src.utils.slug import slugify

logger = logging.getLogger(__name__)

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_LEADING_H1_RE = re.compile(r"^\s*#(?!#)\s+(.+?)\s*#?\s*(?:\r?\n|$)")


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_post_body(title: str, body: str) -> str:
    """移除正文开头与标题同名的 Markdown 一级标题。"""
    if not title or not body:
        return body
    normalized_title = _normalize_text(title)
    if not normalized_title:
        return body

    def _replacer(m: re.Match[str]) -> str:
        heading_text = _normalize_text(m.group(1))
        if heading_text == normalized_title:
            return ""
        return m.group(0)

    cleaned = _LEADING_H1_RE.sub(_replacer, body, count=1)
    if cleaned == body:
        return body
    return cleaned.lstrip("\r\n")


def _get_content_dir() -> Path:
    path = Path(settings.blog_content_dir)
    if not path.is_absolute():
        path = Path(__file__).parent.parent.parent / settings.blog_content_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _filepath_for_slug(slug: str, user_id: int) -> Path:
    return _get_content_dir() / str(user_id) / f"{slug}.md"


# ── Frontmatter ──

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    body = text[m.end():]
    return meta, body


def _serialize_frontmatter(meta: dict, body: str) -> str:
    yaml_block = yaml.dump(meta, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return f"---\n{yaml_block}---\n\n{body}"


# ── File I/O ──

def read_post_by_slug(slug: str, user_id: int) -> Optional[dict]:
    filepath = _filepath_for_slug(slug, user_id)
    if not filepath.exists():
        return None
    text = filepath.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(text)
    return {"slug": slug, "meta": meta, "body": body}


def write_post(slug: str, meta: dict, body: str, user_id: int) -> Path:
    title = meta.get("title") or slug
    body = normalize_post_body(title, body)
    text = _serialize_frontmatter(meta, body)
    filepath = _filepath_for_slug(slug, user_id)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    filepath.write_text(text, encoding="utf-8")
    logger.info("Markdown 文件 [写入] slug=%s user_id=%s path=%s", slug, user_id, filepath)
    return filepath


def delete_post_file(slug: str, user_id: int) -> bool:
    filepath = _filepath_for_slug(slug, user_id)
    if not filepath.exists():
        return False
    filepath.unlink()
    logger.info("Markdown 文件 [删除] slug=%s user_id=%s path=%s", slug, user_id, filepath)
    return True


def list_post_files(status: Optional[str] = None, user_id: Optional[int] = None) -> list[dict]:
    results = []
    base_dir = _get_content_dir()
    if user_id is not None:
        dirs = [base_dir / str(user_id)]
    else:
        dirs = [d for d in base_dir.iterdir() if d.is_dir()]
    for user_dir in dirs:
        if not user_dir.exists():
            continue
        for filepath in sorted(user_dir.glob("*.md")):
            text = filepath.read_text(encoding="utf-8")
            meta, _body = _parse_frontmatter(text)
            slug = filepath.stem
            if "slug" not in meta:
                meta["slug"] = slug
            if status and meta.get("status") != status:
                continue
            results.append({"slug": slug, "meta": meta})
    return results


# ── Slug helpers ──

def slug_from_title(title: str) -> str:
    return slugify(title)


async def ensure_unique_slug(base_slug: str, db: AsyncSession, *, user_id: int, exclude_id: Optional[int] = None) -> str:
    slug = base_slug
    counter = 1
    while True:
        stmt = select(BlogPostModel).where(BlogPostModel.slug == slug, BlogPostModel.user_id == user_id)
        if exclude_id is not None:
            stmt = stmt.where(BlogPostModel.id != exclude_id)
        result = await db.execute(stmt)
        exists_in_db = result.scalar_one_or_none() is not None
        exists_on_disk = _filepath_for_slug(slug, user_id).exists()
        if not exists_in_db and not exists_on_disk:
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


# ── Category ──

async def resolve_category(db: AsyncSession, name: Optional[str], *, user_id: int) -> Optional[int]:
    if not name:
        return None
    result = await db.execute(
        select(BlogCategoryModel).where(
            BlogCategoryModel.name == name,
            BlogCategoryModel.user_id == user_id,
        )
    )
    cat = result.scalar_one_or_none()
    if cat:
        return cat.id
    cat = BlogCategoryModel(name=name, slug=slugify(name), user_id=user_id)
    db.add(cat)
    await db.flush()
    logger.info("博客分类 [自动创建] id=%d name=%s user_id=%s", cat.id, name, user_id)
    return cat.id


# ── DB Sync ──

def _path_for_db(filepath: Path) -> str:
    try:
        return str(filepath.resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return str(filepath.resolve())


def _file_path_exists(file_path: Optional[str]) -> bool:
    if not file_path:
        return False
    path = Path(file_path)
    if path.is_absolute():
        return path.exists()
    return (Path.cwd() / path).exists()


def _datetime_to_meta(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


async def _category_name_from_id(db: AsyncSession, category_id: Optional[int], user_id: int) -> Optional[str]:
    if not category_id:
        return None
    category = await db.get(BlogCategoryModel, category_id)
    if not category or category.user_id != user_id:
        return None
    return category.name


def _parse_datetime(value: object) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if value:
        try:
            return datetime.fromisoformat(str(value))
        except (ValueError, TypeError):
            return None
    return None


async def sync_file_to_db(
    slug: str,
    db: AsyncSession,
    *,
    user_id: int,
    existing_post_id: Optional[int] = None,
) -> Optional[BlogPostModel]:
    data = read_post_by_slug(slug, user_id)
    if data is None:
        return None
    meta = data["meta"]
    body = data["body"]
    filepath = _filepath_for_slug(slug, user_id)
    file_path = _path_for_db(filepath)

    post = None
    if existing_post_id is not None:
        post = await db.get(BlogPostModel, existing_post_id)

    if post is None:
        result = await db.execute(
            select(BlogPostModel).where(
                ((BlogPostModel.file_path == file_path) | (BlogPostModel.slug == slug)),
                BlogPostModel.user_id == user_id,
            )
        )
        post = result.scalar_one_or_none()

    is_new = post is None
    if is_new:
        post = BlogPostModel(slug=slug, content="")
        db.add(post)

    post.title = meta.get("title") or slug
    post.slug = slug
    post.content = normalize_post_body(post.title, body)
    post.excerpt = meta.get("excerpt")
    post.cover_image = meta.get("cover_image")
    post.status = meta.get("status") or "draft"
    post.tags = meta.get("tags")
    post.author = meta.get("author") or "ai-blog"
    post.file_path = file_path
    post.user_id = user_id
    post.category_id = await resolve_category(db, meta.get("category"), user_id=user_id)

    for field in ("created_at", "updated_at", "published_at"):
        parsed = _parse_datetime(meta.get(field))
        if parsed:
            setattr(post, field, parsed)

    if is_new:
        post.created_at = post.created_at or datetime.utcnow()
    post.updated_at = datetime.utcnow()

    if post.status == "published" and not post.published_at:
        post.published_at = datetime.utcnow()
    elif post.status != "published":
        post.published_at = None

    await db.commit()
    await db.refresh(post)
    logger.info("Markdown → DB [同步] slug=%s id=%d user_id=%s is_new=%s", slug, post.id, user_id, is_new)
    return post


async def sync_all_files_to_db(db: AsyncSession) -> int:
    count = 0
    base_dir = _get_content_dir()
    if not base_dir.exists():
        return 0
    for user_dir in sorted(base_dir.iterdir()):
        if not user_dir.is_dir():
            continue
        try:
            uid = int(user_dir.name)
        except ValueError:
            continue
        for filepath in sorted(user_dir.glob("*.md")):
            slug = filepath.stem
            file_mtime = filepath.stat().st_mtime

            result = await db.execute(
                select(BlogPostModel.updated_at).where(
                    BlogPostModel.slug == slug,
                    BlogPostModel.user_id == uid,
                )
            )
            row = result.scalar_one_or_none()
            if row and row.timestamp() >= file_mtime:
                continue

            post = await sync_file_to_db(slug, db, user_id=uid)
            if post:
                count += 1
    logger.info("Markdown → DB 增量同步完成: %d 篇", count)
    return count


async def sync_db_posts_to_files(db: AsyncSession) -> int:
    result = await db.execute(select(BlogPostModel).order_by(BlogPostModel.id))
    posts = result.scalars().all()
    migrated = 0

    for post in posts:
        if _file_path_exists(post.file_path):
            continue

        if read_post_by_slug(post.slug, post.user_id):
            await sync_file_to_db(post.slug, db, user_id=post.user_id, existing_post_id=post.id)
            continue

        meta = {
            "title": post.title,
            "slug": post.slug,
            "tags": post.tags,
            "status": post.status or "draft",
            "category": await _category_name_from_id(db, post.category_id, post.user_id),
            "author": post.author or "ai-blog",
            "excerpt": post.excerpt,
            "cover_image": post.cover_image,
            "created_at": _datetime_to_meta(post.created_at),
            "updated_at": _datetime_to_meta(post.updated_at),
            "published_at": _datetime_to_meta(post.published_at),
        }
        write_post(post.slug, meta, post.content or "", post.user_id)
        await sync_file_to_db(post.slug, db, user_id=post.user_id, existing_post_id=post.id)
        migrated += 1

    logger.info("DB-only → Markdown 迁移完成: %d 篇", migrated)
    return migrated
