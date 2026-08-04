import type { ChatAttachment } from "../features/ai-chat/types";
import { API_BASE, apiFetch } from "./client";

export interface BlogToolMeta {
  operation?: string;
  post_id?: number;
  slug?: string;
  title?: string;
  [key: string]: unknown;
}

const _TOOL_MARKER = "\x00TOOLDONE\x00";
const _DONE_MARKER = "\x00DONE\x00";
const _BLOGSTART_MARKER = "\x00BLOGSTART\x00";
const _BLOGDELTA_MARKER = "\x00BLOGDELTA\x00";
const _REASONING_MARKER = "\x00REASONING\x00";
const _LOOPSTEP_MARKER = "\x00LOOPSTEP\x00";
const _ROUNDDELTA_MARKER = "\x00ROUNDDELTA\x00";
const _ROUNDEND_MARKER = "\x00ROUNDEND\x00";
const _STREAMERROR_MARKER = "\x00STREAMERROR\x00";
const _PATCHSTART_MARKER = "\x00PATCHSTART\x00";
const _PATCHDELTA_MARKER = "\x00PATCHDELTA\x00";
const _TOOLPREP_MARKER = "\x00TOOLPREP\x00";
const _PROTOCOL_MARKERS = [
  ["REASONING", _REASONING_MARKER],
  ["TOOLDONE", _TOOL_MARKER],
  ["TOOLPREP", _TOOLPREP_MARKER],
  ["BLOGSTART", _BLOGSTART_MARKER],
  ["BLOGDELTA", _BLOGDELTA_MARKER],
  ["PATCHSTART", _PATCHSTART_MARKER],
  ["PATCHDELTA", _PATCHDELTA_MARKER],
  ["LOOPSTEP", _LOOPSTEP_MARKER],
  ["ROUNDDELTA", _ROUNDDELTA_MARKER],
  ["ROUNDEND", _ROUNDEND_MARKER],
  ["STREAMERROR", _STREAMERROR_MARKER],
  ["DONE", _DONE_MARKER],
] as const;
const _PROTOCOL_MARKER_NAMES = _PROTOCOL_MARKERS.map(([name]) => name);

type ProtocolMarkerName = typeof _PROTOCOL_MARKERS[number][0];

function _findNextProtocolMarker(text: string): { name: ProtocolMarkerName; index: number } | null {
  let next: { name: ProtocolMarkerName; index: number } | null = null;
  for (const [name, marker] of _PROTOCOL_MARKERS) {
    const index = text.indexOf(marker);
    if (index !== -1 && (!next || index < next.index)) next = { name, index };
  }
  return next;
}

function _findCompleteJson(str: string, start: number): { endIndex: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { endIndex: i + 1 };
      }
    }
  }

  return null;
}

function _stripProtocolMarkers(text: string): string {
  const normalized = text.replace(/[\0�]/g, "");
  let output = "";
  let index = 0;

  while (index < normalized.length) {
    const marker = _PROTOCOL_MARKER_NAMES.find((name) => normalized.startsWith(name, index));
    if (!marker) {
      output += normalized[index];
      index += 1;
      continue;
    }

    let payloadStart = index + marker.length;
    while (payloadStart < normalized.length && /\s/.test(normalized[payloadStart])) {
      payloadStart += 1;
    }

    if (payloadStart < normalized.length && normalized[payloadStart] === "{") {
      const jsonResult = _findCompleteJson(normalized, payloadStart);
      if (!jsonResult) break;
      index = jsonResult.endIndex;
      continue;
    }

    output += normalized[index];
    index += 1;
  }

  return output;
}

function _hasUnresolvedProtocolMarker(text: string): boolean {
  const normalized = text.replace(/[\0�]/g, "");
  let searchIndex = 0;
  let hasCompleteMarker = false;

  while (searchIndex < normalized.length) {
    let markerIndex = -1;
    let marker = "";
    for (const name of _PROTOCOL_MARKER_NAMES) {
      const index = normalized.indexOf(name, searchIndex);
      if (index !== -1 && (markerIndex === -1 || index < markerIndex)) {
        markerIndex = index;
        marker = name;
      }
    }
    if (markerIndex === -1) break;

    let payloadStart = markerIndex + marker.length;
    while (payloadStart < normalized.length && /\s/.test(normalized[payloadStart])) {
      payloadStart += 1;
    }
    if (payloadStart >= normalized.length) return true;
    if (normalized[payloadStart] === "{") {
      const jsonResult = _findCompleteJson(normalized, payloadStart);
      if (!jsonResult) return true;
      hasCompleteMarker = true;
      searchIndex = jsonResult.endIndex;
      continue;
    }
    searchIndex = markerIndex + 1;
  }

  return /[\0�]/.test(text) && !hasCompleteMarker;
}

