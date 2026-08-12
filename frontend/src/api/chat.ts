import { logWarn } from "@/lib/logger";

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

export async function sendChat(
  content: string,
  conversationId: number | null,
  options: SendChatOptions,
) {
  const {
    attachments,
    thinkingMode,
    context,
    signal,
    callbacks: {
      onChunk,
      onDone,
      onToolPrep,
      onToolCall,
      onToolResult,
      onBlogStart,
      onBlogDelta,
      onReasoning,
      onLoopStep,
      onRoundDelta,
      onRoundEnd,
      onStreamError,
      onPatchStart,
      onPatchDelta,
    },
  } = options;
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

      const rdIdx = nextMarker?.name === "ROUNDDELTA" ? nextMarker.index : -1;
      if (rdIdx !== -1) {
        const afterMarker = accumulated.substring(rdIdx + _ROUNDDELTA_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (!jsonResult) continue;
        try {
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
          if (typeof payload.round_id === "number" && typeof payload.delta === "string") {
            onRoundDelta?.(payload as unknown as StreamRoundDelta);
          }
        } catch { /* ignore malformed JSON */ }
        accumulated = afterMarker.substring(jsonResult.endIndex);
        processed = false;
        continue;
      }

      const reIdx = nextMarker?.name === "ROUNDEND" ? nextMarker.index : -1;
      if (reIdx !== -1) {
        const afterMarker = accumulated.substring(reIdx + _ROUNDEND_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (!jsonResult) continue;
        try {
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
          if (
            typeof payload.round_id === "number"
            && (payload.classification === "loop" || payload.classification === "final" || payload.classification === "discard")
            && typeof payload.text === "string"
          ) {
            onRoundEnd?.(payload as unknown as StreamRoundEnd);
          }
        } catch { /* ignore malformed JSON */ }
        accumulated = afterMarker.substring(jsonResult.endIndex);
        processed = false;
        continue;
      }

      const seIdx = nextMarker?.name === "STREAMERROR" ? nextMarker.index : -1;
      if (seIdx !== -1) {
        const afterMarker = accumulated.substring(seIdx + _STREAMERROR_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (!jsonResult) continue;
        try {
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
          if (typeof payload.message === "string") onStreamError?.(payload as unknown as StreamError);
        } catch { /* ignore malformed JSON */ }
        accumulated = afterMarker.substring(jsonResult.endIndex);
        processed = false;
        continue;
      }

      const bsIdx = nextMarker?.name === "BLOGSTART" ? nextMarker.index : -1;
      if (bsIdx !== -1) {
        if (bsIdx > 0) emitChunk?.(accumulated.substring(0, bsIdx));
        const afterMarker = accumulated.substring(bsIdx + _BLOGSTART_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (!jsonResult) continue;
        try {
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
          if (typeof payload.post_id === "number" && typeof payload.stream_id === "string") {
            onBlogStart?.(payload as unknown as BlogStreamStart);
          }
        } catch { /* ignore parse errors */ }
        accumulated = afterMarker.substring(jsonResult.endIndex);
        processed = false;
        continue;
      }

      const bdIdx = nextMarker?.name === "BLOGDELTA" ? nextMarker.index : -1;
      if (bdIdx !== -1) {
        if (bdIdx > 0) {
          emitChunk?.(accumulated.substring(0, bdIdx));
        }
        const afterMarker = accumulated.substring(bdIdx + _BLOGDELTA_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
            if (
              typeof payload.post_id === "number"
              && typeof payload.stream_id === "string"
              && typeof payload.content_delta === "string"
            ) {
              onBlogDelta?.(payload as unknown as BlogStreamDelta);
            }
          } catch { /* ignore parse errors */ }
          accumulated = afterMarker.substring(jsonResult.endIndex);
        } else {
          accumulated = _BLOGDELTA_MARKER + afterMarker;
          continue;
        }
        processed = false;
        continue;
      }

      const psIdx = nextMarker?.name === "PATCHSTART" ? nextMarker.index : -1;
      if (psIdx !== -1) {
        if (psIdx > 0) {
          emitChunk?.(accumulated.substring(0, psIdx));
        }
        const afterMarker = accumulated.substring(psIdx + _PATCHSTART_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
            if (
              typeof payload.post_id === "number"
              && typeof payload.stream_id === "string"
              && typeof payload.target_text === "string"
            ) {
              onPatchStart?.(payload as unknown as BlogPatchStart);
            }
          } catch { /* ignore parse errors */ }
          accumulated = afterMarker.substring(jsonResult.endIndex);
        } else {
          accumulated = _PATCHSTART_MARKER + afterMarker;
          continue;
        }
        processed = false;
        continue;
      }

      const pdIdx = nextMarker?.name === "PATCHDELTA" ? nextMarker.index : -1;
      if (pdIdx !== -1) {
        if (pdIdx > 0) {
          emitChunk?.(accumulated.substring(0, pdIdx));
        }
        const afterMarker = accumulated.substring(pdIdx + _PATCHDELTA_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
            if (
              typeof payload.post_id === "number"
              && typeof payload.stream_id === "string"
              && typeof payload.replacement_delta === "string"
            ) {
              onPatchDelta?.(payload as unknown as BlogPatchDelta);
            }
          } catch { /* ignore parse errors */ }
          accumulated = afterMarker.substring(jsonResult.endIndex);
        } else {
          accumulated = _PATCHDELTA_MARKER + afterMarker;
          continue;
        }
        processed = false;
        continue;
      }

      // TOOLPREP — 工具参数开始流式生成，提前提示
      const tpIdx = nextMarker?.name === "TOOLPREP" ? nextMarker.index : -1;
      if (tpIdx !== -1) {
        if (tpIdx > 0) emitChunk?.(accumulated.substring(0, tpIdx));
        const afterMarker = accumulated.substring(tpIdx + _TOOLPREP_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (!jsonResult) continue;
        try {
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
          if (typeof payload.tool_name === "string" && typeof payload.stream_id === "string") {
            onToolPrep?.(payload as unknown as ToolPrepEvent);
          }
        } catch { /* ignore parse errors */ }
        accumulated = afterMarker.substring(jsonResult.endIndex);
        processed = false;
        continue;
      }

      const toolIdx = nextMarker?.name === "TOOLDONE" ? nextMarker.index : -1;
      if (toolIdx !== -1) {
        if (toolIdx > 0) {
          emitChunk?.(accumulated.substring(0, toolIdx));
        }

        const afterMarker = accumulated.substring(toolIdx + 10);
        const braceIdx = afterMarker.indexOf("{");
        if (braceIdx === -1) {
          // JSON payload hasn't arrived yet — keep the marker + whatever follows
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
            onToolCall?.(data.tool_name, meta);
          } else if (data.status === "end" && typeof data.tool_name === "string" && data.tool_name && data.result !== undefined) {
            onToolResult?.(
              data.tool_name,
              typeof data.result === "string" ? data.result : "",
              typeof data.blog_meta === "object" && data.blog_meta !== null ? data.blog_meta as BlogToolMeta : undefined,
              Array.isArray(data.references)
                ? data.references.filter((r): r is StreamReference =>
                  r != null && typeof r === "object" && (r.type === "rag" || r.type === "memory" || r.type === "mcp"))
                : undefined,
              meta,
            );
          }
        } catch (err) { logWarn("chat stream: malformed frame skipped", { error: err }); }

        const afterJson = afterMarker.substring(fullJson.endIndex);
        if (afterJson.startsWith("\n")) {
          accumulated = afterJson.substring(1);
        } else {
          accumulated = afterJson;
        }
        processed = false;
        continue;
      }

      const rsIdx = nextMarker?.name === "REASONING" ? nextMarker.index : -1;
      if (rsIdx !== -1) {
        if (rsIdx > 0) {
          emitChunk?.(accumulated.substring(0, rsIdx));
        }
        const afterMarker = accumulated.substring(rsIdx + _REASONING_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
            if (typeof payload.reasoning_delta === "string" && payload.reasoning_delta && onReasoning) {
              onReasoning(payload.reasoning_delta);
            }
          } catch (err) { logWarn("chat stream: malformed frame skipped", { error: err }); }
          accumulated = afterMarker.substring(jsonResult.endIndex);
        } else {
          accumulated = _REASONING_MARKER + afterMarker;
          continue;
        }
        processed = false;
        continue;
      }

      const lsIdx = nextMarker?.name === "LOOPSTEP" ? nextMarker.index : -1;
      if (lsIdx !== -1) {
        if (lsIdx > 0) {
          emitChunk?.(accumulated.substring(0, lsIdx));
        }
        const afterMarker = accumulated.substring(lsIdx + _LOOPSTEP_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex)) as Record<string, unknown>;
            if (typeof payload.text === "string" && payload.text && onLoopStep) {
              onLoopStep(payload.text);
            }
          } catch (err) { logWarn("chat stream: malformed frame skipped", { error: err }); }
          accumulated = afterMarker.substring(jsonResult.endIndex);
        } else {
          accumulated = _LOOPSTEP_MARKER + afterMarker;
          continue;
        }
        processed = false;
        continue;
      }

      const doneIdx = nextMarker?.name === "DONE" ? nextMarker.index : -1;
      if (doneIdx !== -1) {
        // Emit text before DONE if it's not pure JSON
        const textBefore = accumulated.substring(0, doneIdx).trim();
        let parsedBefore = false;
        if (textBefore) {
          if (textBefore.startsWith("{")) {
            try {
              const parsed = JSON.parse(textBefore) as Record<string, unknown>;
              if (isValidDoneMetadata(parsed)) {
                onDone?.(parsed as unknown as { conversation_id: number; message_id: number; user_message_id?: number; attachments?: ChatAttachment[] });
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

        const afterDone = accumulated.substring(doneIdx + _DONE_MARKER.length).trimStart();
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
            onDone?.(parsed as unknown as { conversation_id: number; message_id: number; user_message_id?: number; attachments?: ChatAttachment[] });
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

      // No complete control frame — but check for incomplete TOOLDONE at the end
      const stillWaiting = accumulated.startsWith(_TOOL_MARKER) ||
        (_TOOL_MARKER.length > 1 && accumulated.endsWith(_TOOL_MARKER.substring(0, _TOOL_MARKER.length - 1)));
      if (stillWaiting) continue;

      // Only flush as plain text when there are no protocol control bytes.
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

  // Drain any remaining plain text without leaking internal protocol frames.
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
