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

export type FileProcessingStatus = "staging" | "queued" | "running" | "succeeded" | "failed";

export interface FileProcessingStage {
  completed: number;
  total: number;
  unit: string;
  label?: string;
}

export interface FileProcessingProgressJson {
  model_version: string;
  current_stage: string;
  stages: Record<string, FileProcessingStage>;
}

export interface FileProcessingJob {
  id: string;
  job_type: "upload" | "restore";
  status: FileProcessingStatus;
  current_stage: string;
  progress_model_version: string;
  progress_percent: number;
  progress_json: FileProcessingProgressJson;
  client_request_id: string | null;
  source_document_id: number | null;
  result_document_id: number | null;
  original_name: string;
  category_id: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface FileUploadProgress {
  percent: number | null;
  stage: string;
}

export interface FileUploadRequest {
  promise: Promise<FileProcessingJob>;
  cancel: () => void;
}

export class FileUploadNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FileUploadNetworkError";
  }
}

function handleUnauthorized() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_user");
  window.dispatchEvent(new Event("auth:logout"));
}

export function uploadToFileLibrary(
  file: File,
  categoryId: number | undefined,
  clientRequestId: string,
  onProgress?: (progress: FileUploadProgress) => void,
): FileUploadRequest {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append("file", file);
  if (categoryId != null) formData.append("category_id", String(categoryId));

  const promise = new Promise<FileProcessingJob>((resolve, reject) => {
    xhr.open("POST", `${API_BASE}/files/documents`);
    const token = localStorage.getItem("auth_token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("X-File-Request-Id", clientRequestId);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        onProgress?.({ percent: null, stage: "正在上传文件" });
        return;
      }
      onProgress?.({
        percent: Math.floor((25 * event.loaded) / event.total),
        stage: "正在上传文件",
      });
    };
    xhr.upload.onload = () => onProgress?.({ percent: 25, stage: "文件已发送，等待服务器确认" });
    xhr.onerror = () => reject(new FileUploadNetworkError("文件上传网络连接中断"));
    xhr.onabort = () => reject(new DOMException("文件上传已取消", "AbortError"));
    xhr.onload = () => {
      if (xhr.status === 401) handleUnauthorized();
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = xhr.responseText || "文件库上传失败";
        try {
          detail = JSON.parse(xhr.responseText)?.detail || detail;
        } catch {
          // 保留原始响应文本
        }
        reject(new Error(`文件库上传失败：${detail}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as FileProcessingJob);
      } catch (error) {
        reject(new FileUploadNetworkError("文件已发送，但服务器响应丢失", { cause: error }));
      }
    };
    xhr.send(formData);
  });

  return { promise, cancel: () => xhr.abort() };
}

export async function getFileProcessingJob(id: string): Promise<FileProcessingJob> {
  const res = await apiFetch(`${API_BASE}/files/processing-jobs/${id}`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "文件处理任务查询失败"));
  return res.json();
}

function normalizeJobs(value: FileProcessingJob[] | { jobs: FileProcessingJob[] }): FileProcessingJob[] {
  return Array.isArray(value) ? value : value.jobs ?? [];
}

export async function listActiveFileProcessingJobs(): Promise<FileProcessingJob[]> {
  const res = await apiFetch(`${API_BASE}/files/processing-jobs?active_only=true`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "活动文件处理任务查询失败"));
  return normalizeJobs(await res.json());
}

export async function listFileProcessingJobsByRequestId(clientRequestId: string): Promise<FileProcessingJob[]> {
  const query = new URLSearchParams({ client_request_id: clientRequestId });
  const res = await apiFetch(`${API_BASE}/files/processing-jobs?${query}`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "文件处理任务重新关联失败"));
  return normalizeJobs(await res.json());
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

export async function updateFileDocument(docId: number, originalName: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/documents/${docId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ original_name: originalName }),
  });
  if (!res.ok) throw new Error("Failed to update file document");
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
