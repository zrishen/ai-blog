import { API_BASE, apiFetch, readErrorDetail } from "./client";

export function getPreviewUrl(filename: string): string {
  const token = localStorage.getItem("auth_token");
  const base = `${API_BASE}/preview/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ============ File Library Documents & Collections ============

export interface FileDocument {
  id: number;
  collection_name: string;
  original_name: string;
  file_path: string;
  chunk_count: number;
  category_id: number | null;
  created_at: string;
}

export interface FileDocumentsResponse {
  documents: FileDocument[];
}

export interface CollectionInfo {
  name: string;
  document_count: number;
}

export async function uploadToFileLibrary(file: File, categoryId?: number): Promise<FileDocument> {
  const formData = new FormData();
  formData.append("file", file);
  if (categoryId != null) {
    formData.append("category_id", String(categoryId));
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await apiFetch(`${API_BASE}/files/documents`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await readErrorDetail(res, "文件库上传失败");
      throw new Error(`文件库上传失败：${err}`);
    }
    return res.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("文件库向量化超时，请换小文件重试或查看后端日志", { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function listFileDocuments(categoryId?: number): Promise<FileDocumentsResponse> {
  const q = categoryId ? `?category_id=${categoryId}` : "";
  const res = await apiFetch(`${API_BASE}/files/documents${q}`);
  if (!res.ok) throw new Error("Failed to fetch file library documents");
  return res.json();
}

export async function setDocumentCategory(docId: number, categoryId: number | null): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/documents/${docId}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
  if (!res.ok) throw new Error("Failed to set document category");
}

export async function deleteFileDocument(docId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/documents/${docId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete file library document: ${err}`);
  }
}

export async function listFileCollections(): Promise<CollectionInfo[]> {
  const res = await apiFetch(`${API_BASE}/files/collections`);
  if (!res.ok) throw new Error("Failed to fetch file library collections");
  return res.json();
}

export async function deleteFileCollection(name: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/collections/${name}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete file library collection: ${err}`);
  }
}

// ============ File Library Categories ============

export interface FileCategoryData {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent_id: number | null;
  children?: FileCategoryData[];
  created_at: string;
}

export async function listFileCategories(): Promise<FileCategoryData[]> {
  const res = await apiFetch(`${API_BASE}/files/categories`);
  if (!res.ok) throw new Error("Failed to fetch file library categories");
  return res.json();
}

export async function createFileCategory(data: {
  name: string;
  description?: string;
  parent_id?: number | null;
}): Promise<FileCategoryData> {
  const res = await apiFetch(`${API_BASE}/files/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create file library category");
  return res.json();
}

export async function updateFileCategory(id: number, data: {
  name?: string;
  description?: string;
  parent_id?: number | null;
}): Promise<FileCategoryData> {
  const res = await apiFetch(`${API_BASE}/files/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update file library category: ${err}`);
  }
  return res.json();
}

export async function deleteFileCategory(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/categories/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete file library category: ${err}`);
  }
}
