import { logWarn } from "./logger";

import {
  _BLOGDELTA_MARKER,
  _BLOGSTART_MARKER,
  _DONE_MARKER,
  _findCompleteJson,
  _findNextProtocolMarker,
  _hasUnresolvedProtocolMarker,
  _LOOPSTEP_MARKER,
  _PATCHDELTA_MARKER,
  _PATCHSTART_MARKER,
  _REASONING_MARKER,
  _ROUNDDELTA_MARKER,
  _ROUNDEND_MARKER,
  _STREAMERROR_MARKER,
  _stripProtocolMarkers,
  _TOOL_MARKER,
  _TOOLPREP_MARKER,
  type ProtocolMarkerName,
} from "./chatProtocol";
import { API_BASE, apiFetch, assertOk } from "./client";

import type { ChatAttachment, ThinkingMode } from "@/types/chat";

export interface BlogToolMeta {
  operation?: string;
  post_id?: number;
  slug?: string;
  title?: string;
  [key: string]: unknown;
}


export interface StreamReference {
  type: "rag" | "memory" | "mcp";
  source?: string;
  collection?: string;
  distance?: number;
  kind?: string;
  status?: string;
  time?: string;
  evidence?: string;
  path?: string;
  server?: string;
  tool?: string;
}

export interface StreamRoundDelta {
  round_id: number;
  delta: string;
}

export interface StreamRoundEnd {
  round_id: number;
  classification: "loop" | "final" | "discard";
  text: string;
  loop_step_index?: number | null;
}

export interface StreamError {
  message: string;
  round_id?: number;
  loop_step_index?: number;
}

export interface StreamToolMeta {
  call_id?: string;
  round_id?: number;
  loop_step_index?: number;
  stream_id?: string;
}

export interface BlogStreamStart {
  post_id: number;
  stream_id: string;
}

export interface BlogStreamDelta extends BlogStreamStart {
  content_delta: string;
}

export interface BlogPatchStart extends BlogStreamStart {
  target_text: string;
}

export interface BlogPatchDelta extends BlogStreamStart {
  replacement_delta: string;
}

export interface ToolPrepEvent {
  tool_name: string;
  stream_id: string;
}

export interface SendChatCallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (metadata: {
    conversation_id: number;
    message_id: number;
    user_message_id?: number;
    attachments?: ChatAttachment[];
  }) => void;
  onToolPrep?: (event: ToolPrepEvent) => void;
  onToolCall?: (toolName: string, meta?: StreamToolMeta) => void;
  onToolResult?: (
    toolName: string,
    result: string,
    blogMeta?: BlogToolMeta,
    references?: StreamReference[],
    meta?: StreamToolMeta,
  ) => void;
  onBlogStart?: (event: BlogStreamStart) => void;
  onBlogDelta?: (event: BlogStreamDelta) => void;
  onReasoning?: (text: string) => void;
  onLoopStep?: (text: string) => void;
  onRoundDelta?: (round: StreamRoundDelta) => void;
  onRoundEnd?: (round: StreamRoundEnd) => void;
  onStreamError?: (error: StreamError) => void;
  onPatchStart?: (event: BlogPatchStart) => void;
  onPatchDelta?: (event: BlogPatchDelta) => void;
}

export interface SendChatOptions {
  attachments?: Array<{ id: string }>;
  thinkingMode?: ThinkingMode;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  callbacks: SendChatCallbacks;
}

// 流式读取空闲超时：后端静默卡住（不关连接也不发数据）时主动终止，避免 UI 永久停在 streaming 态
const STREAM_IDLE_TIMEOUT_MS = 120_000;

// 带空闲超时的 reader.read()：私有 sendChat 与共享/公共 readPlainStream 共用
async function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const idleTimeout = new Promise<never>((_, reject) => {
    idleTimer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new Error("回复超时，请稍后重试"));
    }, STREAM_IDLE_TIMEOUT_MS);
  });
  idleTimeout.catch(() => {});
  return Promise.race([reader.read(), idleTimeout]).finally(() => {
    if (idleTimer) clearTimeout(idleTimer);
  });
}

