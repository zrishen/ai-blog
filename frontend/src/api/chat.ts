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
const _BLOGDELTA_MARKER = "\x00BLOGDELTA\x00";
const _REASONING_MARKER = "\x00REASONING\x00";
const _PATCHSTART_MARKER = "\x00PATCHSTART\x00";
const _PATCHDELTA_MARKER = "\x00PATCHDELTA\x00";
const _PROTOCOL_MARKER_NAMES = ["REASONING", "TOOLDONE", "BLOGDELTA", "PATCHSTART", "PATCHDELTA", "DONE"] as const;

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

export type RagMode = "normal" | "knowledge" | "auto";
export type ThinkingMode = "normal" | "deep";

export interface StreamReference {
  type: "rag" | "mcp";
  source?: string;
  collection?: string;
  distance?: number;
  server?: string;
  tool?: string;
}

export async function sendChat(
  content: string,
  conversationId: number | null,
  imageUrl: string | undefined,
  fileUrl: string | undefined,
  onChunk: (chunk: string) => void,
  onDone: (metadata: { conversation_id: number; message_id: number }) => void,
  onToolCall?: (toolName: string) => void,
  onToolResult?: (toolName: string, result: string, blogMeta?: BlogToolMeta, references?: StreamReference[]) => void,
  onBlogDelta?: (contentDelta: string) => void,
  ragMode?: RagMode,
  thinkingMode?: ThinkingMode,
  onReasoning?: (text: string) => void,
  onPatchStart?: (targetText: string) => void,
  onPatchDelta?: (delta: string) => void,
  context?: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const res = await apiFetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      conversation_id: conversationId,
      image_url: imageUrl || null,
      file_url: fileUrl || null,
      rag_mode: ragMode ?? null,
      use_rag: ragMode === "knowledge",
      thinking_mode: thinkingMode ?? "normal",
      context: context ?? null,
    }),
    signal,
  });
  if (!res.ok) throw new Error("Chat request failed");

  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let pendingDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    accumulated += decoder.decode(value, { stream: true });

    // Flush plain text preceding control markers, but only when we know
    // the marker and its payload will not arrive in a future chunk.
    let processed = false;
    while (!processed) {
      processed = true;

      if (pendingDone) {
        pendingDone = false;
        const trimmed = accumulated.trim();
        if (trimmed.startsWith("{")) {
          try {
            onDone(JSON.parse(trimmed));
            accumulated = "";
            continue; // reprocess
          } catch {
            /* stream JSON may be partial, ignore parse error */
          }
        }
      }

      // --- BLOGDELTA marker（优先于 TOOL marker 检测）---
      const bdIdx = accumulated.indexOf(_BLOGDELTA_MARKER);
      if (bdIdx !== -1) {
        if (bdIdx > 0) {
          onChunk(accumulated.substring(0, bdIdx));
        }
        const afterMarker = accumulated.substring(bdIdx + _BLOGDELTA_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (payload.content_delta && onBlogDelta) {
              onBlogDelta(payload.content_delta);
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

      // --- PATCHSTART marker ---
      const psIdx = accumulated.indexOf(_PATCHSTART_MARKER);
      if (psIdx !== -1) {
        if (psIdx > 0) {
          onChunk(accumulated.substring(0, psIdx));
        }
        const afterMarker = accumulated.substring(psIdx + _PATCHSTART_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (payload.target_text && onPatchStart) {
              onPatchStart(payload.target_text);
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

      // --- PATCHDELTA marker ---
      const pdIdx = accumulated.indexOf(_PATCHDELTA_MARKER);
      if (pdIdx !== -1) {
        if (pdIdx > 0) {
          onChunk(accumulated.substring(0, pdIdx));
        }
        const afterMarker = accumulated.substring(pdIdx + _PATCHDELTA_MARKER.length);
        const jsonResult = _findCompleteJson(afterMarker, 0);
        if (jsonResult) {
          try {
            const payload = JSON.parse(afterMarker.substring(0, jsonResult.endIndex));
            if (payload.replacement_delta && onPatchDelta) {
              onPatchDelta(payload.replacement_delta);
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

      const toolIdx = accumulated.indexOf(_TOOL_MARKER);
      if (toolIdx !== -1) {
        // Emit any text before the marker
        if (toolIdx > 0) {
          onChunk(accumulated.substring(0, toolIdx));
        }

        const afterMarker = accumulated.substring(toolIdx + 10);
        const braceIdx = afterMarker.indexOf("{");
        if (braceIdx === -1) {
          // JSON payload hasn't arrived yet — keep the marker + whatever follows
          accumulated = _TOOL_MARKER + afterMarker;
          continue; // wait for next chunk
        }

        const fullJson = _findCompleteJson(afterMarker, braceIdx);
        if (!fullJson) {
          // JSON not yet complete — keep marker + afterMarker for next chunk
          accumulated = _TOOL_MARKER + afterMarker;
          continue;
        }

        const jsonText = afterMarker.substring(braceIdx, fullJson.endIndex);
        try {
          const data = JSON.parse(jsonText);
          if (data.status === "start" && data.tool_name) {
            onToolCall?.(data.tool_name);
          } else if (data.status === "end" && data.tool_name && data.result !== undefined) {
            onToolResult?.(data.tool_name, data.result, data.blog_meta, data.references);
          }
        } catch { /* malformed JSON — skip */ }

        // Consume marker + JSON, keep remainder
        const afterJson = afterMarker.substring(fullJson.endIndex);
        if (afterJson.startsWith("\n")) {
          accumulated = afterJson.substring(1);
        } else {
          accumulated = afterJson;
        }
        processed = false; // reprocess remainder
        continue;
      }

      // --- REASONING marker ---
      const rsIdx = accumulated.indexOf(_REASONING_MARKER);
      if (rsIdx !== -1) {
        if (rsIdx > 0) {
          onChunk(accumulated.substring(0, rsIdx));
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

      const doneIdx = accumulated.indexOf(_DONE_MARKER);
      if (doneIdx !== -1) {
        // Emit text before DONE if it's not pure JSON
        const textBefore = accumulated.substring(0, doneIdx).trim();
        if (textBefore) {
          if (textBefore.startsWith("{")) {
            try {
              onDone(JSON.parse(textBefore));
            } catch {
              onChunk(textBefore);
            }
          } else {
            onChunk(textBefore);
          }
        }

        const afterDone = accumulated.substring(doneIdx + 7).trim();
        if (afterDone.startsWith("{")) {
          try {
            onDone(JSON.parse(afterDone));
          } catch {
            /* ignore malformed stream JSON */
          }
        }
        if (!afterDone) {
          pendingDone = true;
        }
        accumulated = "";
        processed = false; // reprocess
        continue;
      }

      // No complete control frame — but check for incomplete TOOLDONE at the end
      const stillWaiting = accumulated.startsWith(_TOOL_MARKER) ||
        (_TOOL_MARKER.length > 1 && accumulated.endsWith(_TOOL_MARKER.substring(0, _TOOL_MARKER.length - 1)));
      if (stillWaiting) continue;

      // Only flush as plain text when there are no protocol control bytes.
      if (accumulated && !accumulated.includes("\x00") && !accumulated.includes("�")) {
        onChunk(accumulated);
        accumulated = "";
      } else if (accumulated && !_hasUnresolvedProtocolMarker(accumulated)) {
        const cleaned = _stripProtocolMarkers(accumulated);
        if (cleaned) onChunk(cleaned);
        accumulated = "";
      }
    }
  }

  // Drain any remaining plain text without leaking internal protocol frames.
  if (accumulated) {
    const cleaned = _stripProtocolMarkers(accumulated).trim();
    if (cleaned) onChunk(cleaned);
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

export async function sendChatSync(content: string, conversationId: number | null) {
  const res = await apiFetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, conversation_id: conversationId }),
  });
  if (!res.ok) throw new Error("Chat request failed");
  return res.json();
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
