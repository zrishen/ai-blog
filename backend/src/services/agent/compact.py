"""上下文压缩：历史 raw token 超阈值时把较早消息 LLM 摘要，保留最近 N 条原文。

- 触发：estimate_history_tokens(raw) > threshold 且 len(raw) > recent_count
- 增量摘要：只摘要 id > summary_until_message_id 的消息，避免重复摘要
- 失败兜底由调用方（_build_messages）回退全 raw；摘要 usage 由 stream_chat 计入订阅配额
"""

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import Conversation
from src.services.agent.token_estimate import estimate_tokens


def _message_text(content: Any) -> str:
    """提取消息 content 的纯文本（str 直返；list 取 text/output_text block）。"""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else str(content)
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
            text = block.get("text", block.get("content", ""))
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


def estimate_history_tokens(raw: list) -> int:
    """粗估 raw 历史消息（ORM Message / SimpleNamespace）的总 token 数。"""
    return sum(estimate_tokens(_message_text(getattr(m, "content", None))) for m in raw)


def select_to_summarize(raw: list, conv: Any, recent_count: int) -> list:
    """从 raw[:-recent_count] 中选出尚未摘要的消息（id > summary_until_message_id），保留顺序。"""
    until_id = getattr(conv, "summary_until_message_id", None) or 0
    head = list(raw[:-recent_count]) if recent_count > 0 else list(raw)
    return [m for m in head if (getattr(m, "id", None) or 0) > until_id]


# summarizer: async (old_summary, msgs) -> (new_summary, usage_metadata | None)
Summarizer = Callable[[str | None, list], Awaitable[tuple[str, dict | None]]]


async def compact_history(
    db_session: AsyncSession,
    conv: Conversation,
    raw: list,
    summarizer: Summarizer,
    threshold: int,
    recent_count: int,
) -> tuple[list, dict | None]:
    """压缩历史：超阈值时把较早消息摘要，返回 ``(recent_raw, usage|None)``。

    未触发返回 ``(raw, None)`` 不做改动；触发时持久化到 Conversation（重新 attach 避免
    detached 写不进去）并同步到传入 conv，供调用方注入 system 摘要；usage 供其计入配额。
    """
    total = estimate_history_tokens(raw)
    if total <= threshold or len(raw) <= recent_count:
        return raw, None

    recent = list(raw[-recent_count:]) if recent_count > 0 else []
    to_summarize = select_to_summarize(raw, conv, recent_count)
    if not to_summarize:
        return raw, None

    new_summary, usage = await summarizer(getattr(conv, "summary", None), to_summarize)

    fresh = await db_session.get(Conversation, conv.id)
    if fresh is not None:
        fresh.summary = new_summary
        fresh.summary_until_message_id = to_summarize[-1].id
        await db_session.commit()
    # 同步到传入 conv（可能 detached）：调用方据此注入 system 摘要
    conv.summary = new_summary
    conv.summary_until_message_id = to_summarize[-1].id
    return recent, usage
