import { API_BASE, apiFetch, readErrorDetail } from "./client";

export type PluginPermissionLevel = "read" | "write";
export type PluginTransport = "stdio" | "streamable-http";

export interface PluginSummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  permission_level: PluginPermissionLevel;
  tool_count: number;
  is_enabled: boolean;
}

export interface AdminPlugin {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  transport: PluginTransport;
  command: string | null;
  args: string[];
  has_env_vars: boolean;
  url: string | null;
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
  permission_level: PluginPermissionLevel;
  is_published: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminPluginDraft {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  transport: PluginTransport;
  command?: string;
  args?: string[];
  env_vars?: Record<string, string>;
  url?: string;
  permission_level?: PluginPermissionLevel;
  is_published?: boolean;
}

export async function listPlugins(): Promise<PluginSummary[]> {
  const res = await apiFetch(`${API_BASE}/plugins`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "读取插件列表失败"));
  const data = await res.json() as { plugins: PluginSummary[] };
  return data.plugins;
}

export async function setPluginEnabled(pluginId: number, isEnabled: boolean): Promise<PluginSummary> {
  const res = await apiFetch(`${API_BASE}/plugins/${pluginId}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_enabled: isEnabled }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "更新插件状态失败"));
  return res.json();
}

export async function listAdminPlugins(): Promise<AdminPlugin[]> {
  const res = await apiFetch(`${API_BASE}/admin/plugins`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "读取平台插件失败"));
  const data = await res.json() as { plugins: AdminPlugin[] };
  return data.plugins;
}

export async function createAdminPlugin(data: AdminPluginDraft): Promise<AdminPlugin> {
  const res = await apiFetch(`${API_BASE}/admin/plugins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "创建插件失败"));
  return res.json();
}

export async function updateAdminPlugin(
  pluginId: number,
  data: Partial<Omit<AdminPluginDraft, "slug" | "transport">>,
): Promise<AdminPlugin> {
  const res = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "更新插件失败"));
  return res.json();
}

export async function setAdminPluginPublished(pluginId: number, isPublished: boolean): Promise<AdminPlugin> {
  const res = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}/publish`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_published: isPublished }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "更新插件发布状态失败"));
  return res.json();
}

export async function deleteAdminPlugin(pluginId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorDetail(res, "删除插件失败"));
  }
}
