"""Chat service — LangGraph ReAct Agent + MCP tools + RAG."""

import json
import logging
import re
import time
from datetime import datetime
from typing import Any, AsyncGenerator

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

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
from src.tools.agent_tools import BLOG_TOOLS, search_knowledge_base, current_user_id_cv
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from src.tools.mcp_tools import build_mcp_call_tool, format_mcp_capabilities, normalize_mcp_capabilities
from src.tools.research_tools import RESEARCH_TOOLS

logger = logging.getLogger(__name__)
_DONE_MARKER = chr(0)
_BLOGDELTA_MARKER = f"{_DONE_MARKER}BLOGDELTA{_DONE_MARKER}"
_REASONING_MARKER = f"{_DONE_MARKER}REASONING{_DONE_MARKER}"
_PATCHSTART_MARKER = f"{_DONE_MARKER}PATCHSTART{_DONE_MARKER}"
_PATCHDELTA_MARKER = f"{_DONE_MARKER}PATCHDELTA{_DONE_MARKER}"

_TRUST_CHOICE_PROTOCOL = """
研究写作选择协议：
当需要给用户下一步建议时，可以在回复末尾输出一个结构化 JSON payload，格式为 TrustChoicePayload：
{
  "message": "给用户看的简短建议正文",
  "choices": [
    {"label": "去图谱审核", "kind": "action", "action": "open_research_graph"},
    {"label": "研究反方观点", "kind": "reply", "prompt": "请继续研究这个主题的反方观点，并优先寻找权威来源和原文证据。"}
  ]
}
choices 最多 1-4 个；同一个 choices 数组里允许 action 和 reply 混合。
action 只能使用以下白名单：start_research、continue_research、open_research_graph、open_conflicts、explain_conflicts、write_from_confirmed_facts。
reply 只表示用户确认后的下一句话，不代表你可以自动执行前端动作、删除、发布或跳转。
label 只用于按钮展示，不能作为动作判断依据。
不要求返回“不选择”，该选项由前端固定追加。
不要求返回“请选择下一步：”，该标题由前端固定渲染。
""".strip()


# ── Token estimation ──

