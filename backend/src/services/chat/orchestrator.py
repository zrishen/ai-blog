"""Chat 主编排：LangGraph ReAct Agent 流式执行 + 附件 claim 生命周期 + 视觉兜底。

stream_chat 是唯一对外入口（组装消息→建 agent→流式 SSE→落库）。被测试 monkeypatch 的依赖必须在此 import，使 `from src.services.chat import orchestrator as chat_service` 后 patch 生效。
"""

import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncGenerator

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt import create_react_agent

from src.config import settings
from src.database.session import async_session
from src.prompts import (
    COMPACT_SUMMARY_PROMPT,
    CTX_ABOUT,
    CTX_FILES,
    CTX_HOME,
    CTX_POST,
    CTX_SELECTED_SECTION,
    CTX_SELECTED_TEXT,
    CTX_SELECTED_TEXT_LABEL,
)
from src.services.chat.chat_attachment_service import (
    PreparedChatAttachment,
    claim_attachments,
    prepare_claimed_attachments,
    refresh_attachment_claim,
    release_attachment_claim,
)
from src.services.conversation.conversation_service import (
    save_chat_turn,
    update_conversation_title,
)
from src.services.llm.llm_settings_service import get_user_llm_settings, has_usable_api_key
from src.services.plugins.plugin_service import list_enabled_plugin_runtime_configs
from src.services.subscription import (
    compute_charge_tokens,
    consume_tokens,
    should_use_platform_key,
)
from src.tools.blog import BLOG_TOOLS, current_user_id_cv
from src.tools.file import base_search_file
from src.tools.mcp import build_mcp_call_tool, format_mcp_capabilities, normalize_mcp_capabilities

from src.services.llm.llm_factory import _chat_model_kwargs, _create_llm, _system_prompt
from .messages import (
    _build_current_user_content,  # noqa: F401  # 供 test 直接单测调用
    _build_messages,
    _has_image_blocks,
    _without_image_blocks,
)
from .references import _extract_blog_meta, _extract_references
from .streaming import (
    _BLOGDELTA_MARKER,
    _BLOGSTART_MARKER,
    _DONE_MARKER,
    _PATCHDELTA_MARKER,
    _PATCHSTART_MARKER,
    _REASONING_MARKER,
    _ROUNDDELTA_MARKER,
    _ROUNDEND_MARKER,
    _STREAMERROR_MARKER,
    _TOOLPREP_MARKER,
    _compact_json,
    _extract_partial_content,
    _extract_partial_int,
    _extract_partial_replacement,
    _extract_partial_target,
)
from .token_estimate import _extract_reasoning_content, _extract_text_content, estimate_tokens

logger = logging.getLogger(__name__)

_MISSING_API_KEY_MESSAGE = "请先在「设置」页填写你自己的 API 密钥，或订阅后使用。"


class _MissingApiKeyError(RuntimeError):
    """登录用户未填写自有 API 密钥时抛出，由 stream_chat 主流程捕获并返回提示。"""


def _memory_episode_text(user_message: str, assistant_message: str) -> str:
    return f"用户：{user_message}\n助手：{assistant_message}".strip()


async def _persist_chat_memory(
    *,
    user_id: int,
    conversation_id: int,
    message_id: int,
    user_message: str,
    assistant_message: str,
    llm: Any,
) -> None:
    """Best-effort 地将已保存对话转化为 Episode 与抽取到的知识。"""
    try:
        from src.services.memory import consolidator, extractor

        text = _memory_episode_text(user_message, assistant_message)
        extracted = await extractor.extract(text, llm)
        participant_names = [e["name"] for e in extracted.get("entities", []) if e.get("name")]
        extracted["episodes"] = [{
            "kind": "chat",
            "summary": text,
            "conversation_id": conversation_id,
            "message_id": message_id,
            "participants": participant_names,
        }]
        await consolidator.consolidate(user_id=user_id, extracted=extracted)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception(
            "Failed to persist chat memory conversation_id=%s message_id=%s",
            conversation_id,
            message_id,
        )


# ── Attachment claim lifecycle ──

