import { API_BASE, apiFetch, readErrorDetail } from "./client";

// ============ Knowledge Base Documents & Collections ============

export interface KBDocument {
  id: number;
  collection_name: string;
  original_name: string;
  file_path: string;
  chunk_count: number;
  category_id: number | null;
  created_at: string;
}

export interface KBDocumentsResponse {
  documents: KBDocument[];
}

export interface CollectionInfo {
  name: string;
  document_count: number;
}

export async function uploadToKB(file: File, categoryId?: number): Promise<KBDocument> {
  const formData = new FormData();
  formData.append("file", file);
  if (categoryId != null) {
    formData.append("category_id", String(categoryId));
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await apiFetch(`${API_BASE}/kb/documents`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await readErrorDetail(res, "知识库上传失败");
      throw new Error(`知识库上传失败：${err}`);
    }
    return res.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("知识库向量化超时，请换小文件重试或查看后端日志", { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function listKBDocuments(categoryId?: number): Promise<KBDocumentsResponse> {
  const q = categoryId ? `?category_id=${categoryId}` : "";
  const res = await apiFetch(`${API_BASE}/kb/documents${q}`);
  if (!res.ok) throw new Error("Failed to fetch KB documents");
  return res.json();
}

export async function setDocumentCategory(docId: number, categoryId: number | null): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/documents/${docId}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
  if (!res.ok) throw new Error("Failed to set document category");
}

export async function deleteKBDocument(docId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/documents/${docId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB document: ${err}`);
  }
}

export async function listKBCollections(): Promise<CollectionInfo[]> {
  const res = await apiFetch(`${API_BASE}/kb/collections`);
  if (!res.ok) throw new Error("Failed to fetch KB collections");
  return res.json();
}

export async function deleteKBCollection(name: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/collections/${name}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB collection: ${err}`);
  }
}

// ============ KB Categories ============

export interface KBCategoryData {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent_id: number | null;
  children?: KBCategoryData[];
  created_at: string;
}

export async function listKBCategories(): Promise<KBCategoryData[]> {
  const res = await apiFetch(`${API_BASE}/kb/categories`);
  if (!res.ok) throw new Error("Failed to fetch KB categories");
  return res.json();
}

export async function createKBCategory(data: {
  name: string;
  description?: string;
  parent_id?: number | null;
}): Promise<KBCategoryData> {
  const res = await apiFetch(`${API_BASE}/kb/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create KB category");
  return res.json();
}

export async function updateKBCategory(id: number, data: {
  name?: string;
  description?: string;
  parent_id?: number | null;
}): Promise<KBCategoryData> {
  const res = await apiFetch(`${API_BASE}/kb/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update KB category: ${err}`);
  }
  return res.json();
}

export async function deleteKBCategory(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/kb/categories/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete KB category: ${err}`);
  }
}