def estimate_tokens(text: str | list) -> int:
    if isinstance(text, list):
        text = " ".join(p.get("text", "") for p in text if p.get("type") == "text")
    cjk = sum(1 for c in text if "一" <= c <= "鿿")
    return max(1, (cjk // 2) + ((len(text) - cjk) // 4))


# ── System prompt ──

def _system_prompt(
    tool_names: list[str],
    thinking_mode: str = "normal",
    rag_policy: str = "normal",
    mcp_capabilities_text: str = "",
) -> str:
    today = datetime.now().strftime("%Y年%m月%d日")
    base = (
        "你是一个智能、友好、专业的AI助手，你的名字叫光饼。用简洁清晰的语言回答问题，"
        "必要时使用Markdown格式组织内容。如果不确定，坦诚说明。\n"
        f"当前日期：{today}。撰写文章时请基于当前日期判断时间线，不要把过去的日期当作未来。"
    )
    if _is_deep_thinking(thinking_mode):
        base += (
            "\n\n当前处于深度分析模式。回答前要先充分理解用户目标、上下文和约束；"
            "复杂任务要分步骤分析，给出依据、取舍、风险和结论；"
            "如果使用工具或知识库，必须结合实际结果再回答。"
            "不要暴露隐藏推理链；需要说明推理时，只输出简洁的分析要点。"
        )
    if tool_names:
        names = "、".join(tool_names)
        base += (
            f"\n\n你拥有以下工具：{names}。"
            "严格遵循以下规则：\n"
            "1. 收到工具返回后，用自然语言将结果告诉用户。\n"
            "2. 只调用与用户问题匹配的工具，不要用不相关的工具。\n"
            "3. 博客操作：用户要求创建、编辑、删除、查看博客文章时，必须使用对应的博客工具；创建或更新文章时，title 参数用于标题，content 参数只写正文，不要以 '# 标题' 重复开头。如需章节标题，从 '##' 开始。\n"
            "4. 小范围修改（改某一段、润色、调整措辞）优先使用 blog_patch_post 精准替换；大幅重写全文才使用 blog_update_post。\n"
            '5. 当用户描述性要求修改某章节（如「改第三章」、「把开头改简洁点」）时，先用 blog_get_post 读取文章完整内容，找到对应段落后使用 blog_patch_post 精准替换。\n'
            "6. 对同一工具不要连续调用超过 3 次来验证或重试同一操作。如果结果不理想，向用户说明情况并建议下一步操作，而不是反复重试。"
        )
    if rag_policy == "normal":
        base += "\n\n当前未启用知识库工具；不要声称已经读取或检索了用户上传文档。"
    elif rag_policy == "knowledge":
        base += "\n\n当前是知识库模式。回答用户问题前必须先调用 search_knowledge_base；如果检索结果为空，要明确说明知识库未找到相关资料，不要编造。"
    elif rag_policy == "auto":
        base += "\n\n当前是自动知识库模式。当用户提到知识库、上传文件、文档、资料、根据文档等私有资料线索时，应调用 search_knowledge_base；普通闲聊不必调用。"
    if mcp_capabilities_text:
        base += (
            "\n\n当前用户已配置以下外部 MCP 能力：\n"
            f"{mcp_capabilities_text}\n"
            "如果用户问题需要这些能力、实时信息、网页或第三方系统数据，不要猜测，调用 mcp_call_tool。"
            "调用时 tool_ref 必须严格使用清单中的 server_name/tool_name，arguments 必须符合对应 schema。"
            "如果 mcp_call_tool 返回超时或失败，向用户说明当前 MCP 服务不可用，而不是编造结果。"
            "不要声称没有某项能力，除非当前清单中确实没有相关工具。"
        )
    return base


def _is_deep_thinking(thinking_mode: str) -> bool:
    return thinking_mode == "deep"


def _resolve_rag_policy(rag_mode: str | None, use_rag: bool) -> str:
    if rag_mode in ("normal", "knowledge", "auto"):
        return rag_mode
    return "knowledge" if use_rag else "normal"


def _extra_body_for_mode(thinking_mode: str) -> dict[str, Any] | None:
    raw = settings.deep_thinking_extra_body if _is_deep_thinking(thinking_mode) else settings.fast_answer_extra_body
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


def _chat_model_kwargs(thinking_mode: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "api_key": settings.openai_api_key,
        "base_url": settings.base_url,
        "model": settings.model_name,
        "temperature": settings.model_temperature,
    }
    if settings.model_max_output_tokens:
        kwargs["max_tokens"] = settings.model_max_output_tokens
    if _is_deep_thinking(thinking_mode):
        kwargs["model"] = settings.deep_thinking_model_name or settings.model_name
        kwargs["temperature"] = settings.deep_thinking_temperature
        kwargs["max_tokens"] = settings.deep_thinking_max_output_tokens
    extra_body = _extra_body_for_mode(thinking_mode)
    if extra_body:
        kwargs["extra_body"] = extra_body
    return kwargs


def _create_llm(model_kwargs: dict[str, Any], thinking_mode: str) -> ChatOpenAI:
    """根据模型名选择 ChatDeepSeek 或 ChatOpenAI。

    DeepSeek 模型无论深度/普通模式都使用 ChatDeepSeek，
    以正确捕获 reasoning_content 推理链。
    """
    model_name = model_kwargs.get("model", "")
    if _HAS_DEEPSEEK and "deepseek" in model_name.lower():
        ds_kwargs = {**model_kwargs}
        if "base_url" in ds_kwargs:
            ds_kwargs["api_base"] = ds_kwargs.pop("base_url")
        return ChatDeepSeek(**ds_kwargs)
    return ChatOpenAI(**model_kwargs)


# ── Reference extraction ──

def _extract_references(tool_name: str, result_text: str, tool_input: dict | None = None) -> list[dict[str, Any]]:
    """从工具返回结果中提取引用信息（RAG 来源 / MCP 服务）。"""
    refs: list[dict[str, Any]] = []
    if tool_name == "search_knowledge_base":
        for m in re.finditer(r"来源[：:]\s*(\S+)", result_text):
            source = m.group(1).rstrip("，。")
            collection_m = re.search(r"知识库[：:]\s*(\S+)", result_text[m.start():m.start() + 200])
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
    "blog_update_post": ("id", "slug", "title", "status"),
    "blog_patch_post": ("id", "slug",),
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
    """从 partial JSON args 中提取 target_text 字段的值（已生成部分）。"""
    match = re.search(r'"target_text"\s*:\s*"', args_json)
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


def _extract_partial_replacement(args_json: str) -> str | None:
    """从 partial JSON args 中提取 replacement_text 字段的值（已生成部分）。"""
    match = re.search(r'"replacement_text"\s*:\s*"', args_json)
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
    use_rag: bool = False,
    rag_mode: str | None = None,
    thinking_mode: str = "normal",
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
    try:
        async with async_session() as db:
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

    rag_policy = _resolve_rag_policy(rag_mode, use_rag)
    mcp_capabilities = normalize_mcp_capabilities(mcp_servers)
    mcp_capabilities_text = format_mcp_capabilities(mcp_capabilities)
    logger.info(
        "Direct ReAct setup: rag_policy=%s, mcp_servers=%d, mcp_capabilities=%d",
        rag_policy,
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
    if rag_policy in ("knowledge", "auto"):
        agent_tools.append(search_knowledge_base)
    if mcp_capabilities:
        agent_tools.append(build_mcp_call_tool(mcp_servers, mcp_capabilities))

    # Research context
    trust_writing = context.get("trust_writing_enabled", False) if context else False
    research_topic_id = context.get("research_topic_id") if context else None
    if trust_writing or research_topic_id:
        agent_tools.extend(RESEARCH_TOOLS)

    t0 = time.time()
    model_kwargs = _chat_model_kwargs(thinking_mode)
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
    _pending_blog_tool: dict[int, str] = {}
    _pending_blog_args: dict[int, str] = {}
    _pending_blog_content_yielded: dict[int, str] = {}
    _pending_patch_started: dict[int, bool] = {}
    _pending_patch_yielded: dict[int, str] = {}
    _last_tool_input: dict[str, Any] | None = None
    # 收集 agent 内部消息（用于保存完整 tool_calls 历史）
    _collected_agent_msgs: list[AIMessage | ToolMessage] = []
    _last_ai_tool_calls: list[dict] = []
    _tool_call_idx = 0
    try:
        token = current_user_id_cv.set(user_id)
        try:
            if rag_policy == "knowledge":
                knowledge_result = await search_knowledge_base.ainvoke({"query": user_message})
                api_messages.insert(-1, {
                    "role": "system",
                    "content": f"本轮知识库强制检索结果：\n{knowledge_result}",
                })

            # 页面上下文注入
            if context:
                parts: list[str] = []
                page_context_parts: list[str] = []
                page_type = context.get("page_type", "other")
                if page_type == "post":
                    post_id = context.get("post_id")
                    post_title = context.get("post_title", "")
                    page_info = f"用户当前正在查看文章「{post_title}」(ID={post_id})。"
                    parts.append(page_info)
                    page_context_parts.append(page_info)
                elif page_type == "kb":
                    kb_info = "用户当前在知识库页面。"
                    parts.append(kb_info)
                    page_context_parts.append(kb_info)
                elif page_type == "home":
                    home_info = "用户当前在博客主页。"
                    parts.append(home_info)
                    page_context_parts.append(home_info)
                elif page_type == "about":
                    about_info = "用户当前在关于页面。"
                    parts.append(about_info)
                    page_context_parts.append(about_info)
                elif page_type == "research":
                    topic_title = context.get("research_topic_title", "")
                    research_info = "用户当前在研究图谱页面。"
                    if topic_title:
                        research_info += f" 当前研究主题：「{topic_title}」(ID={research_topic_id})。"
                    parts.append(research_info)
                    page_context_parts.append(research_info)

                # 可信写作模式上下文
                if trust_writing:
                    trust_info = (
                        "当前处于可信写作模式。写作前必须先收集来源、抽取证据、建立事实声明（Claim），"
                        "再基于已确认或高可信事实生成文章。遵循以下硬性规则：\n"
                        "1. 搜索摘要只能作为线索（source_type=search_summary），不能保存为最终 Evidence。\n"
                        "2. AI 自己总结的内容不能作为 Evidence 支撑事实。\n"
                        "3. 没有有效 Evidence（kind=web|knowledge_base|mcp_tool|manual 且有 quote）的 Claim 不能进入 supported。\n"
                        "4. 低可信来源（trust_level=low）不能自动 adopted。\n"
                        "5. 冲突 Claim 不能写成确定事实，必须在文章中说明分歧。\n"
                        "6. Agent 写入的 Claim 默认 pending，需用户审核后才可 adopted。\n\n"
                        f"{_TRUST_CHOICE_PROTOCOL}"
                    )
                    parts.append(trust_info)
                if research_topic_id:
                    parts.append(
                        f"当前研究主题 ID={research_topic_id}。"
                        "请使用 research_get_topic 查看当前主题的已有来源、证据和事实。"
                        "如需添加新来源、证据或事实，请使用对应的 research_add_* 工具。"
                    )

                selected = context.get("selected_text")
                if selected:
                    if page_type != "post" and context.get("post_id"):
                        parts.append(f"用户当前正在查看文章「{context.get('post_title', '')}」(ID={context['post_id']})。")
                    parts.append(
                        "用户选中了文章中的一部分内容要求修改。请使用 blog_patch_post 精准替换，"
                        "将选中的原文作为 target_text，生成的新文本作为 replacement_text。不要重写全文。"
                    )
                    page_context_parts.append(f"选中的内容：\n「{selected}」")

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
                prompt=_system_prompt(all_tool_names, thinking_mode, rag_policy, mcp_capabilities_text),
            )
            logger.info("ReAct agent created; streaming events")
            async for event in agent.astream_events(
                {"messages": api_messages},
                version="v2",
                config={"recursion_limit": 50},
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
                            if tool_name in {"blog_create_post", "blog_update_post"}:
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
                    yield f"\n\n{_DONE_MARKER}TOOLDONE{_DONE_MARKER}\n"
                    yield json.dumps(payload)

                elif kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")

                    # 1) 原有逻辑：文本 token
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        delta = chunk.content
                        if isinstance(delta, str):
                            full_content += delta
                            yield delta

                    # 1.5) 模型推理内容（reasoning_content）
                    if chunk and hasattr(chunk, "additional_kwargs"):
                        rc = getattr(chunk.additional_kwargs, "get", None)
                        if callable(rc):
                            reasoning = rc("reasoning_content")
                        else:
                            reasoning = (chunk.additional_kwargs or {}).get("reasoning_content")
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

                                if tool_name == "blog_patch_post":
                                    # 1) PATCHSTART：当 replacement_text key 出现时，target_text 已完整
                                    if not _pending_patch_started.get(idx) and '"replacement_text"' in _pending_blog_args[idx]:
                                        target = _extract_partial_target(_pending_blog_args[idx])
                                        if target is not None:
                                            _pending_patch_started[idx] = True
                                            yield f"{_PATCHSTART_MARKER}{json.dumps({'target_text': target})}"

                                    # 2) PATCHDELTA：流式推送替换内容
                                    if _pending_patch_started.get(idx):
                                        replacement_so_far = _extract_partial_replacement(_pending_blog_args[idx])
                                        if replacement_so_far is not None:
                                            prev = _pending_patch_yielded.get(idx, "")
                                            new_part = replacement_so_far[len(prev):]
                                            if new_part:
                                                _pending_patch_yielded[idx] = replacement_so_far
                                                yield f"{_PATCHDELTA_MARKER}{{\"replacement_delta\":{json.dumps(new_part)}}}"

                                elif tool_name in ("blog_create_post", "blog_update_post"):
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
                        if ai_msg.tool_calls:
                            _last_ai_tool_calls = list(ai_msg.tool_calls)
                            _tool_call_idx = 0
        finally:
            current_user_id_cv.reset(token)

    except Exception as e:
        logger.error("Agent execution failed: %s", e, exc_info=True)
        # 对 tool_calls 格式错误给出友好提示
        err_msg = str(e)
        if "tool_calls" in err_msg and ("must be followed" in err_msg or "400" in err_msg):
            full_content = "抱歉，对话历史中存在不完整的工具调用记录，已自动清理。请重新发送您的消息。"
        else:
            full_content = f"抱歉，处理您的请求时出错：{e}"
        yield full_content

    if reasoning_debug_parts:
        reasoning_debug_text = "".join(reasoning_debug_parts)
        logger.debug(
            "reasoning_content total: len=%d, preview=%s",
            len(reasoning_debug_text),
            reasoning_debug_text[:500],
        )

    elapsed = time.time() - t0
    logger.info("<<< LLM result: took %.1fs, %d chars, preview='%s'", elapsed, len(full_content), full_content[:200])

    # 6.5 保存完整的 agent 消息历史（含 tool_calls），供下次重建上下文
    if _collected_agent_msgs:
        try:
            all_msgs: list[AIMessage | ToolMessage | HumanMessage] = [HumanMessage(content=user_message)]
            all_msgs.extend(_collected_agent_msgs)
            await save_agent_messages(conversation_id, user_id, all_msgs)
            logger.info("Saved %d agent messages (with tool_calls) for conv=%s", len(all_msgs), conversation_id)
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
