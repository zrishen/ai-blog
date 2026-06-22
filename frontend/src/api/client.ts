const API_BASE = "/api";

// ---- Auth-aware fetch wrapper ----

async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers = new Headers(options?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.dispatchEvent(new Event("auth:logout"));
  }
  return res;
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    return typeof data.detail === "string" ? data.detail : fallback;
  } catch {
    return text;
  }
}

// ---- Auth API ----

export async function authRegister(username: string, password: string) {
  const res = await apiFetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || "注册失败");
  }
  return res.json();
}

export async function authLogin(username: string, password: string) {
  const res = await apiFetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || "登录失败");
  }
  return res.json();
}

export async function authMe() {
  const res = await apiFetch(`${API_BASE}/auth/me`);
  if (!res.ok) throw new Error("Failed to fetch user info");
  return res.json();
}

// ---- Conversations ----

export async function fetchConversations() {
  const res = await apiFetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function createConversation(title: string) {
  const res = await apiFetch(`${API_BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function deleteConversation(id: number) {
  const res = await apiFetch(`${API_BASE}/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function getMessages(conversationId: number) {
  const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

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

export interface ResearchTopicSummary {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  summary?: string | null;
  last_checked_at?: string | null;
  source_count: number;
  claim_count: number;
  entity_count: number;
  conflict_count: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchSource {
  id: number;
  topic_id: number;
  title: string;
  url?: string | null;
  canonical_url?: string | null;
  publisher?: string | null;
  source_type: string;
  published_at?: string | null;
  fetched_at?: string | null;
  trust_level: string;
  status: string;
  raw_excerpt?: string | null;
  metadata_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchEvidence {
  id: number;
  topic_id: number;
  source_id?: number | null;
  quote: string;
  location?: string | null;
  kind: string;
  metadata_json?: Record<string, unknown> | null;
  created_at: string;
}

export interface ResearchClaim {
  id: number;
  topic_id: number;
  claim_text: string;
  status: string;
  confidence: number;
  claim_type?: string | null;
  adopted: boolean;
  reasoning?: string | null;
  entity_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface ResearchEntity {
  id: number;
  topic_id: number;
  name: string;
  entity_type?: string | null;
  description?: string | null;
  confidence: number;
  status: string;
  aliases_json?: string[] | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ResearchClaimEntityLink {
  id: number;
  claim_id: number;
  entity_id: number;
  topic_id: number;
  role?: string | null;
  created_at: string;
}

export interface ResearchRelation {
  id: number;
  topic_id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  relation_type: string;
  metadata_json?: Record<string, unknown> | null;
  created_at: string;
}

export interface ResearchConflictResolvePayload {
  accepted_claim_id: number;
  rejected_claim_id: number;
}

export interface ResearchProposal {
  id: number;
  topic_id: number;
  proposal_type: string;
  title: string;
  description?: string | null;
  payload_json?: Record<string, unknown> | null;
  status: string;
  created_at: string;
  reviewed_at?: string | null;
  applied_at?: string | null;
}

export interface ResearchRun {
  id: number;
  topic_id: number;
  status: string;
  progress: Record<string, unknown>;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchTopicDetail extends ResearchTopicSummary {
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  claims: ResearchClaim[];
  entities: ResearchEntity[];
  relations: ResearchRelation[];
  claim_entity_links: ResearchClaimEntityLink[];
  proposals: ResearchProposal[];
}

export interface BlogPostResearchLink {
  id: number;
  post_id: number;
  topic_id: number;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export interface BlogResearchSummary {
  post_id: number;
  topics: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
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
          } catch {}
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
          } catch {}
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

export async function sendSharedLandingChat(content: string, onChunk: (chunk: string) => void) {
  const res = await fetch(`${API_BASE}/public/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  await readPlainStream(res, onChunk);
}

export async function sendSharedUserChat(
  username: string,
  content: string,
  postSlug: string | undefined,
  onChunk: (chunk: string) => void,
) {
  const res = await fetch(`${API_BASE}/public/users/${encodeURIComponent(username)}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, post_slug: postSlug || null }),
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

// ============ Knowledge Base API ============

export interface KBDocument {
  id: number;
  collection_name: string;
  original_name: string;
  file_path: string;
  chunk_count: number;
  category_id: number | null;
  created_at: string;
}

export interface KBDocumentsResponse {
  documents: KBDocument[];
}

export interface CollectionInfo {
  name: string;
  document_count: number;
}

export async function uploadToKB(file: File, categoryId?: number): Promise<KBDocument> {
  const formData = new FormData();
  formData.append("file", file);
  if (categoryId != null) {
    formData.append("category_id", String(categoryId));
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await apiFetch(`${API_BASE}/kb/documents`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await readErrorDetail(res, "知识库上传失败");
      throw new Error(`知识库上传失败：${err}`);
    }
    return res.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("知识库向量化超时，请换小文件重试或查看后端日志");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function listKBDocuments(categoryId?: number): Promise<KBDocumentsResponse> {
  const q = categoryId ? `?category_id=${categoryId}` : "";
  const res = await apiFetch(`${API_BASE}/kb/documents${q}`);
  if (!res.ok) throw new Error("Failed to fetch KB documents");
  return res.json();
}

export async function setDocumentCategory(docId: number, categoryId: number | null): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/documents/${docId}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
  if (!res.ok) throw new Error("Failed to set document category");
}

export async function deleteKBDocument(docId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/documents/${docId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB document: ${err}`);
  }
}

export async function listKBCollections(): Promise<CollectionInfo[]> {
  const res = await apiFetch(`${API_BASE}/kb/collections`);
  if (!res.ok) throw new Error("Failed to fetch KB collections");
  return res.json();
}

export async function deleteKBCollection(name: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/collections/${name}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB collection: ${err}`);
  }
}

// ============ MCP Servers API ============

export interface MCPServerConfig {
  id: number;
  name: string;
  server_type: string;
  tools?: string[];
  tools_detail?: Record<string, unknown>[];
  command?: string;
  args?: string[];
  env_vars?: Record<string, string>;
  url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MCPServersResponse {
  servers: MCPServerConfig[];
}

export async function listMCPServers(): Promise<MCPServersResponse> {
  const res = await apiFetch(`${API_BASE}/mcp/servers`);
  if (!res.ok) throw new Error("Failed to fetch MCP servers");
  return res.json();
}

export async function addMCPServer(data: {
  name: string;
  server_type: string;
  command?: string;
  args?: string[];
  env_vars?: Record<string, string>;
  url?: string;
  tools?: string[];
}): Promise<MCPServerConfig> {
  const res = await apiFetch(`${API_BASE}/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to add MCP server: ${err}`);
  }
  return res.json();
}

export async function toggleMCPServer(id: number, isActive: boolean): Promise<MCPServerConfig> {
  const res = await apiFetch(`${API_BASE}/mcp/servers/${id}/toggle`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || "Failed to toggle MCP server";
    try {
      const data = JSON.parse(text);
      if (data?.detail) message = data.detail;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }
  return res.json();
}

export async function deleteMCPServer(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/mcp/servers/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete MCP server: ${err}`);
  }
}

// ============ Research Graph API ============

export async function listResearchTopics(): Promise<ResearchTopicSummary[]> {
  const res = await apiFetch(`${API_BASE}/research/topics`);
  if (!res.ok) throw new Error("Failed to fetch research topics");
  return res.json();
}

export async function createResearchTopic(data: {
  title: string;
  description?: string | null;
}): Promise<ResearchTopicSummary> {
  const res = await apiFetch(`${API_BASE}/research/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "创建研究主题失败");
    throw new Error(err);
  }
  return res.json();
}

export async function getResearchTopic(topicId: number): Promise<ResearchTopicDetail> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}`);
  if (!res.ok) throw new Error("Failed to fetch research topic");
  return res.json();
}

export async function createResearchEntity(topicId: number, data: {
  name: string;
  entity_type?: string | null;
  description?: string | null;
  confidence?: number;
  status?: string;
  aliases?: string[];
}): Promise<ResearchEntity> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "创建研究实体失败");
    throw new Error(err);
  }
  return res.json();
}

export async function listResearchEntities(topicId: number): Promise<ResearchEntity[]> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/entities`);
  if (!res.ok) throw new Error("Failed to fetch research entities");
  return res.json();
}

export async function getResearchEntity(entityId: number): Promise<ResearchEntity> {
  const res = await apiFetch(`${API_BASE}/research/entities/${entityId}`);
  if (!res.ok) throw new Error("Failed to fetch research entity");
  return res.json();
}

export async function updateResearchEntity(entityId: number, data: {
  name?: string;
  entity_type?: string | null;
  description?: string | null;
  confidence?: number;
  status?: string;
  aliases?: string[];
}): Promise<ResearchEntity> {
  const res = await apiFetch(`${API_BASE}/research/entities/${entityId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "更新研究实体失败");
    throw new Error(err);
  }
  return res.json();
}

export async function deleteResearchEntity(entityId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/research/entities/${entityId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await readErrorDetail(res, "删除研究实体失败");
    throw new Error(err);
  }
}

export async function updateResearchTopic(topicId: number, data: {
  title?: string;
  description?: string | null;
  status?: string;
  summary?: string | null;
}): Promise<ResearchTopicSummary> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "更新研究主题失败");
    throw new Error(err);
  }
  return res.json();
}

export async function archiveResearchTopic(topicId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/archive`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to archive research topic");
}

export async function deleteResearchTopic(topicId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await readErrorDetail(res, "删除研究主题失败");
    throw new Error(err);
  }
}

export async function runResearchTopic(topicId: number, idempotencyKey?: string): Promise<ResearchRun> {
  const headers = new Headers();
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/run`, {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error("Failed to run research topic");
  return res.json();
}

export async function listResearchRuns(topicId: number): Promise<ResearchRun[]> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/runs`);
  if (!res.ok) throw new Error("Failed to list research runs");
  return res.json();
}

export interface ResearchDraftReference {
  evidence_id?: number;
  quote?: string;
  source_id?: number;
  title?: string;
  url?: string;
}

export interface ResearchDraftPreview {
  title: string;
  outline: string[];
  content: string;
  references: ResearchDraftReference[];
}

export async function draftResearch(topicId: number): Promise<ResearchDraftPreview> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/draft-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to generate research draft preview");
  return res.json();
}

export async function createResearchClaim(topicId: number, data: {
  claim_text: string;
  status?: string;
  confidence?: number;
  claim_type?: string | null;
  adopted?: boolean;
  reasoning?: string | null;
  evidence_ids?: number[];
  entity_ids?: number[];
  entity_names?: string[];
}): Promise<ResearchClaim> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "创建事实声明失败");
    throw new Error(err);
  }
  return res.json();
}

