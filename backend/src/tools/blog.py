"""博客 LangChain 工具 — 文章 CRUD + 精准替换。"""

import contextvars
import logging
from datetime import datetime, timezone

from langchain_core.tools import tool
from sqlalchemy import select

from src.database.session import async_session
from src.database.models import BlogPost as BlogPostModel

logger = logging.getLogger(__name__)

# 用户上下文:由 chat_service 在执行 Agent 前设置。
# file.py / research.py 也从此导入,保持单一来源。
current_user_id_cv: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "current_user_id", default=None
)


@tool
async def blog_create_post(
    title: str, content: str, tags: str = "", status: str = "draft", excerpt: str = ""
) -> str:
    """创建一篇新的博客文章。文章将以 Markdown 文件形式保存。
    当用户要求创建、写一篇新博客文章时优先使用此工具。
    参数 title: 文章标题（必填）。标题会单独显示在页面顶部。
    参数 content: Markdown 格式的文章正文（必填），不要以与 title 相同的 '# 标题' 开头；如果需要章节标题，从 '##' 开始。
    参数 tags: 标签，逗号分隔，如 "ai, agent"。
    参数 status: 文章状态，draft（草稿）或 published（发布），默认 draft。
    参数 excerpt: 文章摘要。"""
    from src.services.markdown_blog_service import (
        slug_from_title,
        ensure_unique_slug,
        write_post,
        sync_file_to_db,
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
            "created_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            "published_at": (
                datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
                if status == "published"
                else None
            ),
        }

        write_post(slug, meta, content, user_id)
        post = await sync_file_to_db(slug, db, user_id=user_id)
        if post is None:
            return f"文章创建失败: slug={slug}"
        return f"文章已创建: id={post.id}, slug={slug}, title={title.strip()}, status={meta['status']}"


