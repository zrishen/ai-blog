import { API_BASE, apiFetch, readErrorDetail } from "./client";

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

// ---- User settings ----

export type LLMProtocol = "openai" | "anthropic";

export interface LLMSettings {
  protocol: LLMProtocol;
  base_url: string | null;
  model: string | null;
  has_api_key: boolean;
}

export interface LLMSettingsUpdate {
  protocol: LLMProtocol;
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
}

export async function getLLMSettings(): Promise<LLMSettings> {
  const res = await apiFetch(`${API_BASE}/settings/llm`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "Failed to fetch LLM settings"));
  return res.json();
}

export async function updateLLMSettings(data: LLMSettingsUpdate): Promise<LLMSettings> {
  const res = await apiFetch(`${API_BASE}/settings/llm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "Failed to update LLM settings"));
  return res.json();
}