export async function updateResearchClaim(claimId: number, data: {
  status?: string;
  confidence?: number;
  adopted?: boolean;
  reasoning?: string | null;
  evidence_ids?: number[];
  entity_ids?: number[];
  entity_names?: string[];
}): Promise<ResearchClaim> {
  const res = await apiFetch(`${API_BASE}/research/claims/${claimId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "更新事实声明失败");
    throw new Error(err);
  }
  return res.json();
}

export async function resolveResearchConflict(
  relationId: number,
  payload: ResearchConflictResolvePayload,
): Promise<ResearchRelation> {
  const res = await apiFetch(`${API_BASE}/research/conflicts/${relationId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "冲突解决失败");
    throw new Error(err);
  }
  return res.json();
}

export async function updateResearchProposal(proposalId: number, data: {
  status?: string;
}): Promise<ResearchProposal> {
  const res = await apiFetch(`${API_BASE}/research/proposals/${proposalId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await readErrorDetail(res, "更新提案失败");
    throw new Error(err);
  }
  return res.json();
}

export async function attachResearchTopicToPost(postId: number, topicId: number): Promise<BlogPostResearchLink> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/research-topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic_id: topicId }),
  });
  if (!res.ok) throw new Error("Failed to attach research topic");
  return res.json();
}

export async function getBlogResearchSummary(postId: number): Promise<BlogResearchSummary> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/research-summary`);
  if (!res.ok) throw new Error("Failed to fetch blog research summary");
  return res.json();
}

