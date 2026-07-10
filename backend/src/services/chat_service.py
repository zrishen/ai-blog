"""Chat service — LangGraph ReAct Agent + MCP tools + RAG."""

import asyncio
import json
import logging
import re
import time
from datetime import datetime
from typing import Any, AsyncGenerator

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

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
from src.database.engine import (
    add_message_pair,
    async_session,
    get_conversation,
    get_messages,
    update_conversation_title,
)
from src.services.conversation_service import save_agent_messages
from src.services.llm_settings_service import (
    build_llm_model_kwargs,
    get_user_llm_settings,
    has_usable_api_key,
)
from src.tools.blog import BLOG_TOOLS, current_user_id_cv
from src.tools.file import base_search_file
from langchain_core.messages import AIMessage, ToolMessage
from src.tools.mcp import build_mcp_call_tool, format_mcp_capabilities, normalize_mcp_capabilities
from src.tools.research import RESEARCH_TOOLS
from src.prompts import (
    SYSTEM_BASE,
    SYSTEM_DATE,
    SYSTEM_SMART_THINKING,
    SYSTEM_TOOL_RULES,
    RAG_AUTO,
    MCP_CAPABILITIES,
    CTX_POST,
    CTX_FILES,
    CTX_HOME,
    CTX_ABOUT,
    CTX_RESEARCH,
    CTX_RESEARCH_TOPIC,
    CTX_SELECTED_TEXT,
    CTX_SELECTED_TEXT_LABEL,
    CTX_SELECTED_SECTION,
    CTX_RESEARCH_TOPIC_ID,
    CTX_TRUST_WRITING,
    RESEARCH_TOOL_RULES,
    TRUST_CHOICE_PROTOCOL,
)

logger = logging.getLogger(__name__)
_DONE_MARKER = chr(0)
_BLOGDELTA_MARKER = f"{_DONE_MARKER}BLOGDELTA{_DONE_MARKER}"
_REASONING_MARKER = f"{_DONE_MARKER}REASONING{_DONE_MARKER}"
_PATCHSTART_MARKER = f"{_DONE_MARKER}PATCHSTART{_DONE_MARKER}"
_PATCHDELTA_MARKER = f"{_DONE_MARKER}PATCHDELTA{_DONE_MARKER}"
_LOOPSTEP_MARKER = f"{_DONE_MARKER}LOOPSTEP{_DONE_MARKER}"

_MISSING_API_KEY_MESSAGE = "请先在「设置」页填写你自己的 API 密钥后再发起对话。"


class _MissingApiKeyError(RuntimeError):
    """登录用户未填写自有 API 密钥时抛出，由 stream_chat 主流程捕获并返回提示。"""


# ── Token estimation ──

