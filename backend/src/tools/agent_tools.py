"""统一 LangChain 工具 — 知识库搜索 + 博客 CRUD。"""

import asyncio
import contextvars
import json
import logging
from datetime import datetime

from langchain_core.tools import tool
from sqlalchemy import select

from src.config import settings
from src.database.session import async_session
from src.database.models import BlogPost as BlogPostModel

logger = logging.getLogger(__name__)

RAG_MAX_CONTEXT_CHARS = 6000

# 用户上下文：由 chat_service 在执行 Agent 前设置
current_user_id_cv: contextvars.ContextVar[int | None] = contextvars.ContextVar('current_user_id', default=None)


# ═══════════════════════════════════════════════════
# RAG 辅助函数
# ═══════════════════════════════════════════════════

async def _get_active_collections(user_id: int | None = None) -> list[str]:
    from src.services.vector_store import get_collection_count, list_collections

    try:
        names = await list_collections()
    except Exception:
        return []

    if user_id is None:
        return []

    prefix = f"user_{user_id}_"
    names = [n for n in names if n.startswith(prefix)]

    counts = await asyncio.gather(
        *(get_collection_count(name) for name in names),
        return_exceptions=True,
    )
    return [
        name
        for name, count in zip(names, counts)
        if not isinstance(count, Exception) and count > 0
    ]


async def _search_collections(
    collection_names: list[str],
    query: str,
    query_embedding: list[float],
) -> list[tuple[str, object]]:
    from src.services.vector_store import search

    async def search_one(name: str) -> list[tuple[str, object]]:
        try:
            results = await search(name, query, query_embedding, settings.rag_top_k)
        except Exception:
            return []
        return [(name, result) for result in results]

    batches = await asyncio.gather(
        *(search_one(name) for name in collection_names),
        return_exceptions=True,
    )
    merged: list[tuple[str, object]] = []
    for batch in batches:
        if not isinstance(batch, Exception):
            merged.extend(batch)
    return merged


def _filter_and_dedupe_rag_results(results: list[tuple[str, object]]) -> list[tuple[str, object]]:
    filtered: list[tuple[str, object]] = []
    seen: set[str] = set()

    for collection_name, result in results:
        content = getattr(result, "content", "").strip()
        if not content:
            continue

        distance = getattr(result, "distance", None)
        if distance is not None and distance > settings.rag_distance_threshold:
            continue

        key = content[:300]
        if key in seen:
            continue
        seen.add(key)
        filtered.append((collection_name, result))

    filtered.sort(key=lambda item: getattr(item[1], "distance", None) if getattr(item[1], "distance", None) is not None else float("inf"))
    return filtered


def _format_rag_context(results: list[tuple[str, object]]) -> str:
    if not results:
        return _format_empty_rag_context("没有找到与用户问题相关的知识库内容。")

    parts = ["[检索到的参考内容]"]
    total_chars = 0

    for index, (collection_name, result) in enumerate(results[:settings.rag_top_k * 2], start=1):
        metadata = getattr(result, "metadata", None) or {}
        source = metadata.get("source") or metadata.get("file_name") or "unknown"
        distance = getattr(result, "distance", None)
        content = getattr(result, "content", "").strip()

        block = (
            f"\n[来源 {index}]\n"
            f"知识库：{collection_name}\n"
            f"来源：{source}\n"
            f"相关距离：{distance if distance is not None else 'unknown'}\n"
            f"内容：\n{content}\n"
        )
        if total_chars + len(block) > RAG_MAX_CONTEXT_CHARS:
            break
        parts.append(block)
        total_chars += len(block)

    if len(parts) == 1:
        return _format_empty_rag_context("检索结果超过上下文限制，未能注入有效内容。")
    return "\n".join(parts)


def _format_empty_rag_context(reason: str) -> str:
    return (
        "[知识库检索结果]\n"
        f"{reason}\n"
        "如果回答需要依赖知识库，请明确说明未找到相关资料，不要编造。"
    )


# ═══════════════════════════════════════════════════
# 知识库搜索工具
# ═══════════════════════════════════════════════════

@tool
async def search_knowledge_base(query: str) -> str:
    """搜索知识库中的文档内容。当需要查找已上传的文件、知识库文档时使用此工具。
    参数 query: 搜索查询字符串。"""
    from src.services.embedding_service import get_embeddings

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "未认证用户无法检索知识库。"

    active = await _get_active_collections(user_id=user_id)
    if not active:
        return _format_empty_rag_context("知识库中没有可检索的文档。")

    try:
        embeddings = await get_embeddings([query])
    except Exception:
        return "无法生成查询嵌入"

    results = await _search_collections(active, query, embeddings[0])
    results = _filter_and_dedupe_rag_results(results)
    return _format_rag_context(results)


# ═══════════════════════════════════════════════════
# 博客 CRUD 工具
# ═══════════════════════════════════════════════════

