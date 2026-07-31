import { API_BASE, apiFetch, readErrorDetail } from "./client";
import type { FileProcessingJob } from "./files";

export interface WorkspaceNode {
  id: number;
  parent_id: number | null;
  node_type: "folder" | "resource";
  resource_type: string | null;
  resource_id: number | null;
  blog_status?: string | null;
  name: string;
  slug: string;
  sort_order: number;
  auto_index: boolean;
  created_at: string;
  updated_at: string;
}

export interface RagSource {
  id: number;
  resource_type: string;
  resource_id: number;
  index_status: string;
  indexed_version: string | null;
  collection_name: string;
  error_message: string | null;
  indexed_at: string | null;
  updated_at: string;
}

async function unwrap(res: Response, fallback: string) {
  if (!res.ok) throw new Error(await readErrorDetail(res, fallback));
  if (res.status === 204) return null;
  return res.json();
}

export async function getWorkspaceTree(): Promise<WorkspaceNode[]> {
  const res = await apiFetch(`${API_BASE}/workspace/tree`);
  const data = await unwrap(res, "加载工作区失败");
  return (data?.nodes ?? []) as WorkspaceNode[];
}

export async function createFolder(
  name: string,
  parentId: number | null = null,
  autoIndex = false
): Promise<WorkspaceNode> {
  const res = await apiFetch(`${API_BASE}/workspace/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id: parentId, auto_index: autoIndex }),
  });
  return (await unwrap(res, "创建文件夹失败")) as WorkspaceNode;
}

export async function deleteNode(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/workspace/nodes/${id}`, { method: "DELETE" });
  await unwrap(res, "删除失败");
}

export async function patchNode(
  id: number,
  patch: { name?: string; auto_index?: boolean },
): Promise<WorkspaceNode> {
  const res = await apiFetch(`${API_BASE}/workspace/nodes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await unwrap(res, "更新失败")) as WorkspaceNode;
}

export async function moveNode(id: number, parentId: number | null): Promise<void> {
  const res = await apiFetch(`${API_BASE}/workspace/nodes/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId }),
  });
  await unwrap(res, "移动失败");
}

export async function reorderNodes(
  parentId: number | null,
  orderedIds: number[],
): Promise<WorkspaceNode[]> {
  const res = await apiFetch(`${API_BASE}/workspace/nodes/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId, ordered_ids: orderedIds }),
  });
  return ((await unwrap(res, "排序失败")) ?? []) as WorkspaceNode[];
}

export async function attachResource(
  resourceType: string,
  resourceId: number,
  parentId: number,
  name?: string,
): Promise<WorkspaceNode> {
  const res = await apiFetch(`${API_BASE}/workspace/resources/attach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resource_type: resourceType,
      resource_id: resourceId,
      parent_id: parentId,
      ...(name ? { name } : {}),
    }),
  });
  return (await unwrap(res, "挂靠失败")) as WorkspaceNode;
}

export async function moveResource(
  resourceType: string,
  resourceId: number,
  parentId: number,
): Promise<WorkspaceNode> {
  const res = await apiFetch(`${API_BASE}/workspace/resources/${resourceType}/${resourceId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_parent_id: parentId }),
  });
  return (await unwrap(res, "移动失败")) as WorkspaceNode;
}

export async function detachResource(resourceType: string, resourceId: number): Promise<void> {
  await apiFetch(`${API_BASE}/workspace/resources/${resourceType}/${resourceId}`, { method: "DELETE" });
}

export interface AiKnowledgeJoinResult {
  rag_source: RagSource;
  job: FileProcessingJob | null;
}

export async function joinAiKnowledge(
  resourceType: string,
  resourceId: number,
): Promise<AiKnowledgeJoinResult> {
  const res = await apiFetch(`${API_BASE}/workspace/ai-knowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
  });
  return (await unwrap(res, "加入 AI 知识失败")) as AiKnowledgeJoinResult;
}

export async function leaveAiKnowledge(resourceType: string, resourceId: number): Promise<void> {
  await apiFetch(`${API_BASE}/workspace/ai-knowledge/${resourceType}/${resourceId}`, { method: "DELETE" });
}

export async function listAiKnowledge(): Promise<RagSource[]> {
  const res = await apiFetch(`${API_BASE}/workspace/ai-knowledge`);
  return ((await unwrap(res, "加载 AI 知识失败")) ?? []) as RagSource[];
}