// DONE 帧字段校验：会话持久化的两个 id 必须是数字，校验失败丢弃并告警
function isValidDoneMetadata(p: Record<string, unknown>): boolean {
  return typeof p.conversation_id === "number" && typeof p.message_id === "number";
}

// 协议帧处理器：统一"找 marker → 解析完整 JSON → 校验 → 回调 → 截断重扫"骨架。
// 返回 "pending" 表示帧未完整（等更多数据），否则为截断后的剩余缓冲。
type FrameResult = "pending" | { rest: string };

interface ProtocolFrame {
  name: ProtocolMarkerName;
  marker: string;
  handle: (afterMarker: string, emit: SendChatCallbacks) => FrameResult;
}

function parseFrameJson(afterMarker: string): { payload: Record<string, unknown> | null; endIndex: number } | null {
  const jsonResult = _findCompleteJson(afterMarker, 0);
  if (!jsonResult) return null;
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
  } catch { /* ignore malformed JSON */ }
  return { payload, endIndex: jsonResult.endIndex };
}

const PROTOCOL_FRAMES: ProtocolFrame[] = [
  {
    name: "ROUNDDELTA",
    marker: _ROUNDDELTA_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.round_id === "number" && typeof p.delta === "string") {
        emit.onRoundDelta?.(p as unknown as StreamRoundDelta);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "ROUNDEND",
    marker: _ROUNDEND_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (
        p
        && typeof p.round_id === "number"
        && (p.classification === "loop" || p.classification === "final" || p.classification === "discard")
        && typeof p.text === "string"
      ) {
        emit.onRoundEnd?.(p as unknown as StreamRoundEnd);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "STREAMERROR",
    marker: _STREAMERROR_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.message === "string") emit.onStreamError?.(p as unknown as StreamError);
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "BLOGSTART",
    marker: _BLOGSTART_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.post_id === "number" && typeof p.stream_id === "string") {
        emit.onBlogStart?.(p as unknown as BlogStreamStart);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "BLOGDELTA",
    marker: _BLOGDELTA_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.post_id === "number" && typeof p.stream_id === "string" && typeof p.content_delta === "string") {
        emit.onBlogDelta?.(p as unknown as BlogStreamDelta);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "PATCHSTART",
    marker: _PATCHSTART_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.post_id === "number" && typeof p.stream_id === "string" && typeof p.target_text === "string") {
        emit.onPatchStart?.(p as unknown as BlogPatchStart);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "PATCHDELTA",
    marker: _PATCHDELTA_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.post_id === "number" && typeof p.stream_id === "string" && typeof p.replacement_delta === "string") {
        emit.onPatchDelta?.(p as unknown as BlogPatchDelta);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "TOOLPREP",
    marker: _TOOLPREP_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.tool_name === "string" && typeof p.stream_id === "string") {
        emit.onToolPrep?.(p as unknown as ToolPrepEvent);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "REASONING",
    marker: _REASONING_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.reasoning_delta === "string" && p.reasoning_delta && emit.onReasoning) {
        emit.onReasoning(p.reasoning_delta);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
  {
    name: "LOOPSTEP",
    marker: _LOOPSTEP_MARKER,
    handle: (after, emit) => {
      const parsed = parseFrameJson(after);
      if (!parsed) return "pending";
      const p = parsed.payload;
      if (p && typeof p.text === "string" && p.text && emit.onLoopStep) {
        emit.onLoopStep(p.text);
      }
      return { rest: after.substring(parsed.endIndex) };
    },
  },
];

export async function sendChat(
  content: string,
  conversationId: number | null,
  options: SendChatOptions,
) {
  const { attachments, thinkingMode, context, signal, callbacks } = options;
  const { onChunk, onRoundDelta, onRoundEnd, onStreamError } = callbacks;
  const emitChunk = onRoundDelta || onRoundEnd || onStreamError ? undefined : onChunk;
  const res = await apiFetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      conversation_id: conversationId,
      attachments: attachments ?? [],
      thinking_mode: thinkingMode ?? "balanced",
      context: context ?? null,
    }),
    signal,
  });
  await assertOk(res, "Chat request failed");

  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  while (true) {
    const { done, value } = await readWithIdleTimeout(reader);
    if (done) break;

    accumulated += decoder.decode(value, { stream: true });

    // Flush plain text preceding control markers, but only when we know
    // the marker and its payload will not arrive in a future chunk.
    let processed = false;
    while (!processed) {
      processed = true;

      const nextMarker = _findNextProtocolMarker(accumulated);

      if (nextMarker) {
        // DONE 帧的前导文本由 DONE 分支自行处理（合法元数据走 onDone），其余帧统一在此 flush
        if (nextMarker.name !== "DONE" && nextMarker.index > 0) emitChunk?.(accumulated.substring(0, nextMarker.index));
        const frame = PROTOCOL_FRAMES.find((f) => f.name === nextMarker.name);
        if (frame) {
          const result = frame.handle(accumulated.substring(nextMarker.index + frame.marker.length), callbacks);
          if (result !== "pending") {
            accumulated = result.rest;
            processed = false;
          }
          continue;
        }
        if (nextMarker.name === "TOOLDONE") {
          const afterMarker = accumulated.substring(nextMarker.index + _TOOL_MARKER.length);
          const braceIdx = afterMarker.indexOf("{");
          if (braceIdx === -1) {
            accumulated = _TOOL_MARKER + afterMarker;
            continue;
          }
          const fullJson = _findCompleteJson(afterMarker, braceIdx);
          if (!fullJson) {
            accumulated = _TOOL_MARKER + afterMarker;
            continue;
          }
          const jsonText = afterMarker.substring(braceIdx, fullJson.endIndex);
          try {
            const data = JSON.parse(jsonText) as Record<string, unknown>;
            const meta: StreamToolMeta | undefined = (data.call_id !== undefined || data.round_id !== undefined || data.loop_step_index !== undefined || data.stream_id !== undefined)
              ? {
                  call_id: typeof data.call_id === "string" ? data.call_id : undefined,
                  round_id: typeof data.round_id === "number" ? data.round_id : undefined,
                  loop_step_index: typeof data.loop_step_index === "number" ? data.loop_step_index : undefined,
                  stream_id: typeof data.stream_id === "string" ? data.stream_id : undefined,
                }
              : undefined;
            if (data.status === "start" && typeof data.tool_name === "string" && data.tool_name) {
              callbacks.onToolCall?.(data.tool_name, meta);
            } else if (data.status === "end" && typeof data.tool_name === "string" && data.tool_name && data.result !== undefined) {
              callbacks.onToolResult?.(
                data.tool_name,
                typeof data.result === "string" ? data.result : "",
                typeof data.blog_meta === "object" && data.blog_meta !== null ? data.blog_meta as BlogToolMeta : undefined,
                Array.isArray(data.references)
                  ? data.references.filter((r): r is StreamReference => {
                    if (r == null || typeof r !== "object") return false;
                    const type = (r as { type?: unknown }).type;
                    return type === "rag" || type === "memory" || type === "mcp";
                  })
                  : undefined,
                meta,
              );
            }
          } catch (err) { logWarn("chat stream: malformed frame skipped", { error: err }); }
          const afterJson = afterMarker.substring(fullJson.endIndex);
          accumulated = afterJson.startsWith("\n") ? afterJson.substring(1) : afterJson;
          processed = false;
          continue;
        }
        if (nextMarker.name === "DONE") {
          const textBefore = accumulated.substring(0, nextMarker.index).trim();
          let parsedBefore = false;
          if (textBefore) {
            if (textBefore.startsWith("{")) {
              try {
                const parsed = JSON.parse(textBefore) as Record<string, unknown>;
                if (isValidDoneMetadata(parsed)) {
                  callbacks.onDone?.(parsed as unknown as { conversation_id: number; message_id: number; user_message_id?: number; attachments?: ChatAttachment[] });
                  parsedBefore = true;
                } else {
                  logWarn("chat stream: DONE frame failed validation", { parsed });
                  emitChunk?.(textBefore);
                }
              } catch (err) {
                logWarn("chat stream: malformed DONE frame before-marker", { error: err });
                emitChunk?.(textBefore);
              }
            } else {
              emitChunk?.(textBefore);
            }
          }
          const afterDone = accumulated.substring(nextMarker.index + _DONE_MARKER.length).trimStart();
          if (parsedBefore) {
            accumulated = afterDone;
            processed = false;
            continue;
          }
          if (!afterDone.startsWith("{")) {
            accumulated = _DONE_MARKER + afterDone;
            continue;
          }
          const jsonResult = _findCompleteJson(afterDone, 0);
          if (!jsonResult) {
            accumulated = _DONE_MARKER + afterDone;
            continue;
          }
          try {
            const parsed = JSON.parse(afterDone.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
            if (isValidDoneMetadata(parsed)) {
              callbacks.onDone?.(parsed as unknown as { conversation_id: number; message_id: number; user_message_id?: number; attachments?: ChatAttachment[] });
            } else {
              logWarn("chat stream: DONE frame failed validation", { parsed });
            }
          } catch (err) {
            logWarn("chat stream: malformed DONE frame after-marker", { error: err });
          }
          accumulated = afterDone.substring(jsonResult.endIndex);
          processed = false;
          continue;
        }
      }

      // No complete control frame — but check for incomplete TOOLDONE at the end
      const stillWaiting = accumulated.startsWith(_TOOL_MARKER) ||
        (_TOOL_MARKER.length > 1 && accumulated.endsWith(_TOOL_MARKER.substring(0, _TOOL_MARKER.length - 1)));
      if (stillWaiting) continue;

      // 无协议控制字节 → 经 onChunk 输出纯文本；仅当无 round/error 回调时启用裸文本通道
      if (accumulated && !accumulated.includes("\x00") && !accumulated.includes("�")) {
        emitChunk?.(accumulated);
        accumulated = "";
      } else if (accumulated && !_hasUnresolvedProtocolMarker(accumulated)) {
        const cleaned = _stripProtocolMarkers(accumulated);
        if (cleaned) emitChunk?.(cleaned);
        accumulated = "";
      }
    }
  }

  // 缓冲残留无未解析协议帧 → 经 onChunk 输出纯文本
  if (accumulated && !_hasUnresolvedProtocolMarker(accumulated)) {
    const cleaned = _stripProtocolMarkers(accumulated);
    if (cleaned) emitChunk?.(cleaned);
  }
}

