import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
}));

vi.mock("../../src/api/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/files")>();
  return { ...actual, getFileProcessingJob: (...args: unknown[]) => mocks.getJob(...args) };
});

import { useJobPoller } from "../../src/features/workspace/file-processing/useJobPoller";

import type { FileProcessingJob } from "../../src/api/files";

const JOB_ID = "job-1";

function makeJob(overrides: Partial<FileProcessingJob> = {}): FileProcessingJob {
  return {
    id: JOB_ID,
    job_type: "upload",
    status: "running",
    current_stage: "parse",
    progress_model_version: "upload_v1",
    progress_percent: 10,
    progress_json: {
      model_version: "upload_v1",
      current_stage: "parse",
      stages: { parse: { completed: 1, total: 10, unit: "page" } },
    },
    client_request_id: null,
    source_document_id: null,
    result_document_id: null,
    original_name: "a.pdf",
    error_code: null,
    error_message: null,
    created_at: "2026-08-12T00:00:00Z",
    updated_at: "2026-08-12T00:00:01Z",
    finished_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getJob.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useJobPoller", () => {
  it("失败后按指数退避调度：attempts=1→2s, 2→4s, 3→8s, 4→16s, 5+→30s(封顶)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mocks.getJob.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useJobPoller());
    const onUpdate = vi.fn();
    act(() => {
      result.current.poll(JOB_ID, "upload", { onUpdate });
    });
    // poll 立即触发首次 tick：flush 微任务后第一次 getFileProcessingJob 已失败
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);

    // 第 1 次失败 → 2s 后调度下一次
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(2);

    // 第 2 次失败 → 4s 后调度
    await vi.advanceTimersByTimeAsync(3999);
    expect(mocks.getJob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(3);

    // 第 3 次失败 → 8s 后调度
    await vi.advanceTimersByTimeAsync(7999);
    expect(mocks.getJob).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(4);

    // 第 4 次失败 → 16s 后调度
    await vi.advanceTimersByTimeAsync(15999);
    expect(mocks.getJob).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(5);

    // 第 5 次失败 → 30s（封顶）后调度
    await vi.advanceTimersByTimeAsync(29999);
    expect(mocks.getJob).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(6);
  });

  it("成功一次后 attemptsRef 清零：下一次失败 backoff 从 2s 重新计", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    // 先两次失败，第三次仍 running（非终态，继续轮询且 attempts 清零），再失败
    const running = makeJob({ status: "running" });
    mocks.getJob
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error("e3"));

    const { result } = renderHook(() => useJobPoller());
    const onUpdate = vi.fn();
    const onSucceeded = vi.fn();
    act(() => {
      result.current.poll(JOB_ID, "upload", { onUpdate, onSucceeded });
    });

    // 首次 tick（立即）：失败 → 调度 2s
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);

    // 2s 后第二次 tick：失败 → 调度 4s
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.getJob).toHaveBeenCalledTimes(2);

    // 4s 后第三次 tick：成功（status running，继续轮询，间隔 POLL_MS=1s）
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.getJob).toHaveBeenCalledTimes(3);
    expect(mocks.getJob).toHaveLastReturnedWith(Promise.resolve(running));
    expect(onUpdate).toHaveBeenCalledWith(running);
    // 成功后 attemptsRef 已清零，但仍非终态 → 1s 后再轮询
    expect(onSucceeded).not.toHaveBeenCalled();

    // 1s 后第四次 tick：失败 → backoff 从 attempts=1 重新计 = 2s
    mocks.getJob.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);

    // 验证退避已重置为 2s（而非接着旧的进度）
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(2);
  });

  it("连续失败超 MAX_POLL_ATTEMPTS(30) 后停止轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mocks.getJob.mockRejectedValue(new Error("always fails"));

    const { result } = renderHook(() => useJobPoller());
    act(() => {
      result.current.poll(JOB_ID, "upload", {});
    });

    // 首次立即失败（attempt #1）+ 后续 29 次（attempt #2..#30）均重试，
    // 第 31 次 attempt 超过 MAX_POLL_ATTEMPTS(30) 后不再调度
    // advance 到不再有 timer 排队
    await vi.advanceTimersByTimeAsync(0); // attempt 1
    for (let i = 0; i < 30; i++) {
      // 每次失败后调度一个 timer（封顶 30s），推进到下一轮
      await vi.advanceTimersByTimeAsync(30_000);
    }
    // 此时已无 timer，继续推进不应再调用 getJob
    const countAfterGiveUp = mocks.getJob.mock.calls.length;
    expect(countAfterGiveUp).toBeLessThanOrEqual(31);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getJob.mock.calls.length).toBe(countAfterGiveUp);
  });

  it("终态 succeeded 触发 onSucceeded 并停止轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const running = makeJob({ status: "running" });
    const succeeded = makeJob({ status: "succeeded", progress_percent: 100, result_document_id: 9, finished_at: "2026-08-12T00:00:10Z" });
    mocks.getJob
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(succeeded);

    const { result } = renderHook(() => useJobPoller());
    const onSucceeded = vi.fn();
    const onUpdate = vi.fn();
    act(() => {
      result.current.poll(JOB_ID, "upload", { onSucceeded, onUpdate });
    });

    // 首次 tick：running，调度 1s 后再轮询
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(running);
    expect(onSucceeded).not.toHaveBeenCalled();

    // 1s 后第二次 tick：succeeded → 终态分发
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getJob).toHaveBeenCalledTimes(2);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(onSucceeded).toHaveBeenCalledWith(succeeded);

    // 停止轮询：推进时间不应再调用 getJob
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getJob).toHaveBeenCalledTimes(2);
  });

  it("终态 failed 触发 onFailed 并停止轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const failed = makeJob({ status: "failed", error_code: "PARSE_ERR", error_message: "bad", finished_at: "2026-08-12T00:00:05Z" });
    mocks.getJob.mockResolvedValue(failed);

    const { result } = renderHook(() => useJobPoller());
    const onFailed = vi.fn();
    act(() => {
      result.current.poll(JOB_ID, "restore", { onFailed });
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(failed);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
  });

  it("终态 cancelled 触发 onCancelled 并停止轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const cancelled = makeJob({ status: "cancelled", finished_at: "2026-08-12T00:00:05Z" });
    mocks.getJob.mockResolvedValue(cancelled);

    const { result } = renderHook(() => useJobPoller());
    const onCancelled = vi.fn();
    act(() => {
      result.current.poll(JOB_ID, "index", { onCancelled });
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onCancelled).toHaveBeenCalledWith(cancelled);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
  });

  it("reject 不产生 unhandled rejection（catch 链路兜底）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", handler);

    try {
      mocks.getJob.mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useJobPoller());
      act(() => {
        result.current.poll(JOB_ID, "upload", {});
      });
      // 推进多次失败轮询，确认 tick 内 try/catch 兜住所有 reject
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(60_000);
      // 让微任务队列排空，潜在的 unhandled rejection 会在此刻被捕获
      await vi.runAllTimersAsync();
      expect(unhandled).toHaveLength(0);
      result.current.clearAll();
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});
