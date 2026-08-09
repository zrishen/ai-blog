"""LLM 工厂：按协议（openai / anthropic / deepseek）构造 Chat 模型实例与请求参数。

统一注入 stream_chunk_timeout（从 settings 读），避免 langchain watchdog 吞异常导致 stream 挂死。
"""

import json
import logging
from typing import Any

from langchain_openai import ChatOpenAI

try:
    from langchain_anthropic import ChatAnthropic
    _HAS_ANTHROPIC = True
except ImportError:
    ChatAnthropic = None
    _HAS_ANTHROPIC = False

try:
    from langchain_deepseek import ChatDeepSeek
    _HAS_DEEPSEEK = True
except ImportError:
    _HAS_DEEPSEEK = False

from src.config import settings
from src.prompts import PromptSegment
from .llm_settings_service import build_llm_model_kwargs

logger = logging.getLogger(__name__)


def _system_prompt(
    segments: list[PromptSegment],
    *,
    today: str,
    mcp_capabilities_text: str = "",
) -> str:
    """瘦渲染器：只拼接已由 resolve_active_segments 解析的段。

    format_keys 非空才 .format（值取自 today/mcp_capabilities_text），零条件判断——
    门控全在 PromptSegment.condition，本函数不重复判定。
    """
    fmt = {"today": today, "cap_text": mcp_capabilities_text}
    parts: list[str] = []
    for seg in segments:
        if seg.format_keys:
            parts.append(seg.template.format(**{k: fmt[k] for k in seg.format_keys}))
        else:
            parts.append(seg.template)
    return "".join(parts)


def _extra_body_for_mode(thinking_mode: str) -> dict[str, Any] | None:
    raw_map = {
        "fast": settings.fast_extra_body,
        "balanced": settings.balanced_extra_body,
        "smart": settings.smart_extra_body,
    }
    raw = raw_map.get(thinking_mode)
    if not raw:
        return None
    try:
        extra_body = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("Invalid thinking extra_body JSON for mode=%s: %s", thinking_mode, e)
        return None
    if not isinstance(extra_body, dict):
        logger.warning("Ignoring thinking extra_body for mode=%s because it is not a JSON object", thinking_mode)
        return None
    return extra_body


def _chat_model_kwargs(
    thinking_mode: str,
    llm_settings=None,
    *,
    allow_official_fallback: bool = False,
) -> dict[str, Any]:
    kwargs = build_llm_model_kwargs(
        thinking_mode, llm_settings, allow_official_fallback=allow_official_fallback
    )
    extra_body = _extra_body_for_mode(thinking_mode)
    if extra_body and kwargs.get("protocol") == "openai":
        reasoning_effort = extra_body.pop("reasoning_effort", None)
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        if extra_body:
            kwargs["extra_body"] = extra_body
    return kwargs


def _create_llm(model_kwargs: dict[str, Any], thinking_mode: str):
    """按协议选择模型类；DeepSeek 模型始终用 ChatDeepSeek 以捕获 reasoning_content 推理链。"""
    protocol = model_kwargs.get("protocol", "openai")
    llm_kwargs = {k: v for k, v in model_kwargs.items() if k != "protocol"}
    stream_usage = llm_kwargs.pop("stream_usage", False)
    sct = settings.langchain_stream_chunk_timeout
    if protocol == "anthropic":
        if not _HAS_ANTHROPIC or ChatAnthropic is None:
            raise RuntimeError("Anthropic protocol requires langchain-anthropic")
        anthropic_kwargs = {
            k: v
            for k, v in llm_kwargs.items()
            if k not in ("api_key", "base_url", "reasoning_effort", "extra_body")
        }
        reasoning_effort = llm_kwargs.get("reasoning_effort")
        if reasoning_effort:
            model_name = str(llm_kwargs.get("model", "")).lower()
            if "claude" in model_name and any(version in model_name for version in ("4-7", "4.7")):
                anthropic_kwargs["thinking"] = {"type": "adaptive", "display": "summarized"}
                anthropic_kwargs["effort"] = reasoning_effort
            else:
                budget_map = {
                    "fast": settings.fast_thinking_budget_tokens,
                    "balanced": settings.balanced_thinking_budget_tokens,
                    "smart": settings.smart_thinking_budget_tokens,
                }
                desired_budget = budget_map.get(thinking_mode, settings.balanced_thinking_budget_tokens)
                # Anthropic 要求 max_tokens 严格大于 budget_tokens(max_tokens 是 thinking+最终回复的总上限)
                # 否则部分兼容层会静默关闭 thinking。这里把 budget 限制为 max_tokens 的 70%,留出回复空间
                max_tokens = anthropic_kwargs.get("max_tokens") or settings.llm_max_output_tokens
                safe_budget = min(desired_budget, int(max_tokens * 0.7))
                anthropic_kwargs["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": safe_budget,
                }
        if llm_kwargs.get("api_key"):
            anthropic_kwargs["anthropic_api_key"] = llm_kwargs["api_key"]
        if llm_kwargs.get("base_url"):
            anthropic_kwargs["anthropic_api_url"] = llm_kwargs["base_url"]
        return ChatAnthropic(**anthropic_kwargs)

    model_name = llm_kwargs.get("model", "")
    if _HAS_DEEPSEEK and "deepseek" in model_name.lower():
        ds_kwargs = {**llm_kwargs}
        if "base_url" in ds_kwargs:
            ds_kwargs["api_base"] = ds_kwargs.pop("base_url")
        if sct is not None:
            ds_kwargs["stream_chunk_timeout"] = sct
        if stream_usage:
            ds_kwargs["stream_usage"] = True
        return ChatDeepSeek(**ds_kwargs)
    oai_kwargs = {**llm_kwargs}
    if sct is not None:
        oai_kwargs["stream_chunk_timeout"] = sct
    if stream_usage:
        oai_kwargs["stream_usage"] = True
    return ChatOpenAI(**oai_kwargs)
