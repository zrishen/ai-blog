import { API_BASE, apiFetch } from "./client";

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
