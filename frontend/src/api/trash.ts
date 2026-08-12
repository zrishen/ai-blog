import { API_BASE, apiFetch, assertOk, parseJson } from "./client";

import type { FileProcessingJob } from "./files";

export type TrashItemType =
  | "conversation"
  | "file_document"
  | "blog_post";

export interface TrashItem {
  type: TrashItemType;
  id: number;
  name: string;
  deleted_at: string;
}

export interface TrashListResponse {
  items: TrashItem[];
  total: number;
}

export interface TrashPurgeResponse {
  status: "ok" | "partial";
  deleted: Array<{ type: TrashItemType; id: number }>;
  failed: Array<{
    item: { type: TrashItemType; id: number };
    code?: string;
    message?: string;
  }>;
  remaining: number;
}

export async function listTrash(): Promise<TrashListResponse> {
  const res = await apiFetch(`${API_BASE}/trash`);
  await assertOk(res, "Failed to fetch trash items");
  return parseJson<TrashListResponse>(res);
}

export async function restoreTrashItem(
  type: TrashItemType,
  id: number,
): Promise<void | FileProcessingJob> {
  const res = await apiFetch(`${API_BASE}/trash/${type}/${id}/restore`, { method: "POST" });
  await assertOk(res, "Failed to restore trash item");
  if (res.status === 202 || type === "file_document") return parseJson<FileProcessingJob>(res);
}

export async function purgeTrashItem(type: TrashItemType, id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/trash/${type}/${id}`, { method: "DELETE" });
  await assertOk(res, "Failed to purge trash item");
}

export async function emptyTrash(): Promise<TrashPurgeResponse> {
  const res = await apiFetch(`${API_BASE}/trash`, { method: "DELETE" });
  await assertOk(res, "Failed to empty trash");
  return parseJson<TrashPurgeResponse>(res);
}
