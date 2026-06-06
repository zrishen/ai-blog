"""意图分类 Router - 在 MCP/RAG 前快速判断用户意图。"""

import asyncio
import logging

from openai import AsyncOpenAI

from src.config import settings

logger = logging.getLogger(__name__)

_ROUTER_LABELS = frozenset({"MCP", "RAG", "MCP+RAG", "DIRECT"})
_KNOWLEDGE_KEYWORDS = (
    "知识库",
    "上传文件",
    "上传的文件",
    "上传的文档",
    "文档里",
    "资料里",
    "根据文档",
    "根据资料",
    "库里的",
)
_REALTIME_KEYWORDS = ("天气", "时间", "几点", "实时", "新闻", "股价", "汇率", "今天")

_ROUTER_PROMPT_TEMPLATE = (
    "你是一个意图分类器。分析用户的问题，判断需要调用哪些功能来回答。\n\n"
    "可选功能：\n"
    "- MCP工具：{tool_descriptions}\n"
    "- RAG知识库：从已上传的文档/知识库中检索相关内容\n\n"
    "分类规则：\n"
    "- 用户问天气、时间、实时新闻、股价等需要实时数据的信息 → MCP\n"
    "- 用户问公司政策、文档内容、某篇论文的核心方法等需要从知识库查的内容 → RAG\n"
    "- 用户需要同时查文档和实时数据（如'结合公司年报和今天股价'） → MCP+RAG\n"
    "- 普通对话、问候、闲聊、无需特殊处理的常识问题 → DIRECT\n\n"
    "仅返回一个标签，不要其他内容。"
)


async def classify_intent(user_message: str, has_tools: bool = True, tool_descriptions: str = "") -> str:
    """判断用户消息意图，返回 MCP / RAG / MCP+RAG / DIRECT。

    Args:
        user_message: 用户输入的消息。
        has_tools: 当前是否有可用的 MCP 工具。

    Returns:
        分类标签。API 异常时兜底返回 'DIRECT'。
    """
    if not settings.router_enabled:
        logger.debug("Router disabled via config, skipping classification")
        return "DIRECT"

    normalized_message = user_message.lower()
    if any(keyword in normalized_message for keyword in _KNOWLEDGE_KEYWORDS):
        label = "MCP+RAG" if any(keyword in normalized_message for keyword in _REALTIME_KEYWORDS) else "RAG"
        logger.info("Router keyword rule matched: label=%s", label)
        return label

    if not has_tools:
        logger.info("Router: no tools available, defaulting to RAG")
        return "RAG"

    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)

    logger.info(
        ">>> Router classifying: '%s' → model=%s",
        user_message[:80].replace("\n", " "),
        settings.router_model_name,
    )

    loop = asyncio.get_running_loop()
    start = loop.time()
    try:
        response = await client.chat.completions.create(
            model=settings.router_model_name,
            messages=[
                {"role": "system", "content": _ROUTER_PROMPT_TEMPLATE.format(
                    tool_descriptions=tool_descriptions or "无可用工具"
                )},
                {"role": "user", "content": user_message},
            ],
            max_tokens=10,
            temperature=0,
        )
        elapsed = loop.time() - start
        content = response.choices[0].message.content.strip() if response.choices else ""
        label = content.upper().strip()
        tokens_used = response.usage.total_tokens if response.usage else 0

        if "MCP+RAG" in label:
            label = "MCP+RAG"
        elif "MCP" in label:
            label = "MCP"
        elif "RAG" in label:
            label = "RAG"
        else:
            label = "DIRECT"
        if label != content.upper().strip():
            logger.warning(
                "Router: label '%s' normalized to '%s' (took %.1fs, %d tokens)",
                content, label, elapsed, tokens_used,
            )
        logger.info(
            "<<< Router result: %s (took %.1fs, %d tokens)",
            label, elapsed, tokens_used,
        )
        return label

    except Exception as e:
        elapsed = loop.time() - start
        logger.error(
            "Router classification failed: %s (took %.1fs), falling back to DIRECT",
            e, elapsed, exc_info=True,
        )
        return "DIRECT"
