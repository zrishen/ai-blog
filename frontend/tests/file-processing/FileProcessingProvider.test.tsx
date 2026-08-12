import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  listActive: vi.fn(),
  listByRequestId: vi.fn(),
  upload: vi.fn(),
  restore: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("../../src/api/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/files")>();
  return {
    ...actual,
    getFileProcessingJob: (...args: unknown[]) => mocks.getJob(...args),
    listActiveFileProcessingJobs: (...args: unknown[]) => mocks.listActive(...args),
    listFileProcessingJobsByRequestId: (...args: unknown[]) => mocks.listByRequestId(...args),
    uploadToFileLibrary: (...args: unknown[]) => mocks.upload(...args),
  };
});

vi.mock("../../src/api/trash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/trash")>();
  return { ...actual, restoreTrashItem: (...args: unknown[]) => mocks.restore(...args) };
});

vi.mock("../../src/stores/authStore", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("../../src/stores/chatStore", () => ({
  useChat: () => ({ dispatch: mocks.dispatch }),
  useChatDispatch: () => mocks.dispatch,
}));

import { FileUploadNetworkError } from "../../src/api/files";
import { FileProcessingProvider, useFileProcessing } from "../../src/lib/providers/FileProcessingProvider";

import type { FileProcessingJob } from "../../src/api/files";

function makeJob(overrides: Partial<FileProcessingJob> = {}): FileProcessingJob {
  return {
    id: "5ce58d72-8b04-44ce-a47c-57369d243a42",
    job_type: "upload",
    status: "running",
    current_stage: "parse",
    progress_model_version: "upload_v1",
    progress_percent: 40,
    progress_json: {
      model_version: "upload_v1",
      current_stage: "parse",
      stages: { parse: { completed: 2, total: 10, unit: "page" } },
    },
    client_request_id: "729912b7-8b10-4055-b483-4e28a9aa7f68",
    source_document_id: null,
    result_document_id: null,
    original_name: "a.pdf",
    error_code: null,
    error_message: null,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:01Z",
    finished_at: null,
    ...overrides,
  };
}

function Probe() {
  const context = useFileProcessing();
  const [returnedUploadJob, setReturnedUploadJob] = useState("none");
  return (
    <div>
      <span data-testid="upload-job">{context.uploadTask?.job?.id || "none"}</span>
      <span data-testid="returned-upload-job">{returnedUploadJob}</span>
      <span data-testid="restore-job">{context.restoreJobs[17]?.id || "none"}</span>
      <button onClick={() => {
        void context.startUpload(new File(["data"], "a.pdf")).then((job) => setReturnedUploadJob(job?.id || "none"));
      }}>upload</button>
      <button onClick={() => {
        const job = context.restoreJobs[17];
        if (job) context.consumeRestoreSuccess(17, job.id);
      }}>consume restore</button>
    </div>
  );
}

function renderProvider() {
  return render(<FileProcessingProvider><Probe /></FileProcessingProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.getJob.mockReset();
  mocks.listActive.mockReset().mockResolvedValue([]);
  mocks.listByRequestId.mockReset().mockResolvedValue([]);
  mocks.upload.mockReset();
  mocks.restore.mockReset();
  mocks.dispatch.mockReset();
});

describe("FileProcessingProvider", () => {
  it("returns the accepted upload job to the workspace caller", async () => {
    const user = userEvent.setup();
    const uploadJob = makeJob();
    const done = makeJob({ status: "succeeded", progress_percent: 100, result_document_id: 42, finished_at: "2026-07-14T00:00:02Z" });
    mocks.upload.mockReturnValueOnce({ promise: Promise.resolve(uploadJob), cancel: vi.fn() });
    mocks.getJob.mockResolvedValue(done);
    renderProvider();

    await waitFor(() => expect(mocks.listActive).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "upload" }));

    // 新契约：startUpload 等 job 终态才 settle（终态 job 才带 result_document_id）
    await waitFor(() => expect(screen.getByTestId("returned-upload-job")).toHaveTextContent(uploadJob.id));
  });

  it("多文件串行排队：第二个上传在上一个 job 终态后才发出请求", async () => {
    const user = userEvent.setup();
    const firstXhrJob = makeJob();
    const firstDone = makeJob({ status: "succeeded", progress_percent: 100, result_document_id: 11, finished_at: "2026-07-14T00:00:02Z" });
    const secondXhrJob = makeJob({ id: "11111111-2222-4333-8444-555555555555" });
    const secondDone = makeJob({ id: "11111111-2222-4333-8444-555555555555", status: "succeeded", progress_percent: 100, result_document_id: 22, finished_at: "2026-07-14T00:00:03Z" });

    let resolveFirst!: (job: FileProcessingJob) => void;
    mocks.upload.mockImplementationOnce(() => ({
      promise: new Promise<FileProcessingJob>((r) => { resolveFirst = r; }),
      cancel: vi.fn(),
    }));
    mocks.upload.mockImplementationOnce(() => ({ promise: Promise.resolve(secondXhrJob), cancel: vi.fn() }));

    let getJobCall = 0;
    mocks.getJob.mockImplementation(() => {
      getJobCall += 1;
      return Promise.resolve(getJobCall === 1 ? firstDone : secondDone);
    });

    renderProvider();
    await waitFor(() => expect(mocks.listActive).toHaveBeenCalled());
    const uploadBtn = screen.getByRole("button", { name: "upload" });
    await user.click(uploadBtn);
    await user.click(uploadBtn);
    // 两个文件都已入队，但第二个的 XHR 尚未发出（第一个还在 in-flight）
    expect(mocks.upload).toHaveBeenCalledTimes(1);

    resolveFirst(firstXhrJob);
    // 第一个 job 终态后，第二个上传才发出
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("returned-upload-job")).toHaveTextContent(secondDone.id));
  });

  it("无 sessionStorage 时恢复 active upload 与 restore 并按 UUID 轮询", async () => {
    const uploadJob = makeJob();
    const restoreJob = makeJob({
      id: "067227bc-a540-4e9a-9efe-228b2fed90d4",
      job_type: "restore",
      source_document_id: 17,
      client_request_id: null,
    });
    mocks.listActive.mockResolvedValueOnce([uploadJob, restoreJob]);
    mocks.getJob.mockImplementation(() => new Promise(() => {}));
    renderProvider();

    expect(await screen.findByTestId("upload-job")).toHaveTextContent(uploadJob.id);
    expect(screen.getByTestId("restore-job")).toHaveTextContent(restoreJob.id);
    expect(mocks.getJob).toHaveBeenCalledWith(uploadJob.id);
    expect(mocks.getJob).toHaveBeenCalledWith(restoreJob.id);
  });

  it("网络错误按 request id 重联，HTTP 错误保留原错误且不重联", async () => {
    const user = userEvent.setup();
    const recovered = makeJob({ status: "queued", progress_percent: 25 });
    mocks.upload.mockImplementationOnce(() => ({
      promise: Promise.resolve().then(() => { throw new FileUploadNetworkError("断网"); }),
      cancel: vi.fn(),
    }));
    mocks.listByRequestId.mockResolvedValueOnce([recovered]);
    mocks.getJob.mockImplementation(() => new Promise(() => {}));
    const first = renderProvider();
    await waitFor(() => expect(mocks.listActive).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "upload" }));
    await waitFor(() => expect(mocks.listByRequestId).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("upload-job")).toHaveTextContent(recovered.id);
    const requestId = mocks.upload.mock.calls[0][1] as string;
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    first.unmount();
    sessionStorage.clear();

    mocks.listActive.mockClear().mockResolvedValue([]);
    mocks.listByRequestId.mockClear();
    mocks.upload.mockImplementationOnce(() => ({
      promise: Promise.resolve().then(() => { throw new Error("文件库上传失败：文件格式不受支持"); }),
      cancel: vi.fn(),
    }));
    renderProvider();
    await waitFor(() => expect(mocks.listActive).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "upload" }));
    await waitFor(() => expect(screen.getByTestId("upload-job")).toHaveTextContent("none"));
    expect(mocks.listByRequestId).not.toHaveBeenCalled();
  });

  it("同一恢复任务成功只增加一次 revision，并由消费者显式清除成功映射", async () => {
    const user = userEvent.setup();
    const restoreJob = makeJob({
      id: "067227bc-a540-4e9a-9efe-228b2fed90d4",
      job_type: "restore",
      source_document_id: 17,
      client_request_id: null,
    });
    const succeeded = makeJob({ ...restoreJob, status: "succeeded", progress_percent: 100, finished_at: "2026-07-14T00:00:02Z" });
    mocks.listActive.mockResolvedValueOnce([restoreJob, restoreJob]);
    mocks.getJob.mockResolvedValue(succeeded);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("restore-job")).toHaveTextContent(succeeded.id));
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "INCREMENT_FILE_RESTORE_REVISIONS" });

    await user.click(screen.getByRole("button", { name: "consume restore" }));
    expect(screen.getByTestId("restore-job")).toHaveTextContent("none");
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it("upload 任务存在时在中上方渲染独立浮层，失败时可通过关闭按钮清除", async () => {
    const uploadJob = makeJob({ status: "running", progress_percent: 35 });
    mocks.listActive.mockResolvedValueOnce([uploadJob]);
    mocks.getJob.mockImplementation(() => new Promise(() => {}));
    renderProvider();

    const overlay = await screen.findByTestId("file-processing-upload-overlay");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveTextContent("a.pdf");
    expect(overlay).toHaveTextContent("35%");
    expect(overlay).toHaveAttribute("role", "status");
  });

  it("upload 失败时浮层展示错误文案并提供关闭按钮", async () => {
    const user = userEvent.setup();
    mocks.upload.mockImplementationOnce(() => ({
      promise: Promise.resolve().then(() => { throw new Error("文件库上传失败：文件格式不受支持"); }),
      cancel: vi.fn(),
    }));
    renderProvider();
    await waitFor(() => expect(mocks.listActive).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "upload" }));

    const overlay = await screen.findByTestId("file-processing-upload-overlay");
    expect(overlay).toHaveTextContent("文件库上传失败：文件格式不受支持");
    const closeBtn = overlay.querySelector('button[aria-label="关闭上传提示"]');
    expect(closeBtn).not.toBeNull();
    await user.click(closeBtn as HTMLElement);
    expect(screen.queryByTestId("file-processing-upload-overlay")).not.toBeInTheDocument();
  });
});