@tool
async def blog_write_post(
    post_id: int,
    title: str = "",
    content: str = "",
    tags: str = "",
    status: str = "",
    excerpt: str = "",
) -> str:
    """写入已有博客文章的字段或完整正文。只传需要修改的字段。
    当用户要求修改标题、标签、状态、摘要，或大幅重写整篇正文时使用此工具。
    参数 post_id: 文章的数据库 ID（必填）。
    参数 title: 新标题（可选）。
    参数 content: 新 Markdown 正文（可选），传入时会替换整篇正文，不要以与 title 相同的 '# 标题' 开头。
    参数 tags: 新标签，逗号分隔（可选）。
    参数 status: 新状态 draft/published（可选）。
    参数 excerpt: 新摘要（可选）。"""
    from src.services.markdown_blog_service import (
        read_post_by_slug,
        write_post,
        sync_file_to_db,
        slug_from_title,
        ensure_unique_slug,
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
            new_slug = await ensure_unique_slug(
                slug_from_title(title.strip()), db, user_id=user_id, exclude_id=post_id
            )
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

        meta["updated_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        slug = meta.get("slug", post.slug)

        write_post(slug, meta, body, user_id)
        updated = await sync_file_to_db(slug, db, user_id=user_id, existing_post_id=post_id)
        if updated is None:
            return f"文章更新失败: id={post_id}"
        return (
            f"文章已更新: id={updated.id}, slug={slug}, "
            f"title={meta.get('title', '')}, status={meta.get('status', '')}"
        )


@tool
async def blog_edit_post(
    post_id: int,
    target_text: str,
    replacement_text: str,
    section_index: int = 0,
) -> str:
    """精准编辑文章中的指定段落或片段。只替换目标部分，保留其余内容不变。
    当用户要求修改、润色、调整文章的某一段、某一节、某几句话时优先使用此工具。
    参数 post_id: 文章的数据库 ID（必填）。
    参数 target_text: 需要被替换的原文片段（必填），必须与正文中完全一致。
    参数 replacement_text: 替换后的新文本（必填）。
    参数 section_index: 章节序号（可选，从 1 开始，来自 outline 或上下文）。传入后只在该章节范围内匹配 target_text，章节内唯一即可替换，避免全文重复时被拒绝。"""
    from src.services.markdown_ast_service import get_section_char_range, parse_to_blocks
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

        search_body = body
        search_start = 0
        search_end = len(body)
        section_scope = ""

        if section_index > 0:
            blocks = post.blocks_json or parse_to_blocks(body)
            char_range = get_section_char_range(body, blocks, section_index)
            if char_range is None:
                return (
                    f"错误: section_index={section_index} 无法定位对应章节。"
                    "请先用 blog_read_post(mode='outline') 查看可用章节序号。"
                )
            search_start, search_end = char_range
            search_body = body[search_start:search_end]
            section_scope = f" (限定第 {section_index} 节内)"

        match_count = search_body.count(target_text)
        if match_count == 0:
            return (
                f"错误: 在文章{section_scope or '中'}未找到目标文本「{target_text[:80]}...」。\n"
                "请先使用 blog_read_post(mode='full') 查看文章完整内容，"
                "确保 target_text 与正文中完全一致（包括空格和换行）。"
            )
        if match_count > 1:
            return (
                f"错误: 目标文本在{section_scope or '文章'}中出现 {match_count} 次，无法确定要修改哪一处。\n"
                "请先使用 blog_read_post(mode='outline') 查看文章结构，"
                "再使用 blog_read_post(mode='section', section_index=N) 读取目标章节，"
                "并提供包含上下文的唯一 target_text。"
            )

        local_start = search_body.find(target_text)
        global_start = search_start + local_start
        global_end = global_start + len(target_text)
        new_body = body[:global_start] + replacement_text + body[global_end:]

        meta = data["meta"] if data else {}
        meta["updated_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        slug = meta.get("slug", post.slug)

        write_post(slug, meta, new_body, user_id)
        updated = await sync_file_to_db(slug, db, user_id=user_id, existing_post_id=post_id)
        if updated is None:
            return f"文章更新失败: id={post_id}"
        scope_suffix = f", section={section_index}" if section_index > 0 else ""
        return (
            f"文章已精准修改: id={updated.id}, slug={slug}, "
            f"title={meta.get('title', '')}{scope_suffix}"
        )


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
async def blog_search_posts(query: str = "", post_id: int = 0, status: str = "", page: int = 1) -> str:
    """搜索或列出博客文章，也可搜索单篇文章内容。
    当用户要求查看有哪些文章、列出文章或按标题查找博客文章时，不传 post_id；当需要在某篇文章内查找文字、定位重复片段或辅助精准编辑时，传入 post_id。
    参数 query: 搜索关键词；搜索文章列表时可为空，表示列出文章；搜索单篇正文时必填。
    参数 post_id: 文章 ID；大于 0 时只搜索该文章正文，默认 0 表示搜索文章列表。
    参数 status: 搜索文章列表时按状态筛选，draft（草稿）或 published（发布），留空则全部搜索。
    参数 page: 搜索文章列表时的页码，默认第 1 页，每页 20 篇。"""
    from src.services.markdown_ast_service import extract_outline, get_section_text, parse_to_blocks
    from src.services.markdown_blog_service import read_post_by_slug

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法搜索文章。"

    keyword = query.strip()

    async with async_session() as db:
        if post_id > 0:
            if not keyword:
                return "错误: 搜索单篇文章正文时 query 不能为空。"
            post = await db.get(BlogPostModel, post_id)
            if not post or post.user_id != user_id:
                return f"文章不存在: id={post_id}"

            data = read_post_by_slug(post.slug, user_id)
            body = data["body"] if data else post.content
            blocks = post.blocks_json or parse_to_blocks(body)
            outline = extract_outline(blocks) if blocks else []
            matches: list[str] = []

            if outline:
                for item in outline:
                    section_text = get_section_text(blocks, item["section_index"]) or ""
                    for snippet in _search_snippets(section_text, keyword):
                        matches.append(
                            f"[{len(matches) + 1}] 第 {item['section_index']} 节 "
                            f"{'#' * item['level']} {item['title']}\n上下文：{snippet}"
                        )
                        if len(matches) >= 10:
                            break
                    if len(matches) >= 10:
                        break
            else:
                for snippet in _search_snippets(body, keyword):
                    matches.append(f"[{len(matches) + 1}] 全文匹配\n上下文：{snippet}")
                    if len(matches) >= 10:
                        break

            if not matches:
                return f"文章「{post.title}」中未找到「{keyword}」。"

            total_count = body.lower().count(keyword.lower())
            lines = [f"文章「{post.title}」中找到 {total_count} 处「{keyword}」:"]
            lines.extend(matches)
            if total_count > len(matches):
                lines.append(f"仅显示前 {len(matches)} 处，请提供更精确的 query 缩小范围。")
            return "\n\n".join(lines)

        per_page = 20
        stmt = select(BlogPostModel).where(BlogPostModel.user_id == user_id)
        if status.strip():
            stmt = stmt.where(BlogPostModel.status == status.strip())
        stmt = stmt.order_by(BlogPostModel.updated_at.desc())
        result = await db.execute(stmt)
        all_posts = result.scalars().all()

        if keyword:
            keyword_lower = keyword.lower()
            matched = [
                post for post in all_posts
                if keyword_lower in post.title.lower()
                or keyword_lower in (post.excerpt or "").lower()
                or keyword_lower in (post.tags or "").lower()
            ]
        else:
            matched = all_posts

        total = len(matched)
        start = (page - 1) * per_page
        posts = matched[start:start + per_page]

        if not posts:
            if keyword:
                return f"未找到标题、摘要或标签匹配「{keyword}」的博客文章。"
            return "暂无博客文章。"

        title = f"博客搜索结果「{keyword}」" if keyword else "博客文章列表"
        lines = [f"{title} (共 {total} 篇, 第 {page} 页):"]
        for p in posts:
            lines.append(
                f"  [{p.id}] {p.title} | 状态:{p.status} | "
                f"标签:{p.tags or '-'} | 更新:{p.updated_at.strftime('%Y-%m-%d') if p.updated_at else '-'}"
            )
        return "\n".join(lines)


def _search_snippets(text: str, keyword: str, radius: int = 60) -> list[str]:
    text_lower = text.lower()
    keyword_lower = keyword.lower()
    snippets: list[str] = []
    start = 0
    while True:
        index = text_lower.find(keyword_lower, start)
        if index < 0:
            break
        left = max(0, index - radius)
        right = min(len(text), index + len(keyword) + radius)
        prefix = "..." if left > 0 else ""
        suffix = "..." if right < len(text) else ""
        snippet = text[left:right].replace("\n", " ")
        snippets.append(f"{prefix}{snippet}{suffix}")
        start = index + len(keyword)
    return snippets


async def _read_post_full(post_id: int) -> str:
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


async def _get_post_blocks(post_id: int) -> tuple[BlogPostModel | None, list[dict]]:
    """加载文章并返回 (post, blocks)。blocks 优先用缓存,无缓存则即时解析。

    返回 (None, []) 表示文章不存在/无权限。返回 (post, []) 表示解析失败或无内容。
    """
    user_id = current_user_id_cv.get()
    if user_id is None:
        return None, []

    async with async_session() as db:
        post = await db.get(BlogPostModel, post_id)
        if not post or post.user_id != user_id:
            return None, []

        blocks = post.blocks_json or []
        if not blocks and post.content:
            # 旧文章无缓存,即时解析
            from src.services.markdown_ast_service import parse_to_blocks

            blocks = parse_to_blocks(post.content)
            # 异步回填缓存(不阻塞返回)
            if blocks:
                post.blocks_json = blocks
                try:
                    await db.commit()
                except Exception:
                    logger.warning("blocks_json 回填失败 post_id=%s", post_id, exc_info=True)
        return post, blocks


async def _read_post_outline(post_id: int) -> str:
    from src.services.markdown_ast_service import extract_outline

    post, blocks = await _get_post_blocks(post_id)
    if post is None:
        return f"文章不存在: id={post_id}"
    if not blocks:
        return (
            f"文章「{post.title}」无法解析结构（可能未使用标题或解析失败）。"
            "请使用 blog_read_post(mode='full') 查看完整内容。"
        )

    outline = extract_outline(blocks)
    if not outline:
        return (
            f"文章「{post.title}」没有章节标题（## 开头），无法按章节定位。"
            "请使用 blog_read_post(mode='full') 查看完整内容。"
        )

    lines = [f"文章大纲: {post.title} (共 {len(outline)} 节)"]
    for item in outline:
        indent = "  " if item["level"] > 2 else ""
        first = f" 首句: {item['first_sentence']}" if item["first_sentence"] else ""
        lines.append(f"  {indent}[{item['section_index']}] {'#' * item['level']} {item['title']} ({item['char_count']}字){first}")
    lines.append("\n提示: 用 blog_read_post(post_id, mode='section', section_index=N) 读取指定章节的完整文字。")
    return "\n".join(lines)


async def _read_post_section(post_id: int, section_index: int) -> str:
    from src.services.markdown_ast_service import get_section_text

    post, blocks = await _get_post_blocks(post_id)
    if post is None:
        return f"文章不存在: id={post_id}"
    if not blocks:
        return f"文章「{post.title}」无法解析结构。请使用 blog_read_post(mode='full') 查看完整内容。"

    text = get_section_text(blocks, section_index)
    if text is None:
        return f"章节序号 {section_index} 无效。请先用 blog_read_post(mode='outline') 查看可用章节。"

    return f"--- 第 {section_index} 节 ---\n\n{text}"


@tool
async def blog_read_post(post_id: int, mode: str = "full", section_index: int = 0) -> str:
    """读取指定博客文章。支持完整正文、大纲和指定章节三种模式。
    当用户要求查看某篇文章的具体内容时，使用 mode="full"。
    当只需了解文章结构，或用户描述性要求修改某章节时，优先使用 mode="outline"。
    确定章节后，使用 mode="section" 并传入 section_index 读取该节完整文字。
    参数 post_id: 文章的数据库 ID（必填）。
    参数 mode: 读取模式，full（完整正文）、outline（章节大纲）、section（指定章节），默认 full。
    参数 section_index: 章节序号，仅 mode="section" 时必填，来自 outline 返回的 [N] 编号。"""
    normalized_mode = (mode or "full").strip().lower()
    if normalized_mode == "full":
        return await _read_post_full(post_id)
    if normalized_mode == "outline":
        return await _read_post_outline(post_id)
    if normalized_mode == "section":
        if section_index <= 0:
            return "错误: mode='section' 时必须提供有效的 section_index。"
        return await _read_post_section(post_id, section_index)
    return "错误: mode 只能是 full、outline 或 section。"


# ════════════════════════════════════════════════════════════════
# 工具列表
# ════════════════════════════════════════════════════════════════

BLOG_TOOLS = [
    blog_create_post,
    blog_write_post,
    blog_edit_post,
    blog_delete_post,
    blog_search_posts,
    blog_read_post,
]
