"""Markdown 博客服务 — 文件 I/O + frontmatter 解析 + DB 同步。"""

import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogCategory as BlogCategoryModel
from src.database.models import BlogPost as BlogPostModel
from src.utils.slug import slugify
from src.utils.user_dir import resolve_username as _resolve_username

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
    path.mkdir(parents=True, exist_ok=True)
    return path


def _filepath_for_slug(slug: str, user_id: int) -> Path:
    return _get_content_dir() / _resolve_username(user_id) / f"{slug}.md"


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
    # 原子写入：先写同目录临时文件，再 os.replace 原子替换目标。
    # 写中途崩溃/磁盘满只会留下临时残骸，不会把原文件写成半个。
    tmp_fd, tmp_path = tempfile.mkstemp(dir=filepath.parent, suffix=".md.tmp")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, filepath)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    logger.info("Markdown 文件 [写入] slug=%s user_id=%s path=%s", slug, user_id, filepath)
    return filepath


def delete_post_file(slug: str, user_id: int) -> bool:
    filepath = _filepath_for_slug(slug, user_id)
    if not filepath.exists():
        return False
    filepath.unlink()
    logger.info("Markdown 文件 [删除] slug=%s user_id=%s path=%s", slug, user_id, filepath)
    return True


# ── Slug helpers ──

def slug_from_title(title: str) -> str:
    return slugify(title)


async def ensure_unique_slug(base_slug: str, db: AsyncSession, *, user_id: int, exclude_id: Optional[int] = None) -> str:
    """生成唯一 slug。识别所有记录（含回收站内软删），避免撞 uq_blog_posts_user_slug。
    软删残留保留在回收站，重建同标题时自动派生 -1/-2 后缀。"""
    slug = base_slug
    counter = 1
    while True:
        stmt = select(BlogPostModel).where(
            BlogPostModel.slug == slug,
            BlogPostModel.user_id == user_id,
        )
        if exclude_id is not None:
            stmt = stmt.where(BlogPostModel.id != exclude_id)
        result = await db.execute(stmt)
        if result.scalar_one_or_none() is None and not _filepath_for_slug(slug, user_id).exists():
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
        if post is not None and post.deleted_at is not None:
            return None

    if post is None:
        result = await db.execute(
            select(BlogPostModel).where(
                ((BlogPostModel.file_path == file_path) | (BlogPostModel.slug == slug)),
                BlogPostModel.user_id == user_id,
                BlogPostModel.deleted_at.is_(None),
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
    # 顺带缓存 AST(供 AI 章节定位使用);解析失败降级为 null,不阻断主流程
    try:
        from src.services.markdown_ast_service import parse_to_blocks
        post.blocks_json = parse_to_blocks(post.content)
    except Exception:
        logger.warning("blocks_json 解析失败,跳过缓存 slug=%s", slug, exc_info=True)
        post.blocks_json = None
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
        post.created_at = post.created_at or datetime.now(timezone.utc).replace(tzinfo=None)
    post.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    if post.status == "published" and not post.published_at:
        post.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
    elif post.status != "published":
        post.published_at = None

    await db.commit()
    await db.refresh(post)
    logger.info("Markdown → DB [同步] slug=%s id=%d user_id=%s is_new=%s", slug, post.id, user_id, is_new)
    return post
