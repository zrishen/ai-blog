import { API_BASE, apiFetch, parseJson, readErrorDetail } from "./client";

import type { FileProcessingJob } from "./files";

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: "folder" | "blog" | "file";
  resource_type: string | null;
  resource_id: number | null;
  blog_status: string | null;
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

async function unwrap<T>(res: Response, fallback: string): Promise<T | null> {
  if (!res.ok) throw new Error(await readErrorDetail(res, fallback));
  if (res.status === 204) return null;
  return parseJson<T>(res);
}

export async function getWorkspaceTree(): Promise<WorkspaceEntry[]> {
  const res = await apiFetch(`${API_BASE}/workspace/tree`);
  const data = await unwrap<{ entries: WorkspaceEntry[] }>(res, "加载工作目录失败");
  return data?.entries ?? [];
}

export async function createFolder(name: string, parentPath: string | null = null): Promise<WorkspaceEntry> {
  const res = await apiFetch(`${API_BASE}/workspace/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_path: parentPath }),
  });
  return (await unwrap<WorkspaceEntry>(res, "创建文件夹失败"));
}

export async function renameEntry(path: string, name: string): Promise<WorkspaceEntry> {
  const res = await apiFetch(`${API_BASE}/workspace/entries`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
  return (await unwrap<WorkspaceEntry>(res, "重命名失败"));
}

export async function moveEntry(path: string, targetPath: string | null): Promise<WorkspaceEntry> {
  const res = await apiFetch(`${API_BASE}/workspace/entries/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, target_path: targetPath }),
  });
  return (await unwrap<WorkspaceEntry>(res, "移动失败"));
}

export async function deleteFolder(path: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/workspace/folders`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  await unwrap(res, "删除文件夹失败");
}

export async function deleteUnmanagedWorkspaceFile(path: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/workspace/entries`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  await unwrap(res, "删除文件失败");
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
  return (await unwrap<AiKnowledgeJoinResult>(res, "加入 AI 知识失败"));
}

export async function leaveAiKnowledge(resourceType: string, resourceId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/workspace/ai-knowledge/${resourceType}/${resourceId}`, { method: "DELETE" });
  await unwrap(res, "移除 AI 知识失败");
}

export async function listAiKnowledge(): Promise<RagSource[]> {
  const res = await apiFetch(`${API_BASE}/workspace/ai-knowledge`);
  return (await unwrap<RagSource[]>(res, "加载 AI 知识失败")) ?? [];
}
