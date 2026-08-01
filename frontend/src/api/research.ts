import { API_BASE, apiFetch, readErrorDetail } from "./client";

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

export async function draftResearch(topicId: number): Promise<ResearchDraftPreview> {
  const res = await apiFetch(`${API_BASE}/research/topics/${topicId}/draft-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to generate research draft preview");
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