@tool
async def blog_create_post(title: str, content: str, tags: str = "", status: str = "draft",
                           excerpt: str = "") -> str:
    """创建一篇新的博客文章。文章将以 Markdown 文件形式保存。
    当用户要求创建、写一篇新博客文章时优先使用此工具。
    参数 title: 文章标题（必填）。标题会单独显示在页面顶部。
    参数 content: Markdown 格式的文章正文（必填），不要以与 title 相同的 '# 标题' 开头；如果需要章节标题，从 '##' 开始。
    参数 tags: 标签，逗号分隔，如 "ai, agent"。
    参数 status: 文章状态，draft（草稿）或 published（发布），默认 draft。
    参数 excerpt: 文章摘要。"""
    from src.services.markdown_blog_service import (
        slug_from_title, ensure_unique_slug, write_post, sync_file_to_db,
    )

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法创建文章。"

    async with async_session() as db:
        base_slug = slug_from_title(title)
        slug = await ensure_unique_slug(base_slug, db, user_id=user_id)

        from src.database.models import User as UserModel
        user_result = await db.execute(select(UserModel).where(UserModel.id == user_id))
        user_row = user_result.scalar_one_or_none()
        author_name = user_row.username if user_row else "ai-blog"

        meta = {
            "title": title.strip(),
            "slug": slug,
            "tags": tags.strip(),
            "status": status.strip() or "draft",
            "author": author_name,
            "excerpt": excerpt.strip() or None,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "published_at": datetime.utcnow().isoformat() if status == "published" else None,
        }

        write_post(slug, meta, content, user_id)
        post = await sync_file_to_db(slug, db, user_id=user_id)
        if post is None:
            return f"文章创建失败: slug={slug}"
        return f"文章已创建: id={post.id}, slug={slug}, title={title.strip()}, status={meta['status']}"


@tool
async def blog_update_post(post_id: int, title: str = "", content: str = "", tags: str = "",
                           status: str = "", excerpt: str = "") -> str:
    """更新一篇已有的博客文章，通过文章 ID 指定。只传需要修改的字段。
    当用户要求修改、编辑、更新已有文章时优先使用此工具。
    参数 post_id: 文章的数据库 ID（必填）。
    参数 title: 新标题（可选）。
    参数 content: 新 Markdown 正文（可选），不要以与 title 相同的 '# 标题' 开头。
    参数 tags: 新标签，逗号分隔（可选）。
    参数 status: 新状态 draft/published（可选）。
    参数 excerpt: 新摘要（可选）。"""
    from src.services.markdown_blog_service import (
        read_post_by_slug, write_post, sync_file_to_db,
        slug_from_title, ensure_unique_slug,
    )

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法更新文章。"

    async with async_session() as db:
        post = await db.get(BlogPostModel, post_id)
        if not post:
            return f"文章不存在: id={post_id}"
        if post.user_id != user_id:
            return f"文章不存在: id={post_id}"

        data = read_post_by_slug(post.slug, user_id)
        meta = data["meta"] if data else {}
        body = data["body"] if data else post.content

        if title.strip():
            meta["title"] = title.strip()
            old_slug = post.slug
            new_slug = await ensure_unique_slug(slug_from_title(title.strip()), db, user_id=user_id, exclude_id=post_id)
            if new_slug != old_slug:
                from src.services.markdown_blog_service import delete_post_file
                delete_post_file(old_slug, user_id)
                meta["slug"] = new_slug
                post.slug = new_slug
        if content:
            body = content
        if tags.strip():
            meta["tags"] = tags.strip()
        if status.strip():
            meta["status"] = status.strip()
        if excerpt.strip():
            meta["excerpt"] = excerpt.strip()

        meta["updated_at"] = datetime.utcnow().isoformat()
        slug = meta.get("slug", post.slug)

        write_post(slug, meta, body, user_id)
        updated = await sync_file_to_db(slug, db, user_id=user_id, existing_post_id=post_id)
        if updated is None:
            return f"文章更新失败: id={post_id}"
        return f"文章已更新: id={updated.id}, slug={slug}, title={meta.get('title', '')}, status={meta.get('status', '')}"


