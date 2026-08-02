import { API_BASE, apiFetch } from "./client";

export interface BrainStats {
  enabled: boolean;
  entities: number;
  facts: number;
  episodes: number;
  preferences: number;
  chunks: number;
  documents: number;
}

export interface BrainGraphNode {
  id: string;
  name: string;
  entity_type: string | null;
  confidence: number;
}

export interface BrainGraphEdge {
  source: string;
  type: string;
  target: string;
  weight: number;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
}

export interface BrainEntity {
  entity_id: string;
  name: string;
  entity_type: string | null;
  aliases: string[];
  description: string | null;
  confidence: number;
  created_at: string | null;
  last_accessed_at: string | null;
}

export interface BrainEpisode {
  episode_id: string;
  kind: string;
  summary: string;
  occurred_at: string | null;
  conversation_id: number | null;
  participants: string[];
}

export interface BrainPreference {
  pref_id: string;
  key: string;
  value: string;
  confidence: number;
  valid_from: string | null;
}

export interface BrainFact {
  fact_id: string;
  subject_id: string;
  predicate: string;
  object_text: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number;
  source_doc_id: string | null;
}

export type BrainMemoryType = "episode" | "fact" | "preference";

export interface BrainFactCorrection {
  object_text: string;
  predicate?: string | null;
  confidence?: number | null;
}

export interface BrainPreferenceUpdate {
  value: string;
  confidence?: number | null;
}

export async function getBrainStats(): Promise<BrainStats> {
  const res = await apiFetch(`${API_BASE}/brain/stats`);
  if (!res.ok) throw new Error("加载大脑统计失败");
  return res.json();
}

export async function getBrainGraph(limit = 80): Promise<BrainGraph> {
  const res = await apiFetch(`${API_BASE}/brain/graph?limit=${limit}`);
  if (!res.ok) throw new Error("加载知识图谱失败");
  return res.json();
}

export async function listBrainEntities(limit = 200, offset = 0): Promise<BrainEntity[]> {
  const res = await apiFetch(`${API_BASE}/brain/entities?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("加载实体失败");
  return res.json();
}

export async function listBrainEpisodes(limit = 100, offset = 0): Promise<BrainEpisode[]> {
  const res = await apiFetch(`${API_BASE}/brain/episodes?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("加载记忆失败");
  return res.json();
}

export async function listBrainPreferences(): Promise<BrainPreference[]> {
  const res = await apiFetch(`${API_BASE}/brain/preferences`);
  if (!res.ok) throw new Error("加载偏好失败");
  return res.json();
}

export async function listBrainFacts(entityId?: string, limit = 200): Promise<BrainFact[]> {
  const qs = entityId ? `&entity_id=${encodeURIComponent(entityId)}` : "";
  const res = await apiFetch(`${API_BASE}/brain/facts?limit=${limit}${qs}`);
  if (!res.ok) throw new Error("加载事实失败");
  return res.json();
}

export async function deleteBrainMemory(memoryType: BrainMemoryType, memoryId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/brain/memories/${memoryType}/${encodeURIComponent(memoryId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("删除记忆失败");
}

export async function correctBrainFact(
  factId: string,
  payload: BrainFactCorrection,
): Promise<BrainFact> {
  const res = await apiFetch(`${API_BASE}/brain/facts/${encodeURIComponent(factId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("纠正事实失败");
  return res.json();
}

export async function updateBrainPreference(
  prefId: string,
  payload: BrainPreferenceUpdate,
): Promise<BrainPreference> {
  const res = await apiFetch(`${API_BASE}/brain/preferences/${encodeURIComponent(prefId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("更新偏好失败");
  return res.json();
}