async def _keep_attachment_claim_alive(
    claim_token: str,
    user_id: int,
) -> None:
    interval = max(60.0, settings.chat_attachment_claim_ttl_seconds / 3)
    try:
        while True:
            await asyncio.sleep(interval)
            async with async_session() as db:
                refreshed = await refresh_attachment_claim(
                    db,
                    claim_token=claim_token,
                    user_id=user_id,
                )
            if refreshed == 0:
                return
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Failed to refresh attachment claim heartbeat")


async def _stop_claim_heartbeat(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def _release_claim_best_effort(
    claim_token: str | None,
    user_id: int,
    *,
    reason: str,
) -> None:
    if not claim_token:
        return
    try:
        async with async_session() as db:
            await release_attachment_claim(
                db,
                claim_token=claim_token,
                user_id=user_id,
            )
    except Exception:
        logger.exception("Failed to release attachment claim: %s", reason)


# ── Vision fallback execution ──

def _is_vision_unsupported_error(error: Exception) -> bool:
    message = str(error).lower()
    image_terms = (
        "image_url",
        "unknown variant `image`",
        "expected `text`",
        "vision",
        "multimodal",
        "image input",
        "content block",
    )
    return any(term in message for term in image_terms)


def _append_vision_fallback_instruction(messages: list[dict]) -> list[dict]:
    fallback = _without_image_blocks(messages)
    instruction = (
        "\n\n[注：当前模型不支持图片输入。请忽略图片，仅根据用户文字和可读取文档回答，"
        "并明确告知用户你无法查看本次图片。说明时请表述为“模型不支持图片”，"
        "不要说成系统或平台不支持。]"
    )
    for message in reversed(fallback):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            message["content"] = content + instruction
        elif isinstance(content, list):
            content.append({"type": "text", "text": instruction})
        break
    return fallback


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


async def _astream_agent_with_vision_fallback(
    llm,
    tools,
    prompt: str,
    messages: list[dict],
    *,
    idle_timeout: float,
) -> AsyncGenerator[dict[str, Any], None]:
    active_messages = messages
    fallback_attempted = False
    while True:
        agent = create_react_agent(llm, tools, prompt=prompt)
        try:
            async for event in _astream_events_with_heartbeat(
                agent.astream_events(
                    {"messages": active_messages},
                    version="v2",
                    config={"recursion_limit": 50},
                ),
                idle_timeout=idle_timeout,
            ):
                yield event
            return
        except Exception as exc:
            if fallback_attempted or not _has_image_blocks(active_messages) or not _is_vision_unsupported_error(exc):
                raise
            fallback_attempted = True
            active_messages = _append_vision_fallback_instruction(active_messages)


# ── Main stream ──

async def stream_chat(
    user_message: str,
    conversation_id: int | None,
    user_id: int,
    attachment_ids: list[str] | None = None,
    thinking_mode: str = "balanced",
    context: dict | None = None,
) -> AsyncGenerator[str, None]:
    # 1. 加载用户启用的平台 MCP 插件
    from src.database.models import User

    mcp_plugins = []
    user_llm_settings = None
    use_platform_key = False
    try:
        async with async_session() as db:
            user_llm_settings = await get_user_llm_settings(db, user_id)
            user_obj = await db.get(User, user_id)
            use_platform_key = await should_use_platform_key(db, user_obj)
            mcp_plugins = await list_enabled_plugin_runtime_configs(db, user_id)
    except Exception as e:
        logger.warning("Failed to load enabled platform plugins from DB: %s", e)

    mcp_capabilities = normalize_mcp_capabilities(mcp_plugins)
    mcp_capabilities_text = format_mcp_capabilities(mcp_capabilities)
    chat_t0 = time.time()

    attachment_claim_token: str | None = None
    claim_heartbeat_task: asyncio.Task[None] | None = None
    claimed_attachments = []
    prepared_attachments: list[PreparedChatAttachment] = []
    requested_attachment_ids = attachment_ids or []
    provider = str(getattr(user_llm_settings, "protocol", "openai") or "openai").lower()

    # 上下文压缩摘要器：订阅用平台 key，否则 BYOK；统一用 fast 模式（不深思，省时省 token）
    async def compact_summarizer(old_summary, msgs):
        from langchain_core.messages import HumanMessage, SystemMessage

        mk = (
            _chat_model_kwargs("fast", None, allow_official_fallback=True)
            if use_platform_key
            else _chat_model_kwargs("fast", user_llm_settings)
        )
        llm = _create_llm(mk, "fast")
        parts: list[str] = []
        if old_summary:
            parts.append(f"[已有摘要]\n{old_summary}\n\n[新增对话]\n")
        for m in msgs:
            content = m.content
            if not isinstance(content, str):
                content = _extract_text_content(content)
            parts.append(f"{m.role}: {content}\n")
        resp = await llm.ainvoke([
            SystemMessage(content=COMPACT_SUMMARY_PROMPT),
            HumanMessage(content="".join(parts)),
        ])
        return resp.content, getattr(resp, "usage_metadata", None)

    # 2. Claim 附件并组装消息（附件失败不静默忽略）
    try:
        if requested_attachment_ids:
            attachment_claim_token = str(uuid.uuid4())
            async with async_session() as db:
                _, claimed_attachments = await claim_attachments(
                    db,
                    attachment_ids=requested_attachment_ids,
                    user_id=user_id,
                    claim_token=attachment_claim_token,
                )
                prepared_attachments = await prepare_claimed_attachments(claimed_attachments)
                await db.commit()
            claim_heartbeat_task = asyncio.create_task(
                _keep_attachment_claim_alive(attachment_claim_token, user_id)
            )
        api_messages, full_user_message, user_token_count, compact_usage = await _build_messages(
            user_message,
            conversation_id,
            user_id,
            prepared_attachments,
            provider,
            compact_summarizer=compact_summarizer,
        )
    except asyncio.CancelledError:
        await _stop_claim_heartbeat(claim_heartbeat_task)
        await _release_claim_best_effort(
            attachment_claim_token,
            user_id,
            reason="preparation cancelled",
        )
        raise
    except Exception as e:
        await _stop_claim_heartbeat(claim_heartbeat_task)
        await _release_claim_best_effort(
            attachment_claim_token,
            user_id,
            reason="preparation failed",
        )
        logger.error("Failed to prepare chat attachments: %s", e, exc_info=True)
        yield f"{_STREAMERROR_MARKER}{json.dumps({'round_id': 1, 'message': f'附件读取失败：{e}'})}"
        yield f"\n\n{_DONE_MARKER}DONE{_DONE_MARKER}\n" + json.dumps({
            "type": "done",
            "conversation_id": conversation_id,
            "message_id": 0,
            "user_message_id": 0,
            "attachments": [],
        })
        return

    # 单次 input 上限（仅平台 key：防超长上下文烧平台 key）
    if use_platform_key:
        input_tokens = sum(estimate_tokens(m.get("content", "")) for m in api_messages)
        if input_tokens > settings.subscription_per_request_token_limit:
            await _stop_claim_heartbeat(claim_heartbeat_task)
            await _release_claim_best_effort(
                attachment_claim_token, user_id, reason="per-request input limit"
            )
            attachment_claim_token = None
            yield f"{_STREAMERROR_MARKER}{json.dumps({'round_id': 1, 'message': f'本次对话过长（约 {input_tokens} token），超出单次上限 {settings.subscription_per_request_token_limit}，请减少历史或附件后重试。'})}"
            yield f"\n\n{_DONE_MARKER}DONE{_DONE_MARKER}\n" + json.dumps({
                "type": "done",
                "conversation_id": conversation_id,
                "message_id": 0,
                "user_message_id": 0,
                "attachments": [],
            })
            return

    # 3. Build agent
    agent_tools = list(BLOG_TOOLS)
    agent_tools.append(base_search_file)
    if settings.memory_enabled:
        # 大脑 recall 工具（GraphRAG）：回忆过往对话/偏好/实体关系，与 base_search_file 并列
        from src.tools.memory import base_recall_memory

        agent_tools.append(base_recall_memory)
    if mcp_capabilities:
        agent_tools.append(build_mcp_call_tool(mcp_plugins, mcp_capabilities))

    if use_platform_key:
        # 订阅有效：用平台 key（allow_official_fallback 走 .env）+ 开 stream_usage 拿真实 usage
        model_kwargs = _chat_model_kwargs(thinking_mode, None, allow_official_fallback=True)
        model_kwargs["stream_usage"] = True
    else:
        model_kwargs = _chat_model_kwargs(thinking_mode, user_llm_settings)
    logger.info(
        ">>> Chat start: preview='%s', conv=%s, user=%s, msg=%d, mode=%s, model=%s, max_tokens=%s, tools=%d, api_msgs=%d, mcp=%d",
        user_message[:100].replace("\n", " "),
        conversation_id, user_id, len(user_message), thinking_mode,
        model_kwargs.get("model"), model_kwargs.get("max_tokens"),
        len(agent_tools), len(api_messages), len(mcp_plugins),
    )

    # 6. Stream agent execution
    full_content = ""
    final_confirmed = False
    reasoning_debug_parts: list[str] = []
    _reasoning_logged_up_to = 0
    tool_events_for_history: list[dict[str, Any]] = []
    loop_steps_for_history: list[str] = []
    _pending_blog_tool: dict[int, str] = {}
    _pending_blog_args: dict[int, str] = {}
    _pending_blog_content_yielded: dict[int, str] = {}
    _pending_blog_started: dict[int, bool] = {}
    _pending_patch_started: dict[int, bool] = {}
    _pending_patch_target: dict[int, str] = {}
    _pending_patch_replacement_yielded: dict[int, str] = {}
    _last_tool_input: dict[str, Any] | None = None
    _current_round_text: list[str] = []
    _round_id = 1
    _loop_step_index = 0
    _collected_agent_msgs: list[AIMessage | ToolMessage] = []
    _collected_usage: dict | None = None
    _tool_calls_by_id: dict[str, dict[str, Any]] = {}
    _tool_call_ids_by_name: dict[str, list[str]] = {}
    _tool_call_input_by_id: dict[str, dict[str, Any]] = {}
    _event_run_to_call_id: dict[str, str] = {}
    agent_stream_completed = False
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

                # 博客左栏自定义编辑上下文：把当前 HTML + 卡片可用高度透传给 AI，
                # 让其基于现状修改、并按高度生成刚好填满的内容
                leftbar_html = context.get("current_leftbar_html")
                leftbar_height = context.get("current_leftbar_height_px")
                if leftbar_html is not None or leftbar_height:
                    leftbar_lines: list[str] = []
                    if leftbar_height:
                        leftbar_lines.append(
                            f"当前左栏卡片可用高度约 {leftbar_height}px（宽约 240–320px），"
                            "请生成刚好填满该高度的内容（避免溢出或大片留白）。"
                        )
                    if leftbar_html:
                        leftbar_lines.append(f"当前左栏 HTML（可基于其修改或重做）：\n{leftbar_html}")
                    leftbar_info = "\n".join(leftbar_lines)
                    parts.append(leftbar_info)
                    page_context_parts.append(leftbar_info)

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
                    # system 消息须连续置于最前（Anthropic 400 限制），统一插入列表头部
                    api_messages.insert(0, {"role": "system", "content": "\n".join(parts)})

            llm = _create_llm(model_kwargs, thinking_mode)

            all_tool_names = [t.name for t in agent_tools]
            async for event in _astream_agent_with_vision_fallback(
                llm,
                agent_tools,
                _system_prompt(all_tool_names, mcp_capabilities_text),
                api_messages,
                idle_timeout=settings.agent_stream_idle_timeout,
            ):
                kind = event.get("event", "")

                if kind == "on_tool_start":
                    tool_name = event.get("name", "")
                    event_data = event.get("data", {})
                    tool_input = event_data.get("input", {})
                    logger.info("Tool start: %s args=%s", tool_name, str(tool_input)[:200])
                    _last_tool_input = tool_input if isinstance(tool_input, dict) else None
                    event_run_id = str(event.get("run_id", ""))
                    metadata = event.get("metadata", {}) or {}
                    call_id = str(event_data.get("tool_call_id") or metadata.get("tool_call_id") or "")
                    if not call_id:
                        for candidate_id in _tool_call_ids_by_name.get(tool_name, []):
                            candidate = _tool_calls_by_id[candidate_id]
                            if candidate_id not in _tool_call_input_by_id and candidate.get("args") == tool_input:
                                call_id = candidate_id
                                break
                    if not call_id:
                        for candidate_id in _tool_call_ids_by_name.get(tool_name, []):
                            if candidate_id not in _tool_call_input_by_id:
                                call_id = candidate_id
                                break
                    if event_run_id and call_id:
                        _event_run_to_call_id[event_run_id] = call_id
                    if call_id and isinstance(tool_input, dict):
                        _tool_call_input_by_id[call_id] = tool_input
                    call_meta = _tool_calls_by_id.get(call_id, {})
                    tool_round_id = int(call_meta.get("round_id", max(1, _round_id - 1)))
                    loop_step_index = int(call_meta.get("loop_step_index", max(0, _loop_step_index - 1)))
                    _pending_blog_tool.clear()
                    _pending_blog_args.clear()
                    _pending_blog_content_yielded.clear()
                    _pending_blog_started.clear()
                    _pending_patch_started.clear()
                    _pending_patch_target.clear()
                    _pending_patch_replacement_yielded.clear()
                    history_start = {
                        "type": "start", "toolName": tool_name, "call_id": call_id,
                        "round_id": tool_round_id, "loop_step_index": loop_step_index,
                    }
                    tool_events_for_history.append(history_start)
                    yield f"\n\n{_DONE_MARKER}TOOLDONE{_DONE_MARKER}\n"
                    yield json.dumps({
                        "status": "start", "tool_name": tool_name, "result": "调用中...",
                        "call_id": call_id, "round_id": tool_round_id,
                        "loop_step_index": loop_step_index,
                        "stream_id": str(call_meta.get("stream_id", "")),
                    })

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    event_data = event.get("data", {})
                    output = event_data.get("output", "")
                    result_text = str(output)
                    logger.info("Tool end: %s result=%s", tool_name, result_text[:200])
                    event_run_id = str(event.get("run_id", ""))
                    metadata = event.get("metadata", {}) or {}
                    call_id = str(
                        event_data.get("tool_call_id")
                        or metadata.get("tool_call_id")
                        or _event_run_to_call_id.get(event_run_id, "")
                    )
                    if not call_id:
                        matching_ids = [
                            candidate_id for candidate_id in _tool_call_ids_by_name.get(tool_name, [])
                            if candidate_id in _tool_call_input_by_id
                        ]
                        if len(matching_ids) == 1:
                            call_id = matching_ids[0]
                    call_meta = _tool_calls_by_id.get(call_id, {})
                    tool_round_id = int(call_meta.get("round_id", max(1, _round_id - 1)))
                    loop_step_index = int(call_meta.get("loop_step_index", max(0, _loop_step_index - 1)))
                    if call_id:
                        _collected_agent_msgs.append(ToolMessage(content=result_text, tool_call_id=call_id))
                    payload: dict[str, object] = {
                        "status": "end", "tool_name": tool_name, "result": result_text,
                        "call_id": call_id, "round_id": tool_round_id,
                        "loop_step_index": loop_step_index,
                        "stream_id": str(call_meta.get("stream_id", "")),
                    }
                    if tool_name.startswith("blog_"):
                        blog_meta = _extract_blog_meta(tool_name, result_text)
                        if blog_meta:
                            payload["blog_meta"] = blog_meta
                    elif tool_name == "update_blog_sidebar":
                        # 把工具输入的 html 回传前端，左栏 iframe 即时渲染（无需改 SSE 协议）
                        sidebar_input = _tool_call_input_by_id.get(call_id, _last_tool_input)
                        sidebar_html = sidebar_input.get("html") if isinstance(sidebar_input, dict) else None
                        if sidebar_html:
                            payload["blog_meta"] = {"html": sidebar_html}
                    tool_input_for_call = _tool_call_input_by_id.get(call_id, _last_tool_input)
                    refs = _extract_references(tool_name, result_text, tool_input_for_call)
                    if refs:
                        payload["references"] = refs
                    history_event: dict[str, Any] = {
                        "type": "end", "toolName": tool_name, "result": result_text,
                        "call_id": call_id, "round_id": tool_round_id,
                        "loop_step_index": loop_step_index,
                    }
                    if refs:
                        history_event["references"] = refs
                    tool_events_for_history.append(history_event)
                    yield f"\n\n{_DONE_MARKER}TOOLDONE{_DONE_MARKER}\n"
                    yield json.dumps(payload)

                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")

                    if chunk and hasattr(chunk, "content"):
                        delta = _extract_text_content(chunk.content)
                        if delta:
                            _current_round_text.append(delta)
                            yield f"{_ROUNDDELTA_MARKER}{json.dumps({'round_id': _round_id, 'delta': delta})}"

                        # Anthropic 协议把思考放在 content 数组的 thinking/reasoning block 里
                        content_reasoning = _extract_reasoning_content(chunk.content)
                        if content_reasoning:
                            reasoning_debug_parts.append(content_reasoning)
                            yield f"{_REASONING_MARKER}{{\"reasoning_delta\":{json.dumps(content_reasoning)}}}"

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
                                _tool_name_chunk = tc_chunk["name"]
                                _is_new_tool = idx not in _pending_blog_tool
                                _pending_blog_tool[idx] = _tool_name_chunk
                                _pending_blog_args[idx] = ""
                                _pending_blog_content_yielded[idx] = ""
                                _pending_blog_started[idx] = False
                                _pending_patch_started[idx] = False
                                _pending_patch_target[idx] = ""
                                _pending_patch_replacement_yielded[idx] = ""
                                if _is_new_tool:
                                    yield _TOOLPREP_MARKER + _compact_json({
                                        "tool_name": _tool_name_chunk,
                                        "stream_id": f"{_round_id}:{idx}",
                                    })

                            if tc_chunk.get("args"):
                                _pending_blog_args[idx] = (_pending_blog_args.get(idx, "") or "") + tc_chunk["args"]

                                tool_name = _pending_blog_tool.get(idx, "")

                                stream_id = f"{_round_id}:{idx}"
                                args_so_far = _pending_blog_args[idx]
                                post_id = _extract_partial_int(args_so_far, "post_id")

                                if tool_name == "blog_write_post" and post_id is not None:
                                    if not _pending_blog_started.get(idx, False):
                                        _pending_blog_started[idx] = True
                                        yield _BLOGSTART_MARKER + _compact_json({
                                            "post_id": post_id,
                                            "stream_id": stream_id,
                                        })
                                    content_so_far = _extract_partial_content(args_so_far)
                                    if content_so_far is not None:
                                        prev = _pending_blog_content_yielded.get(idx, "")
                                        new_part = content_so_far[len(prev):]
                                        if new_part:
                                            _pending_blog_content_yielded[idx] = content_so_far
                                            yield _BLOGDELTA_MARKER + _compact_json({
                                                "post_id": post_id,
                                                "stream_id": stream_id,
                                                "content_delta": new_part,
                                            })

                                elif tool_name == "blog_edit_post" and post_id is not None:
                                    target_so_far = _extract_partial_target(args_so_far) or ""
                                    if (
                                        target_so_far
                                        and '"replacement_text"' in args_so_far
                                        and not _pending_patch_started.get(idx, False)
                                    ):
                                        _pending_patch_started[idx] = True
                                        _pending_patch_target[idx] = target_so_far
                                        _pending_patch_replacement_yielded[idx] = ""
                                        yield _PATCHSTART_MARKER + _compact_json({
                                            "post_id": post_id,
                                            "stream_id": stream_id,
                                            "target_text": target_so_far,
                                        })
                                    if _pending_patch_started.get(idx, False):
                                        replacement_so_far = _extract_partial_replacement(args_so_far)
                                        if replacement_so_far is not None:
                                            prev_repl = _pending_patch_replacement_yielded.get(idx, "")
                                            new_repl = replacement_so_far[len(prev_repl):]
                                            if new_repl:
                                                _pending_patch_replacement_yielded[idx] = replacement_so_far
                                                yield _PATCHDELTA_MARKER + _compact_json({
                                                    "post_id": post_id,
                                                    "stream_id": stream_id,
                                                    "replacement_delta": new_repl,
                                                })

                elif kind == "on_chat_model_end":
                    ai_msg = event.get("data", {}).get("output")
                    if isinstance(ai_msg, AIMessage):
                        usage = getattr(ai_msg, "usage_metadata", None)
                        if usage:
                            _collected_usage = usage
                        round_text = _extract_text_content(ai_msg.content)
                        # 工具调用前记录本轮 reasoning（与前端 timeline 一致：reasoning → 工具）
                        if len(reasoning_debug_parts) > _reasoning_logged_up_to:
                            round_reasoning = "".join(reasoning_debug_parts[_reasoning_logged_up_to:])
                            _reasoning_logged_up_to = len(reasoning_debug_parts)
                            logger.info(
                                "[THINKING] round %d reasoning: len=%d preview=%s",
                                _round_id, len(round_reasoning), round_reasoning[:200],
                            )
                        classification = "loop" if ai_msg.tool_calls else "final"
                        round_payload = {
                            "round_id": _round_id,
                            "classification": classification,
                            "text": round_text,
                            "loop_step_index": _loop_step_index if classification == "loop" else None,
                        }
                        yield f"{_ROUNDEND_MARKER}{json.dumps(round_payload)}"
                        if ai_msg.tool_calls:
                            _collected_agent_msgs.append(ai_msg)
                            for _tc_idx, tool_call in enumerate(ai_msg.tool_calls):
                                call_id = str(tool_call.get("id", ""))
                                if not call_id:
                                    continue
                                call_meta = {
                                    **tool_call,
                                    "round_id": _round_id,
                                    "loop_step_index": _loop_step_index,
                                    "stream_id": f"{_round_id}:{_tc_idx}",
                                }
                                _tool_calls_by_id[call_id] = call_meta
                                _tool_call_ids_by_name.setdefault(str(tool_call.get("name", "")), []).append(call_id)
                            loop_steps_for_history.append(round_text)
                            _loop_step_index += 1
                        else:
                            full_content = round_text
                            final_confirmed = True
                        _current_round_text = []
                        _round_id += 1
            agent_stream_completed = True
        finally:
            current_user_id_cv.reset(token)

    except asyncio.CancelledError:
        await _stop_claim_heartbeat(claim_heartbeat_task)
        await _release_claim_best_effort(
            attachment_claim_token,
            user_id,
            reason="stream cancelled",
        )
        attachment_claim_token = None
        raise
    except Exception as e:
        logger.error("Agent execution failed: %s", e, exc_info=True)
        if _current_round_text:
            discard_payload = {
                "round_id": _round_id,
                "classification": "discard",
                "text": "",
                "loop_step_index": None,
            }
            yield f"{_ROUNDEND_MARKER}{json.dumps(discard_payload)}"
            _current_round_text = []
        err_msg = str(e)
        if isinstance(e, _MissingApiKeyError):
            error_message = _MISSING_API_KEY_MESSAGE
        elif isinstance(e, (asyncio.TimeoutError, TimeoutError)):
            error_message = (
                f"抱歉，模型响应超时（{settings.agent_stream_idle_timeout:.0f}s 内无新内容），"
                "请稍后重试或切换思考模式。"
            )
        elif "tool_calls" in err_msg and ("must be followed" in err_msg or "400" in err_msg):
            error_message = "抱歉，对话历史中存在不完整的工具调用记录，已自动清理。请重新发送您的消息。"
        elif prepared_attachments and any(item.kind == "image" for item in prepared_attachments) and (
            "image" in err_msg.lower()
            or "vision" in err_msg.lower()
            or "multimodal" in err_msg.lower()
            or "content block" in err_msg.lower()
        ):
            error_message = "当前模型不支持图片输入，请切换视觉模型或移除图片后重试（MODEL_VISION_UNSUPPORTED）。"
        else:
            error_message = f"抱歉，处理您的请求时出错：{e}"
        yield f"{_STREAMERROR_MARKER}{json.dumps({'round_id': _round_id, 'message': error_message})}"

    if agent_stream_completed and not final_confirmed:
        error_message = "模型未返回最终回复，请稍后重试。"
        yield f"{_STREAMERROR_MARKER}{json.dumps({'round_id': _round_id, 'message': error_message})}"

    if reasoning_debug_parts:
        logger.info(
            "[THINKING] reasoning_content captured: len=%d",
            sum(len(part) for part in reasoning_debug_parts),
        )

    elapsed = time.time() - chat_t0
    thinking_duration_ms = int(elapsed * 1000)
    reasoning_content = "".join(reasoning_debug_parts) or None

    new_conv_id = conversation_id
    message_id = 0
    user_message_id = 0
    response_attachments: list[dict[str, Any]] = []
    if final_confirmed:
        # 事后扣配额（仅平台 key：真实 usage 优先，estimate 兜底）
        if use_platform_key:
            charge = compute_charge_tokens(
                usage_metadata=_collected_usage,
                fallback_input=sum(estimate_tokens(m.get("content", "")) for m in api_messages),
                fallback_output=estimate_tokens(full_content),
                fallback_reasoning=estimate_tokens(reasoning_content or ""),
            )
            if charge > 0:
                try:
                    async with async_session() as db:
                        await consume_tokens(db, user_id, charge)
                except Exception:
                    logger.exception("Failed to charge subscription tokens")
            # 上下文摘要的真实 usage 单独计入周配额（对话 charge 之外，仅 use_platform_key）
            if compact_usage:
                compact_charge = compute_charge_tokens(usage_metadata=compact_usage)
                if compact_charge > 0:
                    try:
                        async with async_session() as db:
                            await consume_tokens(db, user_id, compact_charge)
                    except Exception:
                        logger.exception("Failed to charge compact summary tokens")
        try:
            assistant_token_count = estimate_tokens(full_content)
            new_conv_id, saved_user_message, new_message = await save_chat_turn(
                conversation_id,
                user_id,
                user_message,
                user_token_count,
                _collected_agent_msgs,
                full_content,
                assistant_token_count,
                attachment_claim_token=attachment_claim_token,
                attachment_ids=requested_attachment_ids,
                final_reasoning_content=reasoning_content,
                final_tool_events=tool_events_for_history or None,
                final_loop_steps=loop_steps_for_history or None,
                final_thinking_duration_ms=thinking_duration_ms,
                final_thinking_mode=thinking_mode,
            )
            message_id = new_message.id
            user_message_id = saved_user_message.id
            response_attachments = [
                {
                    "id": item.attachment.attachment_id,
                    "kind": item.kind,
                    "original_name": item.attachment.original_name,
                    "mime_type": item.attachment.media_type,
                    "size_bytes": item.attachment.size_bytes,
                    "status": "attached",
                    "position": item.position,
                    "download_url": (
                        f"/api/v1/chat/attachments/{item.attachment.attachment_id}/content"
                    ),
                    "extraction_truncated": item.extraction_truncated,
                }
                for item in prepared_attachments
            ]
            attachment_claim_token = None
            if not conversation_id:
                try:
                    await update_conversation_title(new_conv_id, user_id, user_message[:50])
                except Exception:
                    pass
            if settings.memory_enabled and full_content:
                asyncio.create_task(
                    _persist_chat_memory(
                        user_id=user_id,
                        conversation_id=new_conv_id,
                        message_id=message_id,
                        user_message=user_message,
                        assistant_message=full_content,
                        llm=llm,
                    ),
                    name=f"persist-chat-memory:{user_id}:{message_id}",
                )
        except asyncio.CancelledError:
            await _stop_claim_heartbeat(claim_heartbeat_task)
            await _release_claim_best_effort(
                attachment_claim_token,
                user_id,
                reason="save cancelled",
            )
            attachment_claim_token = None
            raise
        except Exception as e:
            logger.error("Failed to save confirmed chat turn: %s", e, exc_info=True)
            new_conv_id = conversation_id
            message_id = 0
            user_message_id = 0

    await _stop_claim_heartbeat(claim_heartbeat_task)
    await _release_claim_best_effort(
        attachment_claim_token,
        user_id,
        reason="stream ended without binding",
    )

    yield f"\n\n{_DONE_MARKER}DONE{_DONE_MARKER}\n" + json.dumps({
        "type": "done",
        "conversation_id": new_conv_id,
        "message_id": message_id,
        "user_message_id": user_message_id,
        "attachments": response_attachments,
    })
    logger.info(
        "<<< Chat end: preview='%s', conv=%s, msg=%s, took=%.1fs, chars=%d",
        full_content[:200].replace("\n", " "),
        new_conv_id, message_id, time.time() - chat_t0,
        len(full_content),
    )
