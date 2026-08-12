import { API_BASE, apiFetch, assertOk, parseJson } from "./client";
import { isAuthUser } from "../lib/isAuthUser";

import type { AuthUser } from "../types/auth";

export type LLMProtocol = "openai" | "anthropic";

export interface AuthResponse {
  access_token: string;
  user: AuthUser;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return authenticate("/auth/login", { username, password });
}

export async function register(username: string, password: string, inviteCode: string): Promise<AuthResponse> {
  return authenticate("/auth/register", { username, password, invite_code: inviteCode });
}

// 登录/注册无 token，走裸 fetch（不引 apiFetch 的 401 刷新逻辑）
async function authenticate(endpoint: string, body: unknown): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
  } catch {
    throw new Error("网络错误，请检查后端是否运行");
  }
  const data = await parseJson<{ access_token?: string; user?: AuthUser; detail?: unknown }>(res);
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "请求失败");
  if (typeof data.access_token !== "string" || !isAuthUser(data.user)) {
    throw new Error("登录响应格式异常");
  }
  return { access_token: data.access_token, user: data.user };
}

export interface LLMSettings {
  protocol: LLMProtocol;
  base_url: string | null;
  model: string | null;
  has_api_key: boolean;
  supports_thinking?: boolean;
}

export interface LLMSettingsUpdate {
  protocol: LLMProtocol;
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
}

export async function getLLMSettings(): Promise<LLMSettings> {
  const res = await apiFetch(`${API_BASE}/settings/llm`);
  await assertOk(res, "Failed to fetch LLM settings");
  return parseJson<LLMSettings>(res);
}

export async function updateLLMSettings(data: LLMSettingsUpdate): Promise<LLMSettings> {
  const res = await apiFetch(`${API_BASE}/settings/llm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to update LLM settings");
  return parseJson<LLMSettings>(res);
}

export async function updateSidebarSettings(showTags: boolean): Promise<void> {
  const res = await apiFetch(`${API_BASE}/settings/sidebar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show_tags: showTags }),
  });
  await assertOk(res, "Failed to update sidebar settings");
}
