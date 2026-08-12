import { API_BASE, apiFetch, assertOk, parseJson } from "./client";

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