export async function detachResearchTopicFromPost(postId: number, topicId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/research-topics/${topicId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to detach research topic from post");
}

export interface BlogPostClaimLink {
  id: number;
  post_id: number;
  claim_id: number;
  topic_id: number;
  usage_note?: string | null;
  created_at: string;
}

export async function adoptClaimForPost(postId: number, claimId: number, usageNote?: string): Promise<BlogPostClaimLink> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim_id: claimId, usage_note: usageNote || "" }),
  });
  if (!res.ok) throw new Error("Failed to adopt claim for post");
  return res.json();
}

export async function removeClaimFromPost(postId: number, claimId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/claims/${claimId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove claim from post");
}

// ============ Blog API ============

export interface BlogPostData {
  id: number;
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  cover_image?: string;
  status: string;
  tags?: string;
  author?: string;
  view_count: number;
  created_at: string;
  updated_at?: string;
  published_at?: string;
}

export interface BlogListResponse {
  posts: BlogPostData[];
  total: number;
  page: number;
  per_page: number;
}

export interface SiteUserData {
  id: number;
  username: string;
  created_at: string;
  is_owner: boolean;
}

export async function getSiteUser(username: string): Promise<SiteUserData> {
  const res = await apiFetch(`${API_BASE}/public/users/${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error("Failed to fetch site user");
  return res.json();
}

export async function listSitePosts(username: string, params?: {
  include_drafts?: boolean;
  status?: string;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<BlogListResponse> {
  const q = new URLSearchParams();
  if (params?.include_drafts) q.set("include_drafts", "true");
  if (params?.status) q.set("status", params.status);
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.per_page) q.set("per_page", String(params.per_page));
  const query = q.toString();
  const res = await apiFetch(`${API_BASE}/public/users/${encodeURIComponent(username)}/posts${query ? "?" + query : ""}`);
  if (!res.ok) throw new Error("Failed to fetch site posts");
  return res.json();
}

export async function getSitePost(username: string, slug: string): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/public/users/${encodeURIComponent(username)}/posts/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error("Failed to fetch site post");
  return res.json();
}

export async function getOfficialIntroPost(): Promise<BlogPostData> {
  return getSitePost("ai-blog", "ai-blog-intro");
}

export async function listBlogPosts(params?: {
  status?: string;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<BlogListResponse> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.per_page) q.set("per_page", String(params.per_page));
  const query = q.toString();
  const res = await apiFetch(`${API_BASE}/blog/posts${query ? "?" + query : ""}`);
  if (!res.ok) throw new Error("Failed to fetch blog posts");
  return res.json();
}

export async function getBlogPost(id: number): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}`);
  if (!res.ok) throw new Error("Failed to fetch blog post");
  return res.json();
}

export async function createBlogPost(data: {
  title: string;
  content: string;
  excerpt?: string;
  cover_image?: string | null;
  status?: string;
  tags?: string;
  author?: string;
}): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create blog post: ${err}`);
  }
  return res.json();
}

export async function updateBlogPost(id: number, data: {
  title?: string;
  content?: string;
  excerpt?: string;
  cover_image?: string | null;
  status?: string;
  tags?: string;
}): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update blog post: ${err}`);
  }
  return res.json();
}

