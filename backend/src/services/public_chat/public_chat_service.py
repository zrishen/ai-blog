"""受限公开 AI 聊天服务：不绑定工具、不访问私有文件库、不保存工作台会话。"""

import json
import logging
from datetime import datetime
from typing import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.models import BlogPost, User
from src.services.chat.llm_factory import _create_llm
from src.services.llm.llm_settings_service import build_llm_model_kwargs
from src.services.user.official_intro_service import build_intro_post_payload

logger = logging.getLogger(__name__)


def _truncate(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[:max_chars]


_PROTOCOL_MARKERS = ("REASONING", "TOOLDONE", "BLOGDELTA", "PATCHSTART", "PATCHDELTA", "DONE")


def _strip_public_protocol_markers(text: str, *, final: bool = False) -> tuple[str, str]:
    """清理公开聊天输出中的协议标记，返回 (clean_text, remainder)。

    命中标记且 JSON 完整则整段清除；JSON 不完整（chunk 边界切在中间）时：流处理中把标记起至
    末尾留作 remainder 供下个 chunk 重处理，流结束时当普通文本输出、绝不截断后续内容。
    """
    normalized = text.replace("\x00", "").replace("�", "")
    decoder = json.JSONDecoder()
    parts: list[str] = []
    index = 0

    while index < len(normalized):
        marker = next((name for name in _PROTOCOL_MARKERS if normalized.startswith(name, index)), None)
        if not marker:
            parts.append(normalized[index])
            index += 1
            continue

        payload_start = index + len(marker)
        p = payload_start
        while p < len(normalized) and normalized[p].isspace():
            p += 1
        if p < len(normalized) and normalized[p] == "{":
            try:
                _, payload_end = decoder.raw_decode(normalized[p:])
                index = p + payload_end
                continue
            except ValueError:
                if not final:
                    # 可能是 chunk 切在标记 JSON 中间，保留到下一 chunk 再判
                    return "".join(parts), normalized[index:]
                # 流结束仍不完整：标记当普通文本输出，避免静默截断
                parts.append(normalized[index:payload_start])
                index = payload_start
                continue

        # 标记后非 JSON：标记名作为普通文本保留
        parts.append(normalized[index])
        index += 1

    return "".join(parts), ""


async def _landing_context(db: AsyncSession) -> str:
    doc = build_intro_post_payload()
    parts = [
        "[平台公开介绍]",
        f"标题：{doc['title']}\n摘要：{doc.get('excerpt', '') or ''}\n内容：{_truncate(doc.get('content', '') or '', 1500)}",
    ]
    return _truncate("\n\n".join(parts), settings.public_chat_max_context_chars)


async def _user_public_context(db: AsyncSession, username: str, post_slug: str | None = None) -> str | None:
    user_result = await db.execute(select(User).where(User.username == username))
    owner = user_result.scalar_one_or_none()
    if not owner:
        return None

    stmt = select(BlogPost).where(
        BlogPost.user_id == owner.id,
        BlogPost.status == "published",
        BlogPost.deleted_at.is_(None),
    )
    if post_slug:
        stmt = stmt.where(BlogPost.slug == post_slug)
    stmt = stmt.order_by(BlogPost.created_at.desc()).limit(8)
    result = await db.execute(stmt)
    posts = result.scalars().all()

    parts = [f"[公开博客上下文]\n博客作者：{owner.username}"]
    if not posts:
        parts.append("该用户暂无公开文章。")
    for post in posts:
        parts.append(f"标题：{post.title}\n摘要：{post.excerpt or ''}\n内容：{_truncate(post.content or '', 1500)}")
    return _truncate("\n\n".join(parts), settings.public_chat_max_context_chars)


def _system_prompt(context: str) -> str:
    today = datetime.now().strftime("%Y年%m月%d日")
    return (
        f"当前日期：{today}。\n\n"
        "你是 AI Blog 的公开访客助手，只能进行普通聊天。"
        "你不能创建、编辑、删除或发布博客，不能访问私有文件库，不能调用 MCP 或任何工具。"
        "如果用户要求执行管理操作，请说明需要登录为站点主人并使用完整助手。"
        "你可以基于以下公开上下文和通用知识回答：\n\n"
        f"{context}"
    )


async def public_stream_chat(
    db: AsyncSession,
    content: str,
    *,
    username: str | None = None,
    post_slug: str | None = None,
) -> AsyncGenerator[str, None]:
    if len(content) > settings.public_chat_max_input_chars:
        yield f"输入过长，请控制在 {settings.public_chat_max_input_chars} 字以内。"
        return

    if username:
        context = await _user_public_context(db, username, post_slug)
        if context is None:
            yield "用户不存在。"
            return
    else:
        context = await _landing_context(db)

    model_kwargs = build_llm_model_kwargs("fast", None, allow_official_fallback=True)
    model_kwargs["temperature"] = 0.7
    model_kwargs["max_tokens"] = settings.public_chat_max_output_tokens
    llm = _create_llm(model_kwargs, "fast")
    messages = [
        {"role": "system", "content": _system_prompt(context)},
        {"role": "user", "content": content},
    ]

    try:
        buffer = ""
        async for chunk in llm.astream(messages):
            if chunk.content:
                buffer += str(chunk.content)
                clean, buffer = _strip_public_protocol_markers(buffer)
                if clean:
                    yield clean
        # 流结束：处理剩余 buffer；不完整的标记作为普通文本输出，绝不截断
        if buffer:
            clean, _ = _strip_public_protocol_markers(buffer, final=True)
            if clean:
                yield clean
    except Exception as e:
        logger.error("Public chat failed: %s", e, exc_info=True)
        yield "抱歉，公开 AI 助手暂时无法响应。"
