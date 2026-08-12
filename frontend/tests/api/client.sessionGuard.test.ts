import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../../src/api/client";
import { getLLMSettings } from "../../src/api/auth";

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client 会话纪元守卫", () => {
  it("请求发起时已认证、返回时已登出 → 丢弃响应", async () => {
    setAccessToken("tok");
    let resolveFetch!: (res: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })),
    );

    const pending = getLLMSettings();
    // 慢响应期间发生登出（token 从有→无）
    setAccessToken(null);
    resolveFetch(new Response(JSON.stringify({ protocol: "openai" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(pending).rejects.toThrow("会话已变更");
  });

  it("请求发起时已认证、返回时仍认证 → 正常返回", async () => {
    setAccessToken("tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ protocol: "anthropic" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))),
    );

    const data = await getLLMSettings();
    expect(data.protocol).toBe("anthropic");
  });

  it("未登录用户（无 token）的请求不受登出检查影响", async () => {
    // 默认未认证；401 且未认证 → wasAuthed=false，不抛"会话已变更"，报的是 readErrorDetail 原文
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: "no session" }), { status: 401 }))),
    );
    await expect(getLLMSettings()).rejects.toThrow("no session");
  });
});