@tool
async def blog_patch_post(post_id: int, target_text: str, replacement_text: str) -> str:
    """精准替换文章中的指定段落或片段。只修改目标部分，保留其余内容不变。
    当用户要求修改、润色、调整文章的某一段、某一节、某几句话时优先使用此工具。
    参数 post_id: 文章的数据库 ID（必填）。
    参数 target_text: 需要被替换的原文片段（必填），必须与正文中完全一致。
    参数 replacement_text: 替换后的新文本（必填）。"""
    from src.services.markdown_blog_service import read_post_by_slug, write_post, sync_file_to_db

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法修改文章。"

    if not target_text.strip():
        return "错误: target_text 不能为空。"

    async with async_session() as db:
        post = await db.get(BlogPostModel, post_id)
        if not post:
            return f"文章不存在: id={post_id}"
        if post.user_id != user_id:
            return f"文章不存在: id={post_id}"

        data = read_post_by_slug(post.slug, user_id)
        body = data["body"] if data else post.content

        if target_text not in body:
            return (
                f"错误: 在文章中未找到目标文本「{target_text[:80]}...」。\n"
                "请先使用 blog_get_post 查看文章完整内容，确保 target_text 与正文中完全一致（包括空格和换行）。"
            )

        new_body = body.replace(target_text, replacement_text, 1)

        meta = data["meta"] if data else {}
        meta["updated_at"] = datetime.utcnow().isoformat()
        slug = meta.get("slug", post.slug)

        write_post(slug, meta, new_body, user_id)
        updated = await sync_file_to_db(slug, db, user_id=user_id, existing_post_id=post_id)
        if updated is None:
            return f"文章更新失败: id={post_id}"
        return f"文章已精准修改: id={updated.id}, slug={slug}, title={meta.get('title', '')}"


@tool
async def blog_delete_post(post_id: int) -> str:
    """删除指定的博客文章（同时删除 Markdown 文件和数据库记录）。
    当用户要求删除、移除博客文章时优先使用此工具。
    参数 post_id: 文章的数据库 ID（必填）。"""
    from src.services.markdown_blog_service import delete_post_file

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法删除文章。"

    async with async_session() as db:
        post = await db.get(BlogPostModel, post_id)
        if not post:
            return f"文章不存在: id={post_id}"
        if post.user_id != user_id:
            return f"文章不存在: id={post_id}"

        slug = post.slug
        title = post.title
        delete_post_file(slug, user_id)
        await db.delete(post)
        await db.commit()
        return f"文章已删除: id={post_id}, slug={slug}, title={title}"


@tool
async def blog_list_posts(status: str = "", page: int = 1) -> str:
    """列出博客文章列表，可按状态筛选。
    当用户要求查看所有文章列表、查看有哪些文章时优先使用此工具。
    参数 status: 按状态筛选，draft（草稿）或 published（已发布），留空则全部列出。
    参数 page: 页码，默认第 1 页，每页 20 篇。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法查看文章列表。"

    per_page = 20
    async with async_session() as db:
        stmt = select(BlogPostModel)
        stmt = stmt.where(BlogPostModel.user_id == user_id)
        if status.strip():
            stmt = stmt.where(BlogPostModel.status == status.strip())

        from sqlalchemy import func
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_result = await db.execute(count_stmt)
        total = total_result.scalar() or 0

        stmt = stmt.order_by(BlogPostModel.updated_at.desc()).offset((page - 1) * per_page).limit(per_page)
        result = await db.execute(stmt)
        posts = result.scalars().all()

        if not posts:
            return "暂无博客文章。"

        lines = [f"博客文章列表 (共 {total} 篇, 第 {page} 页):"]
        for p in posts:
            lines.append(
                f"  [{p.id}] {p.title} | 状态:{p.status} | "
                f"标签:{p.tags or '-'} | "
                f"阅读:{p.view_count} | 更新:{p.updated_at.strftime('%Y-%m-%d') if p.updated_at else '-'}"
            )
        return "\n".join(lines)


@tool
async def blog_get_post(post_id: int) -> str:
    """查看指定博客文章的完整内容（包括 Markdown 正文）。
    当用户要求查看某篇文章的具体内容时优先使用此工具。
    参数 post_id: 文章的数据库 ID（必填）。"""
    from src.services.markdown_blog_service import read_post_by_slug

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法查看文章。"

    async with async_session() as db:
        post = await db.get(BlogPostModel, post_id)
        if not post:
            return f"文章不存在: id={post_id}"
        if post.user_id != user_id:
            return f"文章不存在: id={post_id}"

        body = post.content
        if post.file_path:
            data = read_post_by_slug(post.slug, user_id)
            if data:
                body = data["body"]

        return (
            f"标题: {post.title}\n"
            f"ID: {post.id} | slug: {post.slug} | 状态: {post.status}\n"
            f"标签: {post.tags or '-'}\n"
            f"作者: {post.author or '-'} | 阅读: {post.view_count}\n"
            f"创建: {post.created_at} | 更新: {post.updated_at}\n"
            f"--- 正文开始 ---\n\n{body}"
        )


# ═══════════════════════════════════════════════════
# 工具列表
# ═══════════════════════════════════════════════════

RAG_TOOLS = [
    search_knowledge_base,
]

BLOG_TOOLS = [
    blog_create_post,
    blog_update_post,
    blog_patch_post,
    blog_delete_post,
    blog_list_posts,
    blog_get_post,
]

LOCAL_TOOLS = RAG_TOOLS + BLOG_TOOLS
