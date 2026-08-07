import { API_BASE, apiFetch, readErrorDetail, getAccessToken, setAccessToken } from "./client";

// 预览 base URL（不带凭证）。docx/xlsx 经 apiFetch 自动携带 Authorization header，凭证不入 URL。
export function getPreviewBaseUrl(filename: string): string {
  return `${API_BASE}/preview/${encodeURIComponent(filename)}`;
}

// PDF 走 iframe 无法带 header：先换一把 scoped 预览令牌（type=preview，绑定 filename）再拼 ?token=。
// 即便该 URL 进入日志/历史，泄露的也仅是"只能预览该文件"的弱令牌，而非全局 access JWT。
export async function getPreviewToken(filename: string): Promise<string> {
  const res = await apiFetch(`${API_BASE}/preview/token?filename=${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error("获取预览令牌失败");
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("获取预览令牌失败");
  return data.token;
}

export async function getPreviewPdfUrl(filename: string): Promise<string> {
  const token = await getPreviewToken(filename);
  return `${getPreviewBaseUrl(filename)}?token=${encodeURIComponent(token)}`;
}

export interface FileDocument {
  id: number;
  collection_name: string;
  original_name: string;
  file_path: string;
  chunk_count: number;
  created_at: string;
}

export interface FileDocumentsResponse {
  documents: FileDocument[];
}

export type FileProcessingStatus = "staging" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

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
  job_type: "upload" | "restore" | "index";
  status: FileProcessingStatus;
  current_stage: string;
  progress_model_version: string;
  progress_percent: number;
  progress_json: FileProcessingProgressJson;
  client_request_id: string | null;
  source_document_id: number | null;
  result_document_id: number | null;
  original_name: string;
  target_resource_type: string | null;
  target_resource_id: number | null;
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
  setAccessToken(null);
  window.dispatchEvent(new Event("auth:logout"));
}

export function uploadToFileLibrary(
  file: File,
  clientRequestId: string,
  onProgress?: (progress: FileUploadProgress) => void,
): FileUploadRequest {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append("file", file);

  const promise = new Promise<FileProcessingJob>((resolve, reject) => {
    xhr.open("POST", `${API_BASE}/files/documents`);
    xhr.withCredentials = true;
    const token = getAccessToken();
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

export async function listFileDocuments(): Promise<FileDocumentsResponse> {
  const res = await apiFetch(`${API_BASE}/files/documents`);
  if (!res.ok) throw new Error("Failed to fetch file library documents");
  return res.json();
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
