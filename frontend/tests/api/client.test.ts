import { beforeEach, describe, expect, it, vi } from "vitest";

describe("api/client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("apiFetch 200 携带 Authorization 头", async () => {
    const { setAccessToken, apiFetch } = await import("../../src/api/client");
    setAccessToken("tok");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await apiFetch("/api/v1/x");
    expect(res.status).toBe(200);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("apiFetch 401 → refresh 成功 → 重试一次原请求", async () => {
    const { apiFetch } = await import("../../src/api/client");
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await apiFetch("/api/v1/x");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect((await import("../../src/api/client")).getAccessToken()).toBe("fresh");
  });

  it("apiFetch 401 → refresh 失败 → dispatch auth:logout", async () => {
    const { apiFetch } = await import("../../src/api/client");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    const res = await apiFetch("/api/v1/data");
    expect(res.status).toBe(401);
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "auth:logout" }));
  });

  it("refreshOnce 单飞：并发只发一次 /auth/refresh", async () => {
    const { refreshOnce } = await import("../../src/api/client");
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ access_token: "t" }), { status: 200 }));
    const [a, b] = await Promise.all([refreshOnce(), refreshOnce()]);
    expect(a).toBe("t");
    expect(b).toBe("t");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("readErrorDetail：JSON detail / 纯文本 / 空回落", async () => {
    const { readErrorDetail } = await import("../../src/api/client");
    expect(await readErrorDetail(new Response(JSON.stringify({ detail: "坏了" })), "默认")).toBe("坏了");
    expect(await readErrorDetail(new Response("纯文本错误"), "默认")).toBe("纯文本错误");
    expect(await readErrorDetail(new Response(""), "默认")).toBe("默认");
  });
});
