"""大脑 recall LangChain 工具：回忆过往对话/用户偏好/实体关系（GraphRAG）。

与 base_search_file（检索已加入知识库的文档）并列，供 LLM 自主调用。
输出格式对齐 tools/file.py::_format_rag_context（来源：/相关距离：/内容：），
让 services/chat/references.py 无需改解析正则即可解析（额外加 记忆类型： 字段供区分）。
"""

import logging

from langchain_core.tools import tool

from src.config import settings

logger = logging.getLogger(__name__)

MEMORY_MAX_CONTEXT_CHARS = 6000


@tool
async def base_recall_memory(query: str) -> str:
    """回忆大脑记忆：过往对话、用户偏好、实体关系、时序事实。
    当需要回忆用户曾说过的事、用户偏好、或实体间关系时使用此工具
    （区别于文件库文档检索 base_search_file——后者检索上传的文档原文）。
    参数 query: 回忆查询字符串。"""
    from src.services.embeddings.embedding_service import get_embedding_collection_suffix, get_embeddings
    from src.tools.blog import current_user_id_cv

    user_id = current_user_id_cv.get()
    if user_id is None:
        return "未认证用户无法回忆记忆。"

    try:
        embeddings = await get_embeddings([query])
    except Exception:
        return "无法生成查询嵌入"

    from src.services.memory import graph_store

    hits = await graph_store.recall(
        user_id=user_id,
        query_embedding=embeddings[0],
        embedding_model=get_embedding_collection_suffix(),
        top_k=settings.memory_recall_top_k,
        hops=settings.memory_recall_hops,
    )
    if hits:
        try:
            await graph_store.touch_memories(user_id=user_id, hits=hits)
        except Exception:
            logger.warning("touch_memories failed; decay loop degraded", exc_info=True)
    return _format_memory_context(hits)


def _format_memory_context(hits) -> str:
    """输出对齐 _format_rag_context（来源：/相关距离：/内容：），references.py 可解析。"""
    if not hits:
        return (
            "[大脑记忆结果]\n"
            "没有找到与用户问题相关的记忆。\n"
            "如果回答需要依赖过往记忆，请明确说明暂无相关记忆，不要编造。"
        )
    parts = ["[回忆到的大脑记忆]"]
    total = 0
    for index, hit in enumerate(hits, start=1):
        metadata = hit.metadata or {}
        source = metadata.get("source") or "memory"
        score = hit.score if hit.score is not None else "unknown"
        content = str(hit.content).replace("[来源 ", "[来源​ ")
        time_value = metadata.get("occurred_at") or metadata.get("valid_from")
        status = "历史" if metadata.get("valid_to") else "当前"
        evidence = metadata.get("evidence")
        path = metadata.get("path")
        replaced = metadata.get("replaced") if hit.kind == "fact" else None
        block = (
            f"\n[来源 {index}]\n"
            f"记忆类型：{hit.kind}\n"
            f"来源：{source}\n"
            f"相关距离：{score}\n"
            f"排序分：{metadata.get('rank_score', 'unknown')}\n"
            f"有效状态：{status}\n"
            + (f"演化（取代旧值）：{'; '.join(replaced)}\n" if replaced else "")
            + f"时间：{time_value or 'unknown'}\n"
            f"证据：{evidence or 'direct-vector-match'}\n"
            f"图路径：{path or '[]'}\n"
            f"内容：\n{content}\n"
        )
        if total + len(block) > MEMORY_MAX_CONTEXT_CHARS:
            break
        parts.append(block)
        total += len(block)
    if len(parts) == 1:
        return (
            "[大脑记忆结果]\n"
            "检索到的记忆超过上下文限制，未能注入有效内容。\n"
        )
    return "\n".join(parts)


MEMORY_TOOLS = [base_recall_memory]
