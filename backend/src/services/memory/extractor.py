"""大脑抽取：LLM 从文本抽取 Entity/Fact/Episode/Preference，供 consolidator 巩固入图。

抽取档位（settings.memory_extract_depth，默认 deep）：
- deep=Entity+Fact(主谓宾)+Episode+Preference；Fact 是大脑时序记忆核心，默认开启。
- light=仅 Entity+Episode；仅在显式降级（成本/噪音）时使用。
prompt 唯一源：services/memory/prompts.py。
LLM 由调用方传入（对话用用户的 LLM；文档用 fast 档 LLM）。
"""

import json
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from src.config import settings
from src.services.memory.prompts import (
    EXTRACTION_SYSTEM,
    EXTRACTION_USER_DEEP,
    EXTRACTION_USER_LIGHT,
)

logger = logging.getLogger(__name__)

_MAX_INPUT_CHARS = 8000


async def extract(text: str, llm: BaseChatModel, *, depth: str | None = None) -> dict:
    """从 text 抽取 {entities, facts, episodes, preferences}。

    Args:
        text: 待抽取文本（对话/文档片段），超 _MAX_INPUT_CHARS 截断。
        llm: 调用方提供的 LangChain ChatModel（用户的 BYOK / 平台 key）。
        depth: light / deep，默认 settings.memory_extract_depth。
    """
    depth = depth or settings.memory_extract_depth
    user_tpl = EXTRACTION_USER_DEEP if depth == "deep" else EXTRACTION_USER_LIGHT
    messages = [
        SystemMessage(content=EXTRACTION_SYSTEM),
        HumanMessage(content=user_tpl + "\n\n--- 文本 ---\n" + text[:_MAX_INPUT_CHARS]),
    ]
    try:
        resp = await llm.ainvoke(messages)
        return _parse(str(resp.content))
    except Exception:
        logger.exception("extract LLM call failed")
        return {"entities": [], "facts": [], "episodes": [], "preferences": []}


def _parse(content: str) -> dict:
    """解析 LLM JSON 输出为 {entities, facts, episodes, preferences}，容忍 ```json fence 与多余文本。"""
    empty = {"entities": [], "facts": [], "episodes": [], "preferences": []}
    text = content.strip()
    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("extract output not valid JSON, returning empty")
        return empty
    return {
        "entities": data.get("entities", []),
        "facts": data.get("facts", []),
        "episodes": data.get("episodes", []),
        "preferences": data.get("preferences", []),
    }
