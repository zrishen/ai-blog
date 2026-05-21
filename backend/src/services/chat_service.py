import asyncio
import json
import logging
from typing import AsyncGenerator

from openai import AsyncOpenAI

from src.core.config import settings
from src.database.engine import get_conversation, get_messages
from src.services.file_service import parse_file
from src.services.conversation_service import (
    add_message_pair,
    update_conversation_title,
)
from src.services.mcp_config import BUILTIN_TOOLS
from src.services.tool_client import call_tool

logger = logging.getLogger(__name__)


def estimate_tokens(text: str | list) -> int:
    """Rough token estimation: ~4 chars per token for English, ~2 for CJK."""
    if isinstance(text, list):
        # Multimodal content: only count text parts
        text = " ".join(part.get("text", "") for part in text if part.get("type") == "text")
    cjk_count = sum(1 for c in text if "一" <= c <= "鿿")
    ascii_count = len(text) - cjk_count
    return max(1, (cjk_count // 2) + (ascii_count // 4))


def _build_system_prompt(tools_available: bool = False) -> str:
    base = (
        "你是一个智能、友好、专业的AI助手。用简洁清晰的语言回答问题，"
        "必要时使用Markdown格式组织内容。如果不确定，坦诚说明。"
    )
    if tools_available:
        base += (
            "\n\n你具备实时工具能力（获取时间、天气、搜索）。"
            "用户询问时间、天气、新闻等实时信息时，请直接调用工具获取，"
            "不要说'我无法获取实时信息'或'根据检索内容'。"
        )
    return base


async def _compress_messages(
    messages: list[dict],
) -> list[dict]:
    """Compress conversation history when it exceeds the token threshold.

    Strategy: keep the system prompt and the most recent N messages,
    summarize the older portion into a concise recap.
    """
    threshold = settings.memory_compact_threshold
    total_tokens = sum(m.get("token_count", estimate_tokens(m["content"])) for m in messages)

    if total_tokens <= threshold:
        return messages

    # Keep system + last 6 messages, summarize the rest
    keep_count = 6
    to_summarize = messages[:-keep_count] if len(messages) > keep_count else []
    keep_messages = messages[-keep_count:] if len(messages) > keep_count else messages

    if not to_summarize:
        return keep_messages

    # Build a summary of the older messages
    summary_parts: list[str] = []
    for msg in to_summarize:
        if msg["role"] == "user":
            summary_parts.append(f"用户问：{msg['content'][:100]}")
        elif msg["role"] == "assistant":
            summary_parts.append(f"AI答：{msg['content'][:150]}")

    summary = "对话摘要：" + "；".join(summary_parts[:10])

    return [
        {"role": "system", "content": _build_system_prompt()},
        {"role": "user", "content": f"[历史对话摘要]\n{summary}\n\n请继续上面的对话。"},
        *keep_messages,
    ]


def _build_user_content(
    text: str,
    image_url: str | None,
) -> str | list[dict]:
    """Build user content for the API. Returns list for multimodal, str for text-only."""
    if image_url:
        return [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
    return text


async def _extract_file_text(file_url: str) -> str:
    """Extract text from an uploaded file given its URL path."""
    from pathlib import Path

    # Extract filename from URL (e.g. /api/uploads/stored_name.ext)
    filename = Path(file_url).name
    return await parse_file(filename)


UPLOADED_FILES_COLLECTION = "uploaded_files"
KNOWLEDGE_BASE_COLLECTION = "knowledge_base"


async def _retrieve_context(query: str, top_k: int | None = None) -> str:
    """Retrieve relevant document chunks from vector store.

    Searches all collections in the vector store that have documents.
    Returns formatted context string for injection into prompt.
    """
    from src.services.embedding_service import get_embeddings
    from src.services.vector_store import get_collection_count, search, list_collections

    if top_k is None:
        top_k = settings.rag_top_k

    # Debug: log the retrieval process (only visible at DEBUG level)
    logger.debug("RAG query: '%s'", query[:80])

    # Get all collections with documents
    try:
        all_names = await list_collections()
        logger.debug("All collections: %s", all_names)
    except Exception as e:
        logger.debug("list_collections failed: %s", e)
        return ""

    # Filter to collections that have documents
    active_collections = []
    for name in all_names:
        count = await get_collection_count(name)
        logger.debug("Collection '%s': %d docs", name, count)
        if count > 0:
            active_collections.append(name)

    if not active_collections:
        logger.debug("No active collections found")
        return ""

    # Generate query embedding
    try:
        embeddings = await get_embeddings([query])
        query_embedding = embeddings[0]
        logger.debug("Embedding: dim=%d, all_float=%s", len(query_embedding), all(isinstance(x, float) for x in query_embedding))
    except Exception as e:
        logger.debug("get_embeddings failed: %s", e)
        return ""

    # Search all active collections
    all_results: list[tuple[str, str, float | None]] = []  # (source, content, distance)

    for collection_name in active_collections:
        # Derive source label from collection name
        if collection_name == UPLOADED_FILES_COLLECTION:
            source_label = "uploaded_file"
        elif collection_name == KNOWLEDGE_BASE_COLLECTION:
            source_label = "knowledge_base"
        else:
            source_label = f"kb:{collection_name}"

        try:
            results = await search(collection_name, query, query_embedding, top_k)
            logger.debug("Search '%s': %d results", collection_name, len(results))
            for r in results:
                meta = r.metadata or {}
                all_results.append((
                    f"[{source_label}:{meta.get('source', 'unknown')}]",
                    r.content,
                    r.distance,
                ))
                logger.debug("  Result: dist=%s, content='%s'", r.distance, r.content[:100])
        except Exception as e:
            logger.debug("Search '%s' failed: %s", collection_name, e)
            continue

    if not all_results:
        logger.debug("No search results found")
        return ""

    logger.debug("Total results: %d", len(all_results))

    # Limit total results and format context
    all_results.sort(key=lambda x: x[2] if x[2] is not None else float("inf"))
    limited = all_results[:top_k * 2]

    context_parts = []
    for source, content, _ in limited:
        context_parts.append(f"{source}\n{content}")

    result = "[检索到的参考内容]\n" + "\n---\n".join(context_parts) + "\n---\n"
    logger.debug("Context length: %d chars", len(result))
    return result


_TIMEOUT = 120  # seconds


class OperationTimeoutError(Exception):
    pass


async def _timeout_guard(coro, name: str, timeout: float = _TIMEOUT):
    """Run a coroutine with a timeout. Raises OperationTimeoutError on timeout."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        raise OperationTimeoutError(f"{name} timed out after {timeout}s")


async def stream_chat(
    user_message: str,
    conversation_id: int | None,
    user_image_url: str | None = None,
    user_file_url: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream a chat response. Yields text chunks."""
    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)

    # Get or create conversation
    if conversation_id:
        conv = await _timeout_guard(get_conversation(conversation_id), "conversation lookup")
        if not conv:
            raise ValueError("Conversation not found")
        messages = await _timeout_guard(get_messages(conversation_id), "message fetch")
    else:
        messages = []

    # Extract file content if a file is attached
    file_text = ""
    if user_file_url:
        try:
            file_text = await _timeout_guard(_extract_file_text(user_file_url), "file extraction")
        except OperationTimeoutError:
            file_text = ""

    # ===== 工具调用流程 =====
    # 1. 获取活跃 MCP 服务及其工具（提前到 RAG 之前，用于 RAG 决策）
    _server_modules: dict[str, str] = {}  # tool_name -> server_module
    try:
        from src.database.engine import async_session

        async with async_session() as db:
            from sqlalchemy import select
            from src.models.mcp_server import MCPServer as Model

            result = await db.execute(select(Model).where(Model.is_active))
            rows = result.scalars().all()
            logger.info("MCP tool flow: found %d active servers", len(rows))
            for srv in rows:
                if srv.server_type == "builtin" and srv.tools:
                    for tname in srv.tools:
                        mod = BUILTIN_TOOLS.get(tname, "src.services.mcp_server_tools")
                        _server_modules[tname] = mod
                elif srv.server_type in ("stdio", "sse") and srv.tools:
                    # TODO: 动态 list_tools for stdio/sse 自定义服务
                    pass
    except Exception as e:
        logger.warning("Failed to load MCP tools: %s", e)

    # 使用内置工具 (通过 OpenAI function calling 格式)
    openai_tools: list[dict] = []
    for tname, mod in _server_modules.items():
        openai_tools.append({
            "type": "function",
            "function": {
                "name": tname,
                "description": "",
                "parameters": {"type": "object", "properties": {}},
            },
        })

    # Retrieve RAG context from vector store（有工具时跳过，避免干扰）
    rag_context = ""
    if not openai_tools:
        try:
            rag_context = await _timeout_guard(_retrieve_context(user_message), "RAG retrieval")
        except OperationTimeoutError:
            rag_context = ""
    else:
        logger.debug("Skipping RAG: tool calling flow active")

    # Build user message content with file and RAG context
    full_user_message = user_message
    parts = []
    if rag_context:
        parts.append(rag_context)
    if file_text:
        parts.append(f"[文件内容]\n{file_text}")
    if parts:
        full_user_message = "\n\n".join(parts) + f"\n\n[用户问题]\n{user_message}"

    # Add user message
    user_token_count = estimate_tokens(full_user_message)
    history = [
        {"role": m.role, "content": m.content, "token_count": m.token_count, "image_url": m.image_url}
        for m in messages
    ]
    user_content = _build_user_content(full_user_message, user_image_url)
    history.append({
        "role": "user",
        "content": user_content,
        "token_count": user_token_count,
    })

    # Compress if needed
    history = await _compress_messages(history)

    # Build API messages, preserving multimodal content
    api_messages: list[dict[str, object]] = []
    for m in history:
        msg: dict[str, object] = {"role": m["role"]}
        content = m["content"]
        if isinstance(content, list):
            msg["content"] = content
        else:
            msg["content"] = content
        api_messages.append(msg)

    if openai_tools:
        logger.info("Tool calling flow: %d tools available: %s", len(openai_tools), list(_server_modules.keys()))

    full_content = ""
    need_tool_retry = False
    # 动态系统提示词：有工具时增强指引
    if openai_tools:
        api_messages[0]["content"] = _build_system_prompt(tools_available=True)
    tool_history = list(api_messages)  # 复制一份用于工具流程

    for attempt in range(2):  # 最多两次：第一次检测 tool_calls，第二次生成回复
        if need_tool_retry:
            openai_tools = []  # 工具结果已追加，不再传 tools

        # 2. 调用 LLM
        try:
            stream = await _timeout_guard(
                client.chat.completions.create(
                    model=settings.model_name,
                    messages=tool_history,
                    stream=True,
                    tools=openai_tools if openai_tools else None,
                ),
                "API call (tool flow)",
                timeout=60,
            )
        except OperationTimeoutError:
            yield "抱歉，AI 服务响应超时，请稍后重试。"
            assistant_token_count = estimate_tokens("抱歉，AI 服务响应超时，请稍后重试。")
            new_conv_id, new_message = await add_message_pair(
                conversation_id,
                full_user_message,
                user_token_count,
                "抱歉，AI 服务响应超时，请稍后重试。",
                assistant_token_count,
                user_image_url,
                user_file_url,
            )
            if not conversation_id:
                await update_conversation_title(new_conv_id, user_message[:50])
            _nb = chr(0)
            yield f"\n\n{_nb}DONE{_nb}\n"
            yield json.dumps({
                "type": "done",
                "conversation_id": new_conv_id,
                "message_id": new_message.id,
            })
            return
        except Exception as e:
            # 优雅降级：不支持 tool_use
            if attempt == 0 and openai_tools:
                logger.warning("LLM tool_use not supported (%s), falling back to text mode", e)
                openai_tools = []
                need_tool_retry = False
                tool_history = list(api_messages)
                continue
            yield "抱歉，AI 服务暂时不可用，请稍后重试。"
            assistant_token_count = estimate_tokens("抱歉，AI 服务暂时不可用，请稍后重试。")
            new_conv_id, new_message = await add_message_pair(
                conversation_id,
                full_user_message,
                user_token_count,
                "抱歉，AI 服务暂时不可用，请稍后重试。",
                assistant_token_count,
                user_image_url,
                user_file_url,
            )
            if not conversation_id:
                await update_conversation_title(new_conv_id, user_message[:50])
            _nb = chr(0)
            yield f"\n\n{_nb}DONE{_nb}\n"
            yield json.dumps({
                "type": "done",
                "conversation_id": new_conv_id,
                "message_id": new_message.id,
            })
            return

        tool_calls: list[dict] = []
        try:
            async for chunk in stream:
                if chunk.choices:
                    choice = chunk.choices[0]
                    if choice.delta.tool_calls:
                        for tc in choice.delta.tool_calls:
                            # 跳过 LLM 返回的无效 tool_call（name 为 None）
                            if not tc.function or not tc.function.name:
                                logger.warning("Skipping invalid tool_call: name=%r id=%r", tc.function.name if tc.function else None, tc.id)
                                continue
                            tool_calls.append({
                                "id": tc.id,
                                "name": tc.function.name,
                                "arguments": tc.function.arguments or "{}",
                            })
                    elif choice.delta.content:
                        delta = choice.delta.content
                        full_content += delta
                        yield delta
        except asyncio.CancelledError:
            pass

        # 3. 如果有 tool_calls，执行工具
        if tool_calls:
            logger.info("LLM requested %d tool call(s): %s", len(tool_calls), [tc["name"] for tc in tool_calls])

            # 将 assistant 消息（含 tool_calls）追加到 history
            tool_history.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"],
                        },
                    }
                    for tc in tool_calls
                ],
            })

            # 执行每个工具调用
            for tc in tool_calls:
                tool_name = tc["name"]
                if not tool_name:
                    logger.warning("Skipping tool_call with empty name: %s", tc)
                    continue
                try:
                    tool_args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    tool_args = {}

                server_module = _server_modules.get(tool_name, "src.services.mcp_server_tools")
                try:
                    result = await call_tool(tool_name, tool_args, server_module, timeout=30.0)
                    logger.info("Tool '%s' succeeded: %d chars", tool_name, len(result))
                except asyncio.TimeoutError:
                    result = f"工具调用超时: {tool_name}"
                    logger.error("Tool '%s' timed out", tool_name)
                except Exception as e:
                    result = f"工具调用失败: {tool_name}: {e}"
                    logger.error("Tool '%s' failed: %s", tool_name, e, exc_info=True)

                # 通过 SSE 发送工具完成事件
                _nb = chr(0)
                yield f"\n\n{_nb}TOOLDONE{_nb}\n"
                yield json.dumps({
                    "tool_name": tool_name,
                    "result": result,
                })

                # 将工具结果追加到 history
                tool_history.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            need_tool_retry = True
            continue  # 二次调用 LLM

        break  # 没有 tool_calls，正常结束

    # 工具流程已完成（need_tool_retry=True），full_content 已通过 tool_history 的二次 LLM 调用 yield
    if need_tool_retry:
        logger.info("Tool flow complete, saved content: %d chars, preview='%s'", len(full_content), full_content[:200])
    else:
        # 无工具流程（或 LLM 不支持 tool_use 已降级）：走原有 LLM 调用保存逻辑
        if openai_tools:
            logger.info("Combined RAG + tool_use: rag=%s, tools=%d", "yes" if rag_context else "no", len(openai_tools))

        try:
            stream = await _timeout_guard(
                client.chat.completions.create(
                    model=settings.model_name,
                    messages=api_messages,
                    stream=True,
                ),
                "API call",
                timeout=60,
            )
        except OperationTimeoutError:
            yield "抱歉，AI 服务响应超时，请稍后重试。"
            # Still save to DB
            assistant_token_count = estimate_tokens("抱歉，AI 服务响应超时，请稍后重试。")
            new_conv_id, new_message = await add_message_pair(
                conversation_id,
                full_user_message,
                user_token_count,
                "抱歉，AI 服务响应超时，请稍后重试。",
                assistant_token_count,
                user_image_url,
                user_file_url,
            )
            if not conversation_id:
                await update_conversation_title(new_conv_id, user_message[:50])
            _nb = chr(0)
            yield f"\n\n{_nb}DONE{_nb}\n"
            yield json.dumps({
                "type": "done",
                "conversation_id": new_conv_id,
                "message_id": new_message.id,
            })
            return

        full_content = ""
        try:
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    full_content += delta
                    yield delta
        except asyncio.CancelledError:
            pass

    # Save to database
    assistant_token_count = estimate_tokens(full_content)
    logger.info("Response generated: %d chars, %d tokens, preview='%s'", len(full_content), assistant_token_count, full_content[:200])
    new_conv_id, new_message = await add_message_pair(
        conversation_id,
        full_user_message,
        user_token_count,
        full_content,
        assistant_token_count,
        user_image_url,
        user_file_url,
    )

    # Update conversation title on first message
    if not conversation_id:
        await update_conversation_title(new_conv_id, user_message[:50])

    _nb = chr(0)
    yield f"\n\n{_nb}DONE{_nb}\n"
    yield json.dumps({
        "type": "done",
        "conversation_id": new_conv_id,
        "message_id": new_message.id,
    })
