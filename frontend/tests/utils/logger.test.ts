import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/react", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("../../src/api/client", () => ({ API_BASE: "/api/v1", getAccessToken: () => null }));

describe("logger", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logError 上报后端并打印 console", async () => {
    const { logError } = await import("../../src/api/logger");
    logError(new Error("boom"), { source: "test" });
    expect(console.error).toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).message).toBe("boom");
    expect(JSON.parse(init.body as string).source).toBe("test");
  });

  it("同 message+source 在 10s 去重窗口内只发一次", async () => {
    const { logError } = await import("../../src/api/logger");
    logError(new Error("dup"), { source: "t" });
    logError(new Error("dup"), { source: "t" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("不同 message 突破全局速率上限后丢弃", async () => {
    const { logError } = await import("../../src/api/logger");
    for (let i = 0; i < 30; i++) {
      logError(new Error(`e${i}`), { source: "t" });
    }
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("logWarn 不上报后端（避免噪音）", async () => {
    const { logWarn } = await import("../../src/api/logger");
    logWarn("小心", { k: 1 });
    expect(console.warn).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
