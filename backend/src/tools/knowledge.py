"""Read-only knowledge-graph tool mounted by the knowledge skill."""

from __future__ import annotations

from langchain_core.tools import tool

from src.config import settings


@tool
async def knowledge_query_graph(query: str) -> str:
    """Query the user's knowledge graph for related entities and facts, with sources for citation."""

    from src.core.context import current_user_id_cv
    from src.services.infra.embeddings.embedding_service import get_embedding_collection_suffix, get_embeddings
    from src.services.memory import graph_store

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "未认证用户无法查询知识图谱。"
    try:
        embeddings = await get_embeddings([query])
    except Exception:
        return "无法生成知识图谱查询嵌入。"
    try:
        hits = await graph_store.recall(
            user_id=user_id,
            query_embedding=embeddings[0],
            embedding_model=get_embedding_collection_suffix(),
            top_k=settings.rag_top_k,
            kinds=["entity", "fact"],
        )
    except Exception:
        return "知识图谱检索暂时不可用。"
    return _format_graph_context(hits)


def _format_graph_context(hits) -> str:
    if not hits:
        return "[知识图谱查询结果]\n没有找到相关实体或事实。"
    parts = ["[知识图谱查询结果]"]
    for index, hit in enumerate(hits, start=1):
        metadata = hit.metadata or {}
        source = metadata.get("source") or metadata.get("source_doc_id") or "knowledge graph"
        parts.append(
            f"\n[来源 {index}]\n"
            f"知识类型：{hit.kind}\n"
            f"来源：{source}\n"
            f"相关距离：{hit.score if hit.score is not None else 'unknown'}\n"
            f"内容：\n{hit.content}"
        )
    return "\n".join(parts)
