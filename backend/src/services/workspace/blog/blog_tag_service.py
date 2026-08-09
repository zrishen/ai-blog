"""博客标签生成服务。"""

import asyncio
import logging
import re

from openai import AsyncOpenAI

from src.config import settings
from src.database.models import BlogPost
from src.services.workspace.blog.blog_body_service import get_post_body

logger = logging.getLogger(__name__)

TAG_SUGGEST_TIMEOUT = 15
TAG_SUGGEST_RETRIES = 2


async def _call_llm(client: AsyncOpenAI, prompt: str) -> str:
    async with asyncio.timeout(TAG_SUGGEST_TIMEOUT):
        resp = await client.chat.completions.create(
            model=settings.model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
        )
    raw = resp.choices[0].message.content or ""
    logger.info("suggest_tags raw response: %r", raw[:200])
    return raw


def _parse_tags(raw: str) -> list[str]:
    """从 LLM 返回文本中提取标签，兼容多种格式。"""
    text = raw.strip()
    if not text:
        return []

    # 策略1：纯逗号/中文逗号/顿号分隔
    parts = re.split(r"[,，、]+", text)
    tags = []
    for p in parts:
        tag = _clean_tag(p)
        if tag:
            tags.append(tag)

    if tags:
        return tags[:5]

    # 策略2：换行分隔（每行一个）
    parts = text.split("\n")
    tags = []
    for p in parts:
        tag = _clean_tag(p)
        if tag:
            tags.append(tag)

    return tags[:5] if tags else []


def _clean_tag(raw: str) -> str | None:
    """清理单个标签：去除编号、引号、前后缀。"""
    tag = raw.strip()
    if not tag or len(tag) < 2:
        return None
    # 去除前缀编号: "1." "1、" "1）" "(1)" "- "
    tag = re.sub(r"^[\d\.\、\)\-\*\#]+\s*", "", tag)
    # 去除引号
    tag = tag.strip("\"'""「」『』【】《》")
    # 去除常见无意义后缀
    tag = re.sub(r"[;；:：]+$", "", tag)
    tag = tag.strip()
    if len(tag) < 2:
        return None
    return tag


async def suggest_tags(post: BlogPost) -> list[str]:
    title = post.title or ""
    excerpt = (post.excerpt or await get_post_body(post) or "")[:500]
    if not title and not excerpt:
        return []

    prompt = (
        "根据以下博客文章的标题和内容摘要，生成3-5个合适的标签。"
        "只返回标签，用逗号分隔，不要编号，不要解释。\n\n"
        f"标题：{title}\n摘要：{excerpt}"
    )
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)
        for attempt in range(TAG_SUGGEST_RETRIES):
            raw = await _call_llm(client, prompt)
            tags = _parse_tags(raw)
            if tags:
                return tags
            if attempt < TAG_SUGGEST_RETRIES - 1:
                logger.warning("suggest_tags empty response, retrying (attempt %d/%d)", attempt + 1, TAG_SUGGEST_RETRIES)
        return []
    except asyncio.TimeoutError:
        logger.warning("suggest_tags timeout for post_id=%s", post.id)
        raise
    except Exception:
        logger.exception("suggest_tags failed for post_id=%s", post.id)
        raise