export type ThinkingMode = "fast" | "balanced" | "smart";

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
  imageUrl?: string;
  fileUrl?: string;
  attachments?: Array<{ id: string }>;
  thinkingMode?: ThinkingMode;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  callbacks: SendChatCallbacks;
}

export async function sendChat(
  content: string,
  conversationId: number | null,
  options: SendChatOptions,
) {
  const {
    imageUrl,
    fileUrl,
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
      image_url: imageUrl || null,
      file_url: fileUrl || null,
      attachments: attachments ?? [],
      thinking_mode: thinkingMode ?? "balanced",
      context: context ?? null,
    }),
    signal,
  });
  if (!res.ok) throw new Error("Chat request failed");

  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
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
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
          if (typeof payload.round_id === "number" && typeof payload.delta === "string") {
            onRoundDelta?.(payload as StreamRoundDelta);
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
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
          if (
            typeof payload.round_id === "number"
            && (payload.classification === "loop" || payload.classification === "final" || payload.classification === "discard")
            && typeof payload.text === "string"
          ) {
            onRoundEnd?.(payload as StreamRoundEnd);
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
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
          if (typeof payload.message === "string") onStreamError?.(payload as StreamError);
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
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
          if (typeof payload.post_id === "number" && typeof payload.stream_id === "string") {
            onBlogStart?.(payload as BlogStreamStart);
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
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (
              typeof payload.post_id === "number"
              && typeof payload.stream_id === "string"
              && typeof payload.content_delta === "string"
            ) {
              onBlogDelta?.(payload as BlogStreamDelta);
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
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (
              typeof payload.post_id === "number"
              && typeof payload.stream_id === "string"
              && typeof payload.target_text === "string"
            ) {
              onPatchStart?.(payload as BlogPatchStart);
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
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (
              typeof payload.post_id === "number"
              && typeof payload.stream_id === "string"
              && typeof payload.replacement_delta === "string"
            ) {
              onPatchDelta?.(payload as BlogPatchDelta);
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
          const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
          if (typeof payload.tool_name === "string" && typeof payload.stream_id === "string") {
            onToolPrep?.(payload as ToolPrepEvent);
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
          const data = JSON.parse(jsonText);
          const meta: StreamToolMeta | undefined = (data.call_id !== undefined || data.round_id !== undefined || data.loop_step_index !== undefined || data.stream_id !== undefined)
            ? {
                call_id: typeof data.call_id === "string" ? data.call_id : undefined,
                round_id: typeof data.round_id === "number" ? data.round_id : undefined,
                loop_step_index: typeof data.loop_step_index === "number" ? data.loop_step_index : undefined,
                stream_id: typeof data.stream_id === "string" ? data.stream_id : undefined,
              }
            : undefined;
          if (data.status === "start" && data.tool_name) {
            onToolCall?.(data.tool_name, meta);
          } else if (data.status === "end" && data.tool_name && data.result !== undefined) {
            onToolResult?.(data.tool_name, data.result, data.blog_meta, data.references, meta);
          }
        } catch { /* malformed JSON — skip */ }

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
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (payload.reasoning_delta && onReasoning) {
              onReasoning(payload.reasoning_delta);
            }
          } catch { /* ignore parse errors */ }
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
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (payload.text && onLoopStep) {
              onLoopStep(payload.text);
            }
          } catch { /* ignore parse errors */ }
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
              onDone?.(JSON.parse(textBefore));
              parsedBefore = true;
            } catch {
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
          onDone?.(JSON.parse(afterDone.substring(0, jsonResult.endIndex)));
        } catch {
          /* malformed DONE metadata — consume the frame without applying it */
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

async function readPlainStream(res: Response, onChunk: (chunk: string) => void) {
  if (!res.ok) throw new Error("Chat request failed");
  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    if (_hasUnresolvedProtocolMarker(pending)) continue;
    const cleaned = _stripProtocolMarkers(pending);
    if (cleaned) onChunk(cleaned);
    pending = "";
  }

  if (pending) {
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

export async function uploadFile(file: File): Promise<{ stored_name: string; original_name: string; download_url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${err}`);
  }
  return res.json();
}