// 从缓冲区提取完整 STREAMERROR 帧的 message；帧未完整返回 null
export function _extractStreamError(text: string): string | null {
  const idx = text.indexOf(_STREAMERROR_MARKER);
  if (idx === -1) return null;
  const afterMarker = text.substring(idx + _STREAMERROR_MARKER.length);
  const jsonResult = _findCompleteJson(afterMarker, 0);
  if (!jsonResult) return null;
  try {
    const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as { message?: unknown };
    return typeof payload.message === "string" ? payload.message : "无法获取回复，请稍后重试";
  } catch {
    return "无法获取回复，请稍后重试";
  }
}

async function readPlainStream(res: Response, onChunk: (chunk: string) => void) {
  await assertOk(res, "Chat request failed");
  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await readWithIdleTimeout(reader);
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    // STREAMERROR 帧在共享/公共流里也要冒泡成异常，否则被 strip 成纯文本丢弃、错误不可见
    const streamErr = _extractStreamError(pending);
    if (streamErr !== null) throw new Error(streamErr);
    if (_hasUnresolvedProtocolMarker(pending)) continue;
    const cleaned = _stripProtocolMarkers(pending);
    if (cleaned) onChunk(cleaned);
    pending = "";
  }

  if (pending) {
    const streamErr = _extractStreamError(pending);
    if (streamErr !== null) throw new Error(streamErr);
    const cleaned = _stripProtocolMarkers(pending);
    if (cleaned) onChunk(cleaned);
  }
}

export async function sendSharedLandingChat(content: string, onChunk: (chunk: string) => void, signal?: AbortSignal) {
  const res = await fetch(`${API_BASE}/public/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  });
  await readPlainStream(res, onChunk);
}

export async function sendSharedUserChat(
  username: string,
  content: string,
  postSlug: string | undefined,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API_BASE}/public/users/${encodeURIComponent(username)}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, post_slug: postSlug || null }),
    signal,
  });
  await readPlainStream(res, onChunk);
}
