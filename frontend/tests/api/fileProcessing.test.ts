import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileUploadNetworkError, uploadToFileLibrary } from "../../src/api/files";
import { setAccessToken, getAccessToken } from "../../src/api/client";

class MockXhr {
  static latest: MockXhr;
  upload: { onprogress: ((event: ProgressEvent) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
  status = 202;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  headers = new Map<string, string>();
  aborted = false;
  method = "";
  url = "";

  constructor() { MockXhr.latest = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  send() {}
  abort() { this.aborted = true; this.onabort?.(); }
}

const job = {
  id: "5ce58d72-8b04-44ce-a47c-57369d243a42",
  job_type: "upload",
  status: "queued",
  current_stage: "queued",
  progress_model_version: "upload_v1",
  progress_percent: 25,
  progress_json: { model_version: "upload_v1", current_stage: "queued", stages: {} },
  client_request_id: "request-1",
  source_document_id: null,
  result_document_id: null,
  original_name: "a.pdf",
  error_code: null,
  error_message: null,
  created_at: "2026-07-13T00:00:00Z",
  updated_at: "2026-07-13T00:00:00Z",
  finished_at: null,
};

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", MockXhr);
  setAccessToken("token");
});

describe("uploadToFileLibrary XHR", () => {
  it("将可计算上传进度映射到 0-25 并发送认证与 request id", async () => {
    const updates: Array<{ percent: number | null; stage: string }> = [];
    const request = uploadToFileLibrary(new File(["data"], "a.pdf"), "request-1", (value) => updates.push(value));
    const xhr = MockXhr.latest;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    xhr.upload.onload?.();
    xhr.responseText = JSON.stringify(job);
    xhr.onload?.();
    await expect(request.promise).resolves.toMatchObject({ id: "5ce58d72-8b04-44ce-a47c-57369d243a42" });
    expect(updates).toEqual([
      { percent: 12, stage: "正在上传文件" },
      { percent: 25, stage: "文件已发送，等待服务器确认" },
    ]);
    expect(xhr.headers.get("Authorization")).toBe("Bearer token");
    expect(xhr.headers.get("X-File-Request-Id")).toBe("request-1");
  });

  it("lengthComputable=false 时不伪造百分比", () => {
    const updates: Array<{ percent: number | null; stage: string }> = [];
    uploadToFileLibrary(new File(["data"], "a.pdf"),"request-1", (value) => updates.push(value));
    MockXhr.latest.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 } as ProgressEvent);
    expect(updates).toEqual([{ percent: null, stage: "正在上传文件" }]);
  });

  it("HTTP 错误保留服务端详情且不标记为网络错误", async () => {
    const request = uploadToFileLibrary(new File(["data"], "a.pdf"),"request-1");
    MockXhr.latest.status = 422;
    MockXhr.latest.responseText = JSON.stringify({ detail: "文件格式不受支持" });
    MockXhr.latest.onload?.();
    await expect(request.promise).rejects.toThrow("文件库上传失败：文件格式不受支持");
    await request.promise.catch((error) => expect(error).not.toBeInstanceOf(FileUploadNetworkError));
  });

  it("网络错误与成功响应丢失使用可重联错误类型", async () => {
    const networkRequest = uploadToFileLibrary(new File(["data"], "a.pdf"),"request-1");
    MockXhr.latest.onerror?.();
    await expect(networkRequest.promise).rejects.toBeInstanceOf(FileUploadNetworkError);

    const lostResponseRequest = uploadToFileLibrary(new File(["data"], "a.pdf"),"request-2");
    MockXhr.latest.status = 202;
    MockXhr.latest.responseText = "";
    MockXhr.latest.onload?.();
    await expect(lostResponseRequest.promise).rejects.toBeInstanceOf(FileUploadNetworkError);
  });

  it("401 清理 token 并派发 auth:logout", async () => {
    const logout = vi.fn();
    window.addEventListener("auth:logout", logout);
    const request = uploadToFileLibrary(new File(["data"], "a.pdf"),"request-1");
    MockXhr.latest.status = 401;
    MockXhr.latest.responseText = "unauthorized";
    MockXhr.latest.onload?.();
    await expect(request.promise).rejects.toThrow("文件库上传失败");
    expect(getAccessToken()).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1);
    window.removeEventListener("auth:logout", logout);
  });
});
