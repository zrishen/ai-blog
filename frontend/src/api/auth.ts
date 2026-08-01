import { API_BASE, apiFetch, readErrorDetail } from "./client";

export type LLMProtocol = "openai" | "anthropic";

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
