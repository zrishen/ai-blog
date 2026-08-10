import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// mock global.fetch —— apiFetch 直接调用 fetch，返回 Response 子集即可
function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const overviewBody = {
  total_users: 1234,
  active_subscriptions: 7,
  codes_total: 10,
  codes_used: 5,
  this_week_tokens: 25_000_000,
  registration_invite_code: "invite-2026",
};

import { OverviewPage } from "@/features/admin/components/OverviewPage";

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("smoke: 渲染标题、4 张 KPI 卡与全站本周累计用量", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(overviewBody));

    render(<OverviewPage />);

    expect(await screen.findByRole("heading", { name: "概览" })).toBeTruthy();

    expect(await screen.findByText("1,234")).toBeTruthy(); // 用户总数
    expect(await screen.findByText("7")).toBeTruthy(); // 活跃订阅
    expect(await screen.findByText("5 / 10")).toBeTruthy(); // 兑换码 已用/共
    // 本周 token 仅在顶部 KPI 中展示
    expect(await screen.findByText("25.0M")).toBeTruthy();
    expect(screen.queryByText("全站本周用量")).toBeNull();
    expect(await screen.findByText("invite-2026")).toBeTruthy();
    expect(screen.getByText("注册开放")).toBeTruthy();

  });

  it("请求失败时展示错误卡片与重试按钮，点击重试重新请求", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse({ detail: "boom" }, false, 500))
      .mockResolvedValueOnce(mockResponse(overviewBody));

    render(<OverviewPage />);

    const retryBtn = await screen.findByRole("button", { name: /重试/ });
    expect(screen.getByText(/boom/)).toBeTruthy();

    fireEvent.click(retryBtn);
    expect(await screen.findByText("1,234")).toBeTruthy();

    // 两次 fetch 调用（初次 + 重试）
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loading 阶段渲染骨架卡片且不展示数据", async () => {
    // 永不 resolve，停在 loading 态
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => {}));

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "概览" })).toBeTruthy();
    });
    expect(screen.queryByText("1,234")).toBeNull();
  });

  it("邀请码未配置时显示注册关闭", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ ...overviewBody, registration_invite_code: null }),
    );

    render(<OverviewPage />);

    expect(await screen.findByText("注册关闭")).toBeTruthy();
    expect(screen.getByText("当前未配置邀请码，新用户暂时无法注册。")).toBeTruthy();
  });
});
