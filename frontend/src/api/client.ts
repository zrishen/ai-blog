const API_BASE = "/api";

export async function fetchConversations() {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function createConversation(title: string) {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function deleteConversation(id: number) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function getMessages(conversationId: number) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

export async function sendChat(
  content: string,
  conversationId: number | null,
  imageUrl: string | undefined,
  fileUrl: string | undefined,
  onChunk: (chunk: string) => void,
  onDone: (metadata: { conversation_id: number; message_id: number }) => void,
  onToolCall?: (toolName: string) => void,
  onToolResult?: (toolName: string, result: string) => void,
) {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, conversation_id: conversationId, image_url: imageUrl || null, file_url: fileUrl || null }),
  });
  if (!res.ok) throw new Error("Chat request failed");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  // Backend yields: raw text chunks, then \n\n\x00DONE\x00\n, then JSON metadata
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    accumulated += decoder.decode(value, { stream: true });

    // Check for the TOOLDONE marker (\x00TOOLDONE\x00) — tool execution completion
    const toolDoneIdx = accumulated.indexOf("\x00TOOLDONE\x00");
    if (toolDoneIdx !== -1) {
      const afterToolDone = accumulated.substring(toolDoneIdx + 10).trim();
      if (afterToolDone.startsWith("{")) {
        try {
          const data = JSON.parse(afterToolDone);
          if (onToolResult && data.tool_name && data.result !== undefined) {
            onToolResult(data.tool_name, data.result);
          }
        } catch {
          // ignore parse error
        }
      }
      accumulated = "";
      continue;
    }

    // Check for the DONE marker (\x00DONE\x00)
    const doneIdx = accumulated.indexOf("\x00DONE\x00");
    if (doneIdx !== -1) {
      // Text before DONE marker
      const textBefore = accumulated.substring(0, doneIdx).trim();
      if (textBefore) {
        // Check if it's the JSON done signal
        if (textBefore.startsWith("{")) {
          try {
            onDone(JSON.parse(textBefore));
            continue;
          } catch {
            onChunk(textBefore);
          }
        } else {
          onChunk(textBefore);
        }
      }
      // Text after DONE marker (JSON metadata)
      const afterDone = accumulated.substring(doneIdx + 7).trim();
      if (afterDone.startsWith("{")) {
        try {
          onDone(JSON.parse(afterDone));
        } catch {
          // ignore
        }
      }
      accumulated = "";
    } else {
      // Normal text chunk — pass it through
      onChunk(accumulated);
      accumulated = "";
    }
  }
}

export async function sendChatSync(content: string, conversationId: number | null) {
  const res = await fetch(`${API_BASE}/chat`, {
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
  const res = await fetch(`${API_BASE}/upload`, {
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
  created_at: string;
}

export interface KBDocumentsResponse {
  documents: KBDocument[];
}

export interface CollectionInfo {
  name: string;
  document_count: number;
}

export async function uploadToKB(file: File): Promise<KBDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/kb/documents`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KB upload failed: ${err}`);
  }
  return res.json();
}

export async function listKBDocuments(): Promise<KBDocumentsResponse> {
  const res = await fetch(`${API_BASE}/kb/documents`);
  if (!res.ok) throw new Error("Failed to fetch KB documents");
  return res.json();
}

export async function deleteKBDocument(docId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/kb/documents/${docId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB document: ${err}`);
  }
}

export async function listKBCollections(): Promise<CollectionInfo[]> {
  const res = await fetch(`${API_BASE}/kb/collections`);
  if (!res.ok) throw new Error("Failed to fetch KB collections");
  return res.json();
}

export async function deleteKBCollection(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/kb/collections/${name}`, { method: "DELETE" });
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
  const res = await fetch(`${API_BASE}/mcp/servers`);
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
  const res = await fetch(`${API_BASE}/mcp/servers`, {
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

export async function toggleMCPServer(id: number, isActive: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}/toggle`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) throw new Error("Failed to toggle MCP server");
}

export async function deleteMCPServer(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete MCP server: ${err}`);
  }
}
