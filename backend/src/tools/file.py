"""文件库检索 LangChain 工具 + RAG 辅助函数。"""

import asyncio

from langchain_core.tools import tool

from src.config import settings

RAG_MAX_CONTEXT_CHARS = 6000


# ════════════════════════════════════════════════════════════════
# RAG 辅助函数
# ════════════════════════════════════════════════════════════════


async def _get_active_file_whitelist(user_id: int | None = None) -> dict[str, set[str]]:
    """检索白名单：仅「加入 AI 知识」且索引 active 的文件（RagSource）。

    RAG 解耦后上传不再自动索引；只有 RagSource(active) 对应的文件可被检索。
    """
    if user_id is None:
        return {}

    from sqlalchemy import select

    from src.database.models import FileDocument, RagSource
    from src.database.session import async_session

    async with async_session() as db:
        result = await db.execute(
            select(FileDocument.collection_name, FileDocument.file_path)
            .join(RagSource, RagSource.resource_id == FileDocument.id)
            .where(
                RagSource.user_id == user_id,
                RagSource.resource_type == "file",
                RagSource.index_status == "active",
                FileDocument.deleted_at.is_(None),
            )
        )

    whitelist: dict[str, set[str]] = {}
    for collection_name, stored_name in result.all():
        whitelist.setdefault(collection_name, set()).add(stored_name)
    return whitelist


async def _search_collections(
    active_files: dict[str, set[str]],
    query: str,
    query_embedding: list[float],
) -> list[tuple[str, object]]:
    from src.services.rag.vector_store import search

    async def search_one(name: str, stored_names: set[str]) -> list[tuple[str, object]]:
        try:
            results = await search(name, query, query_embedding, settings.rag_top_k)
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

    filtered.sort(
        key=lambda item: (
            getattr(item[1], "distance", None)
            if getattr(item[1], "distance", None) is not None
            else float("inf")
        )
    )
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
        distance = getattr(result, "distance", None)
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


# ════════════════════════════════════════════════════════════════
# 文件库搜索工具
# ════════════════════════════════════════════════════════════════


@tool
async def base_search_file(query: str) -> str:
    """搜索文件库中的文件内容。当需要查找已上传的文件、文件库文档时使用此工具。
    参数 query: 搜索查询字符串。"""
    from src.services.rag.embedding_service import get_embeddings
    from src.tools.blog import current_user_id_cv

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

    results = await _search_collections(active_files, query, embeddings[0])
    results = _filter_and_dedupe_rag_results(results)
    return _format_rag_context(results)


# ════════════════════════════════════════════════════════════════
# 工具列表
# ════════════════════════════════════════════════════════════════

RAG_TOOLS = [
    base_search_file,
]
