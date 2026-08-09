"""文件库检索 LangChain 工具 + RAG 辅助函数。"""

import asyncio
import math

from langchain_core.tools import tool

from src.config import settings

RAG_MAX_CONTEXT_CHARS = 6000


async def _get_active_file_whitelist(user_id: int | None = None) -> dict[str, set[str]]:
    """检索白名单：「加入 AI 知识」且索引 active 的资源（file + blog_post）。

    返回 {collection_name: {stored_name, ...}}。文件 collection/stored_name 取自
    FileDocument；文章 collection 取自 RagSource，stored_name = f"blog_post:{id}"。
    RAG 解耦后上传不再自动索引；只有 RagSource(active) 对应的资源可被检索。
    """
    if user_id is None:
        return {}

    from sqlalchemy import select

    from src.database.models import BlogPost, FileDocument, RagSource
    from src.database.session import async_session

    whitelist: dict[str, set[str]] = {}
    async with async_session() as db:
        file_result = await db.execute(
            select(FileDocument.collection_name, FileDocument.file_path)
            .join(RagSource, RagSource.resource_id == FileDocument.id)
            .where(
                RagSource.user_id == user_id,
                RagSource.resource_type == "file",
                RagSource.index_status.in_(("active", "stale")),
                FileDocument.deleted_at.is_(None),
            )
        )
        for collection_name, stored_name in file_result.all():
            whitelist.setdefault(collection_name, set()).add(stored_name)

        blog_result = await db.execute(
            select(RagSource.collection_name, RagSource.resource_id)
            .join(BlogPost, BlogPost.id == RagSource.resource_id)
            .where(
                RagSource.user_id == user_id,
                RagSource.resource_type == "blog_post",
                RagSource.index_status.in_(("active", "stale")),
                BlogPost.deleted_at.is_(None),
            )
        )
        for collection_name, resource_id in blog_result.all():
            whitelist.setdefault(collection_name, set()).add(f"blog_post:{resource_id}")
    return whitelist


async def _search_collections(
    active_files: dict[str, set[str]],
    query: str,
    query_embedding: list[float],
    *,
    user_id: int,
) -> list[tuple[str, object]]:
    from src.services.memory import graph_store
    from src.services.infra.embeddings.embedding_service import get_embedding_collection_suffix

    async def search_one(name: str, stored_names: set[str]) -> list[tuple[str, object]]:
        try:
            results = await graph_store.search_documents(
                user_id=user_id,
                collection_name=name,
                query_embedding=query_embedding,
                embedding_model=get_embedding_collection_suffix(),
                top_k=settings.rag_top_k,
                whitelist_stored_names=stored_names,
            )
        except Exception:
            return []
        return [
            (name, result)
            for result in results
            if (getattr(result, "metadata", None) or {}).get("stored_name") in stored_names
        ]

    batches = await asyncio.gather(
        *(search_one(name, stored_names) for name, stored_names in active_files.items()),
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

    ranked = sorted(
        results,
        key=lambda item: (
            getattr(item[1], "score", float("inf"))
            if isinstance(getattr(item[1], "score", None), (int, float))
            else float("inf")
        ),
    )
    for collection_name, result in ranked:
        content = getattr(result, "content", "").strip()
        if not content:
            continue

        distance = getattr(result, "score", None)
        if not isinstance(distance, (int, float)) or not math.isfinite(distance):
            continue
        if distance > settings.rag_distance_threshold:
            continue

        key = content[:300]
        if key in seen:
            continue
        seen.add(key)
        filtered.append((collection_name, result))
    return filtered


def _format_rag_context(results: list[tuple[str, object]]) -> str:
    if not results:
        return _format_empty_rag_context("没有找到与用户问题相关的文件库内容。")

    parts = ["[检索到的参考内容]"]
    total_chars = 0

    for index, (collection_name, result) in enumerate(
        results[: settings.rag_top_k * 2], start=1
    ):
        metadata = getattr(result, "metadata", None) or {}
        source = metadata.get("source") or metadata.get("file_name") or "unknown"
        distance = getattr(result, "score", None)
        content = getattr(result, "content", "").strip()

        block = (
            f"\n[来源 {index}]\n"
            f"文件库：{collection_name}\n"
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
        "[文件库检索结果]\n"
        f"{reason}\n"
        "如果回答需要依赖文件库，请明确说明未找到相关资料，不要编造。"
    )


@tool
async def base_search_file(query: str) -> str:
    """搜索已加入 AI 知识的内容（文件库文档 + 博客文章）的语义相关片段。
    当需要从用户上传的文件或博客文章中查找信息、回答事实性问题时使用此工具。
    参数 query: 搜索查询字符串。"""
    from src.services.infra.embeddings.embedding_service import get_embeddings
    from src.core.context import current_user_id_cv

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "未认证用户无法检索文件库。"

    active_files = await _get_active_file_whitelist(user_id=user_id)
    if not active_files:
        return _format_empty_rag_context("文件库中没有可检索的文档。")

    try:
        embeddings = await get_embeddings([query])
    except Exception:
        return "无法生成查询嵌入"

    results = await _search_collections(active_files, query, embeddings[0], user_id=user_id)
    results = _filter_and_dedupe_rag_results(results)
    return _format_rag_context(results)