export async function deleteBlogPost(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete blog post");
}

export async function publishBlogPost(id: number, publish: boolean): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}/publish`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish }),
  });
  if (!res.ok) throw new Error("Failed to publish/unpublish blog post");
  return res.json();
}

export async function generateBlogCover(id: number): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}/generate-cover`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to generate blog cover: ${err}`);
  }
  return res.json();
}

export async function suggestBlogTags(id: number): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await apiFetch(`${API_BASE}/blog/posts/${id}/suggest-tags`, {
      method: "POST",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "标签生成失败");
    }
    const data = await res.json();
    return data.tags;
  } finally {
    clearTimeout(timeout);
  }
}

// ============ KB Category API ============

export interface KBCategoryData {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent_id: number | null;
  children?: KBCategoryData[];
  created_at: string;
}

export async function listKBCategories(): Promise<KBCategoryData[]> {
  const res = await apiFetch(`${API_BASE}/kb/categories`);
  if (!res.ok) throw new Error("Failed to fetch KB categories");
  return res.json();
}

export async function createKBCategory(data: {
  name: string;
  description?: string;
  parent_id?: number | null;
}): Promise<KBCategoryData> {
  const res = await apiFetch(`${API_BASE}/kb/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create KB category");
  return res.json();
}

export async function updateKBCategory(id: number, data: {
  name?: string;
  description?: string;
  parent_id?: number | null;
}): Promise<KBCategoryData> {
  const res = await apiFetch(`${API_BASE}/kb/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update KB category: ${err}`);
  }
  return res.json();
}

export async function deleteKBCategory(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/categories/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB category: ${err}`);
  }
}

export function getPreviewUrl(filename: string): string {
  const token = localStorage.getItem("auth_token");
  const base = `${API_BASE}/preview/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
