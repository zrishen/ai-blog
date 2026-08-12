import {
  API_BASE,
  apiFetch,
  assertOk,
  getAccessToken,
  refreshOnce,
  setAccessToken,
} from "./client";

import { isChatAttachment, type ChatAttachment } from "@/types/chat";

export interface ChatAttachmentUploadRequest {
  promise: Promise<ChatAttachment>;
  cancel: () => void;
}

function parseXhrError(xhr: XMLHttpRequest, fallback: string): string {
  const text = xhr.responseText;
  if (!text) return fallback;
  try {
    const data = JSON.parse(text) as { detail?: unknown };
    return typeof data.detail === "string" ? data.detail : fallback;
  } catch {
    return text;
  }
}

function sendAttachmentUpload(
  file: File,
  draftKey: string | undefined,
  attachmentId: string,
  onProgress: ((progress: number) => void) | undefined,
  signal: AbortSignal,
  allowRefresh: boolean,
): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("附件上传已取消", "AbortError"));
      return;
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    if (draftKey) formData.append("draft_key", draftKey);

    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.open("POST", `${API_BASE}/chat/attachments`);
    xhr.withCredentials = true;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("X-Attachment-Id", attachmentId);

    xhr.upload.onloadstart = () => onProgress?.(1);
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      if (total > 0) {
        onProgress?.(Math.min(99, Math.max(1, Math.round((event.loaded / total) * 100))));
      }
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("附件上传网络连接中断"));
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("附件上传已取消", "AbortError"));
    };
    xhr.onload = async () => {
      signal.removeEventListener("abort", abort);
      if (xhr.status === 401 && allowRefresh) {
        const fresh = await refreshOnce();
        if (signal.aborted) {
          reject(new DOMException("附件上传已取消", "AbortError"));
          return;
        }
        if (fresh) {
          setAccessToken(fresh);
          sendAttachmentUpload(file, draftKey, attachmentId, onProgress, signal, false).then(resolve, reject);
          return;
        }
        setAccessToken(null);
        window.dispatchEvent(new Event("auth:logout"));
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(parseXhrError(xhr, "附件上传失败")));
        return;
      }
      try {
        onProgress?.(100);
        const parsed: unknown = JSON.parse(xhr.responseText);
        if (!isChatAttachment(parsed)) {
          reject(new Error("附件已上传，但服务器响应无法解析"));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error("附件已上传，但服务器响应无法解析", { cause: error }));
      }
    };
    onProgress?.(1);
    xhr.send(formData);
  });
}

export function uploadChatAttachment(
  file: File,
  options: {
    attachmentId: string;
    draftKey?: string;
    onProgress?: (progress: number) => void;
  },
): ChatAttachmentUploadRequest {
  const controller = new AbortController();
  return {
    promise: sendAttachmentUpload(
      file,
      options.draftKey,
      options.attachmentId,
      options.onProgress,
      controller.signal,
      true,
    ),
    cancel: () => controller.abort(),
  };
}

export async function deleteChatAttachment(attachmentId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/chat/attachments/${encodeURIComponent(attachmentId)}`, {
    method: "DELETE",
  });
  await assertOk(res, "附件删除失败");
}

export async function getChatAttachmentBlob(attachmentId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await apiFetch(
    `${API_BASE}/chat/attachments/${encodeURIComponent(attachmentId)}/content`,
    { signal },
  );
  await assertOk(res, "附件读取失败");
  return res.blob();
}