def estimate_tokens(text: str | list) -> int:
    if isinstance(text, list):
        text = " ".join(p.get("text", "") for p in text if p.get("type") == "text")
    cjk = sum(1 for c in text if "一" <= c <= "鿿")
    return max(1, (cjk // 2) + ((len(text) - cjk) // 4))


# ── System prompt ──

def _system_prompt(
    tool_names: list[str],
    thinking_mode: str = "balanced",
    mcp_capabilities_text: str = "",
) -> str:
    today = datetime.now().strftime("%Y年%m月%d日")
    base = SYSTEM_BASE + SYSTEM_DATE.format(today=today)
    if _is_smart_thinking(thinking_mode):
        base += SYSTEM_SMART_THINKING
    if tool_names:
        names = "、".join(tool_names)
        base += SYSTEM_TOOL_RULES.format(names=names)
    base += RAG_AUTO
    if mcp_capabilities_text:
        base += MCP_CAPABILITIES.format(cap_text=mcp_capabilities_text)
    return base


def _is_smart_thinking(thinking_mode: str) -> bool:
    return thinking_mode == "smart"


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


def _chat_model_kwargs(thinking_mode: str, llm_settings=None) -> dict[str, Any]:
    kwargs = build_llm_model_kwargs(thinking_mode, llm_settings)
    extra_body = _extra_body_for_mode(thinking_mode)
    if extra_body and kwargs.get("protocol") == "openai":
        kwargs["extra_body"] = extra_body
    return kwargs


def _create_llm(model_kwargs: dict[str, Any], thinking_mode: str):
    """根据模型名选择 ChatDeepSeek 或 ChatOpenAI。

    DeepSeek 模型无论深度/普通模式都使用 ChatDeepSeek，
    以正确捕获 reasoning_content 推理链。

    所有协议统一注入 stream_chunk_timeout（从 settings 读），调大到思考模型够用；
    避免触发 langchain 内部 watchdog 后被 astream_events 吞异常导致 stream 挂死。
    """
    protocol = model_kwargs.get("protocol", "openai")
    llm_kwargs = {k: v for k, v in model_kwargs.items() if k != "protocol"}
    sct = settings.langchain_stream_chunk_timeout
    if protocol == "anthropic":
        if not _HAS_ANTHROPIC or ChatAnthropic is None:
            raise RuntimeError("Anthropic protocol requires langchain-anthropic")
        anthropic_kwargs = {k: v for k, v in llm_kwargs.items() if k not in ("api_key", "base_url")}
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
        return ChatDeepSeek(**ds_kwargs)
    oai_kwargs = {**llm_kwargs}
    if sct is not None:
        oai_kwargs["stream_chunk_timeout"] = sct
    return ChatOpenAI(**oai_kwargs)


async def _astream_events_with_heartbeat(
    events_gen: AsyncGenerator[dict[str, Any], None],
    idle_timeout: float,
) -> AsyncGenerator[dict[str, Any], None]:
    """给 astream_events 加间隔超时兜底。

    langchain 内部 stream_chunk_timeout 触发后,StreamChunkTimeoutError 在某些路径
    下被 astream_events 静默吞掉,外层 async for 永远等不到下一个 event。本 helper
    在 __anext__ 上额外加 asyncio.wait_for,idle_timeout 秒无 event 主动 raise
    TimeoutError,让上层 except 正常捕获并派发 DONE marker / 入库消息。
    """
    it = events_gen.__aiter__()
    try:
        while True:
            try:
                event = await asyncio.wait_for(it.__anext__(), timeout=idle_timeout)
            except StopAsyncIteration:
                return
            yield event
    finally:
        aclose = getattr(it, "aclose", None)
        if aclose is not None:
            try:
                await asyncio.wait_for(aclose(), timeout=5)
            except Exception:
                logger.debug("astream_events aclose timed out or failed", exc_info=True)


# ── Reference extraction ──

def _extract_references(tool_name: str, result_text: str, tool_input: dict | None = None) -> list[dict[str, Any]]:
    """从工具返回结果中提取引用信息（RAG 来源 / MCP 服务）。"""
    refs: list[dict[str, Any]] = []
    if tool_name == "base_search_file":
        for m in re.finditer(r"来源[：:]\s*(\S+)", result_text):
            source = m.group(1).rstrip("，。")
            collection_m = re.search(r"文件库[：:]\s*(\S+)", result_text[m.start():m.start() + 200])
            distance_m = re.search(r"相关距离[：:]\s*([\d.]+|unknown)", result_text[m.start():m.start() + 200])
            ref: dict[str, Any] = {"type": "rag", "source": source}
            if collection_m:
                ref["collection"] = collection_m.group(1).rstrip("，。")
            if distance_m and distance_m.group(1) != "unknown":
                try:
                    ref["distance"] = float(distance_m.group(1))
                except ValueError:
                    pass
            refs.append(ref)
    elif tool_name == "mcp_call_tool" and tool_input:
        tool_ref = str(tool_input.get("tool_ref", ""))
        if "/" in tool_ref:
            server_name, tool_n = tool_ref.split("/", 1)
            refs.append({"type": "mcp", "server": server_name, "tool": tool_n})
    return refs


# ── Blog meta extraction ──

_BLOG_META_PATTERNS: dict[str, tuple[str, ...]] = {
    "blog_create_post": ("id", "slug", "title", "status"),
    "blog_write_post": ("id", "slug", "title", "status"),
    "blog_edit_post": ("id", "slug",),
    "blog_delete_post": ("id", "slug", "title"),
}


def _extract_blog_meta(tool_name: str, result_text: str) -> dict[str, object] | None:
    """从博客工具返回文本中提取结构化元数据。"""
    fields = _BLOG_META_PATTERNS.get(tool_name)
    if not fields:
        return None
    meta: dict[str, object] = {"operation": tool_name.removeprefix("blog_")}
    for field in fields:
        m = re.search(rf"\b{field}=(\S+)", result_text)
        if m:
            val: str = m.group(1).rstrip(",")
            if field == "id":
                try:
                    meta["post_id"] = int(val)
                except ValueError:
                    meta[field] = val
            else:
                meta[field] = val
    return meta if len(meta) > 1 else None


async def _auto_link_research_context_to_blog_post(
    blog_meta: dict[str, object] | None,
    research_topic_id: object,
    user_id: int,
    enabled: bool,
) -> dict[str, object] | None:
    if not enabled or not blog_meta:
        return None
    post_id = blog_meta.get("post_id")
    if not isinstance(post_id, int) or post_id <= 0:
        return None
    try:
        topic_id = int(research_topic_id or 0)
    except (TypeError, ValueError):
        return None
    if topic_id <= 0:
        return None

    from src.services.research_service import attach_adopted_claims_for_topic_to_post, attach_topic_to_post

    try:
        async with async_session() as session:
            topic_link = await attach_topic_to_post(session, post_id, topic_id, user_id)
            claim_count = await attach_adopted_claims_for_topic_to_post(
                session,
                post_id,
                topic_id,
                user_id,
                "AI 可信写作自动关联",
            )
    except Exception as exc:
        logger.warning("自动关联研究上下文到文章失败 post_id=%s topic_id=%s: %s", post_id, topic_id, exc)
        return {"topic_linked": False, "claim_linked_count": 0, "error": "auto_link_failed"}

    return {"topic_linked": bool(topic_link), "claim_linked_count": claim_count}


def _extract_partial_content(args_json: str) -> str | None:
    """从 partial JSON args 中提取 content 字段的值（已生成部分）。"""
    match = re.search(r'"content"\s*:\s*"', args_json)
    if not match:
        return None
    start = match.end()
    i = start
    result: list[str] = []
    while i < len(args_json):
        ch = args_json[i]
        if ch == "\\" and i + 1 < len(args_json):
            next_ch = args_json[i + 1]
            if next_ch == '"':
                result.append('"')
            elif next_ch == "\\":
                result.append("\\")
            elif next_ch == "n":
                result.append("\n")
            elif next_ch == "t":
                result.append("\t")
            else:
                result.append(next_ch)
            i += 2
        elif ch == '"':
            return "".join(result)
        else:
            result.append(ch)
            i += 1
    return "".join(result)


def _extract_partial_target(args_json: str) -> str | None:
    match = re.search(r'"target_text"\s*:\s*"', args_json)
    if not match:
        return None
    return _extract_partial_json_string(args_json, match.end())


def _extract_partial_replacement(args_json: str) -> str | None:
    match = re.search(r'"replacement_text"\s*:\s*"', args_json)
    if not match:
        return None
    return _extract_partial_json_string(args_json, match.end())


def _extract_partial_json_string(value: str, start: int) -> str:
    i = start
    result: list[str] = []
    while i < len(value):
        ch = value[i]
        if ch == "\\" and i + 1 < len(value):
            next_ch = value[i + 1]
            if next_ch == '"':
                result.append('"')
            elif next_ch == "\\":
                result.append("\\")
            elif next_ch == "n":
                result.append("\n")
            elif next_ch == "t":
                result.append("\t")
            else:
                result.append(next_ch)
            i += 2
        elif ch == '"':
            return "".join(result)
        else:
            result.append(ch)
            i += 1
    return "".join(result)


# ── Message building ──

async def _build_messages(
    user_message: str,
    conversation_id: int | None,
    user_id: int,
    user_image_url: str | None,
) -> tuple[list[dict], str, int]:
    """Load conversation history and build messages for the agent.

    正确处理 tool_calls / tool role 消息，确保发给 LLM 的历史消息符合 OpenAI 格式要求：
    - assistant 消息带 tool_calls 时必须有对应的 tool 消息回复每个 tool_call_id
    - 过滤掉不完整的 tool_calls 序列（防止 400 错误）
    """

    if conversation_id:
        logger.info("Loading conversation history: conv=%s, user=%s", conversation_id, user_id)
        conv = await get_conversation(conversation_id, user_id)
        if not conv:
            logger.warning(
                "Conversation not found or not owned: conv=%s, user=%s; using empty history",
                conversation_id,
                user_id,
            )
            db_messages = []
        else:
            db_messages = await get_messages(conversation_id, user_id)
            logger.info("Loaded %d history messages: conv=%s", len(db_messages), conversation_id)
    else:
        logger.info("No conversation_id provided; using empty history")
        db_messages = []

    full_user_message = user_message
    user_token_count = estimate_tokens(full_user_message)

    messages = []
    # 取最近 40 条（tool 调用会翻倍消息数）
    raw = list(db_messages[-40:])

    # 收集所有 tool_call_id，用于验证配对
    pending_tool_ids: set[str] = set()
    i = 0
    while i < len(raw):
        m = raw[i]
        if m.role == "assistant" and m.tool_calls:
            # assistant 带 tool_calls：记录待匹配的 id
            tc_ids = {tc["id"] for tc in (m.tool_calls or [])}
            # 检查后续是否有足够的 tool 消息匹配
            j = i + 1
            matched_ids: set[str] = set()
            while j < len(raw) and raw[j].role == "tool" and len(matched_ids) < len(tc_ids):
                if raw[j].tool_call_id in tc_ids:
                    matched_ids.add(raw[j].tool_call_id)
                j += 1

            if matched_ids == tc_ids:
                # 完整配对：全部输出
                tool_msg_list = []
                for k in range(i + 1, j):
                    tool_msg_list.append({
                        "role": "tool",
                        "tool_call_id": raw[k].tool_call_id,
                        "content": raw[k].content,
                    })

                messages.append({
                    "role": "assistant",
                    "content": m.content or None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": json.dumps(tc["args"])}}
                        for tc in (m.tool_calls or [])
                    ],
                })
                messages.extend(tool_msg_list)
                i = j
                continue
            else:
                # 不完整配对：跳过这条 assistant 及其后不完整的 tool 消息
                logger.warning(
                    "Skipping incomplete tool_calls sequence at message index %d: "
                    "expected ids=%s, matched=%s",
                    i, tc_ids, matched_ids,
                )
                # 跳到下一个非 tool 消息
                i += 1
                while i < len(raw) and raw[i].role == "tool":
                    i += 1
                continue

        elif m.role == "tool":
            # 孤立的 tool 消息（前面没有对应 assistant），跳过
            i += 1
            continue
        elif m.role in ("user", "assistant"):
            messages.append({"role": m.role, "content": m.content})
            i += 1
        else:
            i += 1

    if user_image_url:
        messages.append({"role": "user", "content": [
            {"type": "text", "text": full_user_message},
            {"type": "image_url", "image_url": {"url": user_image_url}},
        ]})
    else:
        messages.append({"role": "user", "content": full_user_message})

    return messages, full_user_message, user_token_count


# ── Main stream ──

async def stream_chat(
    user_message: str,
    conversation_id: int | None,
    user_id: int,
    user_image_url: str | None = None,
    user_file_url: str | None = None,
    thinking_mode: str = "balanced",
    context: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream a chat response via LangGraph ReAct Agent."""
    logger.info(
        "Chat request: conv=%s, len=%d, thinking_mode=%s, preview='%s'",
        conversation_id, len(user_message), thinking_mode, user_message[:200].replace("\n", " "),
    )

    # 1. Load MCP metadata
    from src.database.session import async_session
    from sqlalchemy import select
    from src.database.models import MCPServer

    mcp_servers = []
    user_llm_settings = None
    try:
        async with async_session() as db:
            user_llm_settings = await get_user_llm_settings(db, user_id)
            result = await db.execute(
                select(MCPServer).where(MCPServer.user_id == user_id, MCPServer.is_active)
            )
            for srv in result.scalars().all():
                mcp_servers.append({
                    "id": srv.id,
                    "name": srv.name,
                    "server_type": srv.server_type,
                    "command": srv.command,
                    "args": json.loads(srv.args) if isinstance(srv.args, str) else (srv.args or []),
                    "env_vars": json.loads(srv.env_vars) if isinstance(srv.env_vars, str) else (srv.env_vars or {}),
                    "url": srv.url,
                    "is_active": srv.is_active,
                    "tools": srv.tools or [],
                })
    except Exception as e:
        logger.warning("Failed to load MCP servers from DB: %s", e)

    mcp_capabilities = normalize_mcp_capabilities(mcp_servers)
    mcp_capabilities_text = format_mcp_capabilities(mcp_capabilities)
    logger.info(
        "Direct ReAct setup: mcp_servers=%d, mcp_capabilities=%d",
        len(mcp_servers),
        len(mcp_capabilities),
    )

    # 2. Build messages
    try:
        logger.info("Building chat messages: conv=%s, user=%s", conversation_id, user_id)
        api_messages, full_user_message, user_token_count = await _build_messages(
            user_message, conversation_id, user_id, user_image_url,
        )
        logger.info("Built %d API messages", len(api_messages))
    except Exception as e:
        logger.error("Failed to build chat messages: %s", e, exc_info=True)
        api_messages = [{"role": "user", "content": user_message}]
        full_user_message = user_message
        user_token_count = estimate_tokens(full_user_message)

    # 3. Build agent
    agent_tools = list(BLOG_TOOLS)
    agent_tools.append(base_search_file)
    if mcp_capabilities:
        agent_tools.append(build_mcp_call_tool(mcp_servers, mcp_capabilities))

    # Research context
    trust_writing = context.get("trust_writing_enabled", False) if context else False
    research_topic_id = context.get("research_topic_id") if context else None
    if trust_writing or research_topic_id:
        agent_tools.extend(RESEARCH_TOOLS)

    t0 = time.time()
    model_kwargs = _chat_model_kwargs(thinking_mode, user_llm_settings)
    logger.info(
        ">>> LLM calling: '%s' → model=%s, thinking_mode=%s, extra_body=%s, max_tokens=%s",
        user_message[:100].replace("\n", " "),
        model_kwargs.get("model"),
        thinking_mode,
        "extra_body" in model_kwargs,
        model_kwargs.get("max_tokens"),
    )

    # 6. Stream agent execution
    full_content = ""
    reasoning_debug_parts: list[str] = []
    tool_events_for_history: list[dict[str, Any]] = []
    loop_steps_for_history: list[str] = []
    _pending_blog_tool: dict[int, str] = {}
    _pending_blog_args: dict[int, str] = {}
    _pending_blog_content_yielded: dict[int, str] = {}
    _pending_patch_started: dict[int, bool] = {}
    _pending_patch_yielded: dict[int, str] = {}
    _last_tool_input: dict[str, Any] | None = None
    # 当前 LLM 轮次的文本（用于区分最终轮 vs 中间轮）
    _current_round_text: list[str] = []
    # 收集 agent 内部消息（用于保存完整 tool_calls 历史）
    _collected_agent_msgs: list[AIMessage | ToolMessage] = []
    _last_ai_tool_calls: list[dict] = []
    _tool_call_idx = 0
    try:
        token = current_user_id_cv.set(user_id)
        try:
            if not has_usable_api_key(model_kwargs):
                raise _MissingApiKeyError()
            # 页面上下文注入
            if context:
                parts: list[str] = []
                page_context_parts: list[str] = []
                page_type = context.get("page_type", "other")
                if page_type == "post":
                    page_info = CTX_POST.format(
                        title=context.get("post_title", ""), post_id=context.get("post_id")
                    )
                    parts.append(page_info)
                    page_context_parts.append(page_info)
                elif page_type == "files":
                    parts.append(CTX_FILES)
                    page_context_parts.append(CTX_FILES)
                elif page_type == "home":
                    parts.append(CTX_HOME)
                    page_context_parts.append(CTX_HOME)
                elif page_type == "about":
                    parts.append(CTX_ABOUT)
                    page_context_parts.append(CTX_ABOUT)
                elif page_type == "research":
                    topic_title = context.get("research_topic_title", "")
                    if topic_title:
                        research_info = CTX_RESEARCH_TOPIC.format(title=topic_title, topic_id=research_topic_id)
                    else:
                        research_info = CTX_RESEARCH
                    parts.append(research_info)
                    page_context_parts.append(research_info)

                # 可信写作模式上下文
                if trust_writing or research_topic_id:
                    parts.append(RESEARCH_TOOL_RULES)
                if trust_writing:
                    parts.append(CTX_TRUST_WRITING.format(protocol=TRUST_CHOICE_PROTOCOL))
                if research_topic_id:
                    parts.append(CTX_RESEARCH_TOPIC_ID.format(topic_id=research_topic_id))

                selected = context.get("selected_text")
                if selected:
                    if page_type != "post" and context.get("post_id"):
                        parts.append(
                            CTX_POST.format(
                                title=context.get("post_title", ""), post_id=context["post_id"]
                            )
                        )
                    parts.append(CTX_SELECTED_TEXT)
                    section_index = context.get("section_index") or 0
                    if section_index > 0:
                        parts.append(CTX_SELECTED_SECTION.format(section_index=section_index))
                    page_context_parts.append(CTX_SELECTED_TEXT_LABEL.format(selected=selected))

                # 将页面上下文追加到用户消息（最高优先级）
                if page_context_parts:
                    last_msg = api_messages[-1]
                    appended = "\n\n---\n" + "\n".join(page_context_parts)
                    if isinstance(last_msg["content"], str):
                        last_msg["content"] += appended
                    elif isinstance(last_msg["content"], list):
                        for part in last_msg["content"]:
                            if part.get("type") == "text":
                                part["text"] += appended
                                break

                if parts:
                    api_messages.insert(-1, {"role": "system", "content": "\n".join(parts)})

            llm = _create_llm(model_kwargs, thinking_mode)

            all_tool_names = [t.name for t in agent_tools]
            logger.info("Creating ReAct agent with tools: %s", all_tool_names)
            agent = create_react_agent(
                llm,
                agent_tools,
                prompt=_system_prompt(all_tool_names, thinking_mode, mcp_capabilities_text),
            )
            logger.info("ReAct agent created; streaming events")
            async for event in _astream_events_with_heartbeat(
                agent.astream_events(
                    {"messages": api_messages},
                    version="v2",
                    config={"recursion_limit": 50},
                ),
                idle_timeout=settings.agent_stream_idle_timeout,
            ):
                kind = event.get("event", "")

                if kind == "on_tool_start":
                    tool_name = event.get("name", "")
                    tool_input = event.get("data", {}).get("input", {})
                    logger.info("Tool start: %s args=%s", tool_name, str(tool_input)[:200])
                    _last_tool_input = tool_input if isinstance(tool_input, dict) else None
                    _pending_blog_tool.clear()
                    _pending_blog_args.clear()
                    _pending_blog_content_yielded.clear()
                    _pending_patch_started.clear()
                    _pending_patch_yielded.clear()
                    tool_events_for_history.append({"type": "start", "toolName": tool_name})
                    yield f"\n\n{_DONE_MARKER}TOOLDONE{_DONE_MARKER}\n"
                    yield json.dumps({"status": "start", "tool_name": tool_name, "result": "调用中..."})

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    output = event.get("data", {}).get("output", "")
                    result_text = str(output)
                    logger.info("Tool end: %s result=%s", tool_name, result_text[:200])
                    # 收集 ToolMessage（从最近的 AIMessage.tool_calls 中取 tool_call_id）
                    if _last_ai_tool_calls and _tool_call_idx < len(_last_ai_tool_calls):
                        tc_id = _last_ai_tool_calls[_tool_call_idx].get("id", "")
                        _collected_agent_msgs.append(ToolMessage(content=result_text, tool_call_id=tc_id))
                        _tool_call_idx += 1
                    payload: dict[str, object] = {"status": "end", "tool_name": tool_name, "result": result_text}
                    if tool_name.startswith("blog_"):
                        blog_meta = _extract_blog_meta(tool_name, result_text)
                        if blog_meta:
                            payload["blog_meta"] = blog_meta
                            if tool_name in {"blog_create_post", "blog_write_post"}:
                                research_link = await _auto_link_research_context_to_blog_post(
                                    blog_meta,
                                    research_topic_id,
                                    user_id,
                                    enabled=bool(trust_writing or research_topic_id),
                                )
                                if research_link:
                                    payload["research_link"] = research_link
                    refs = _extract_references(tool_name, result_text, _last_tool_input)
                    if refs:
                        payload["references"] = refs
                    history_event: dict[str, Any] = {"type": "end", "toolName": tool_name, "result": result_text}
                    if refs:
                        history_event["references"] = refs
                    tool_events_for_history.append(history_event)
                    yield f"\n\n{_DONE_MARKER}TOOLDONE{_DONE_MARKER}\n"
                    yield json.dumps(payload)

                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")

                    # 1) 文本 token — 累积当前轮次文本（中间轮不直接 yield，等 on_chat_model_end 判定）
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        delta = chunk.content
                        if isinstance(delta, str):
                            _current_round_text.append(delta)

                    # 1.5) 模型推理内容（多字段兼容）
                    if chunk and hasattr(chunk, "additional_kwargs"):
                        rc = getattr(chunk.additional_kwargs, "get", None)
                        reasoning = None
                        if callable(rc):
                            for field in ("reasoning_content", "reasoning", "thinking"):
                                reasoning = rc(field)
                                if reasoning:
                                    break
                        else:
                            for field in ("reasoning_content", "reasoning", "thinking"):
                                reasoning = (chunk.additional_kwargs or {}).get(field)
                                if reasoning:
                                    break
                        if reasoning:
                            reasoning_debug_parts.append(str(reasoning))
                            yield f"{_REASONING_MARKER}{{\"reasoning_delta\":{json.dumps(reasoning)}}}"

                    # 2) 工具参数 token → 博客内容流式输出
                    if chunk and hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                        for tc_chunk in chunk.tool_call_chunks:
                            idx = tc_chunk.get("index", 0) or 0

                            if tc_chunk.get("name"):
                                _pending_blog_tool[idx] = tc_chunk["name"]
                                _pending_blog_args[idx] = ""
                                _pending_blog_content_yielded[idx] = ""
                                _pending_patch_started[idx] = False
                                _pending_patch_yielded[idx] = ""

                            if tc_chunk.get("args"):
                                _pending_blog_args[idx] = (_pending_blog_args.get(idx, "") or "") + tc_chunk["args"]

                                tool_name = _pending_blog_tool.get(idx, "")

                                if tool_name == "blog_edit_post":
                                    if not _pending_patch_started.get(idx) and '"replacement_text"' in _pending_blog_args[idx]:
                                        target = _extract_partial_target(_pending_blog_args[idx])
                                        if target is not None:
                                            _pending_patch_started[idx] = True
                                            yield f"{_PATCHSTART_MARKER}{json.dumps({'target_text': target})}"

                                    if _pending_patch_started.get(idx):
                                        replacement_so_far = _extract_partial_replacement(_pending_blog_args[idx])
                                        if replacement_so_far is not None:
                                            prev = _pending_patch_yielded.get(idx, "")
                                            new_part = replacement_so_far[len(prev):]
                                            if new_part:
                                                _pending_patch_yielded[idx] = replacement_so_far
                                                yield f"{_PATCHDELTA_MARKER}{json.dumps({'replacement_delta': new_part})}"

                                elif tool_name in ("blog_create_post", "blog_write_post"):
                                    content_so_far = _extract_partial_content(_pending_blog_args[idx])
                                    if content_so_far is not None:
                                        prev = _pending_blog_content_yielded.get(idx, "")
                                        new_part = content_so_far[len(prev):]
                                        if new_part:
                                            _pending_blog_content_yielded[idx] = content_so_far
                                            yield f"{_BLOGDELTA_MARKER}{{\"content_delta\":{json.dumps(new_part)}}}"

                elif kind == "on_chat_model_end":
                    # 收集完整的 AIMessage（含 tool_calls）
                    ai_msg = event.get("data", {}).get("output")
                    if isinstance(ai_msg, AIMessage):
                        _collected_agent_msgs.append(ai_msg)
                        round_text = "".join(_current_round_text).strip()
                        if ai_msg.tool_calls:
                            # 中间轮：把文本作为 loop step 推送给前端思考面板
                            _last_ai_tool_calls = list(ai_msg.tool_calls)
                            _tool_call_idx = 0
                            if round_text:
                                loop_steps_for_history.append(round_text)
                                yield f"{_LOOPSTEP_MARKER}{json.dumps({'text': round_text})}"
                        else:
                            # 最终轮（无工具调用）：流式推送最终回答
                            full_content = round_text
                            yield round_text
                        # 重置当前轮次缓冲，准备下一轮
                        _current_round_text = []
        finally:
            current_user_id_cv.reset(token)

    except Exception as e:
        logger.error("Agent execution failed: %s", e, exc_info=True)
        # 异常时清空推理内容，避免错误消息带着推理链
        reasoning_debug_parts.clear()
        loop_steps_for_history.clear()
        # 对 tool_calls 格式错误给出友好提示
        err_msg = str(e)
        if isinstance(e, _MissingApiKeyError):
            full_content = _MISSING_API_KEY_MESSAGE
        elif isinstance(e, (asyncio.TimeoutError, TimeoutError)):
            full_content = (
                f"抱歉，模型响应超时（{settings.agent_stream_idle_timeout:.0f}s 内无新内容），"
                "请稍后重试或切换思考模式。"
            )
        elif "tool_calls" in err_msg and ("must be followed" in err_msg or "400" in err_msg):
            full_content = "抱歉，对话历史中存在不完整的工具调用记录，已自动清理。请重新发送您的消息。"
        else:
            full_content = f"抱歉，处理您的请求时出错：{e}"
        yield full_content

    # 兜底：若未捕获到最终轮（如异常中断），用所有累积文本
    if not full_content and _current_round_text:
        full_content = "".join(_current_round_text)

    if reasoning_debug_parts:
        reasoning_debug_text = "".join(reasoning_debug_parts)
        logger.debug(
            "reasoning_content total: len=%d, preview=%s",
            len(reasoning_debug_text),
            reasoning_debug_text[:500],
        )

    elapsed = time.time() - t0
    thinking_duration_ms = int(elapsed * 1000)
    reasoning_content = "".join(reasoning_debug_parts) or None
    logger.info("<<< LLM result: took %.1fs, %d chars, preview='%s'", elapsed, len(full_content), full_content[:200])

    # 6.5 保存完整的 agent 消息历史（含 tool_calls），供下次重建上下文
    # 注意：只存 AIMessage + ToolMessage（中间轮），不存 HumanMessage（user 消息由 add_message_pair 负责）
    if _collected_agent_msgs:
        try:
            await save_agent_messages(conversation_id, user_id, _collected_agent_msgs)
            logger.info("Saved %d agent messages (with tool_calls) for conv=%s", len(_collected_agent_msgs), conversation_id)
        except Exception as e:
            logger.warning("Failed to save agent messages with tool_calls: %s", e)

    # 7. Save to DB
    try:
        logger.info("Saving chat result: conv=%s, user=%s", conversation_id, user_id)
        assistant_token_count = estimate_tokens(full_content)
        new_conv_id, new_message = await add_message_pair(
            conversation_id,
            user_id,
            user_message,
            user_token_count,
            full_content,
            assistant_token_count,
            user_image_url,
            user_file_url,
            assistant_reasoning_content=reasoning_content,
            assistant_tool_events=tool_events_for_history or None,
            assistant_loop_steps=loop_steps_for_history or None,
            assistant_thinking_duration_ms=thinking_duration_ms,
            assistant_thinking_mode=thinking_mode,
        )
        message_id = new_message.id
        if not conversation_id:
            try:
                await update_conversation_title(new_conv_id, user_id, user_message[:50])
            except Exception:
                pass
        logger.info("Saved chat result: conv=%s, message=%s", new_conv_id, message_id)
    except Exception as e:
        logger.error("Failed to save chat result: %s", e, exc_info=True)
        new_conv_id = conversation_id
        message_id = 0

    yield f"\n\n{_DONE_MARKER}DONE{_DONE_MARKER}\n" + json.dumps({
        "type": "done",
        "conversation_id": new_conv_id,
        "message_id": message_id,
    })
