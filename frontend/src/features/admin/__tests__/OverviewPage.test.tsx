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
};

import { OverviewPage } from "../components/OverviewPage";

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("smoke: 渲染标题、4 张 KPI 卡与本周用量进度条的关键数据", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(overviewBody));

    render(<OverviewPage />);

    // 标题
    expect(await screen.findByText("管理后台 · 概览")).toBeTruthy();

    // KPI 卡片
    expect(await screen.findByText("1,234")).toBeTruthy(); // 用户总数
    expect(await screen.findByText("7")).toBeTruthy(); // 活跃订阅
    expect(await screen.findByText("5 / 10")).toBeTruthy(); // 兑换码 已用/共
    // 本周 token KPI（值 25.0M 也出现在用量行"已用 25.0M"，用 findAllByText 容忍多匹配）
    expect((await screen.findAllByText("25.0M")).length).toBeGreaterThanOrEqual(1);

    // 本周用量进度条文案（"剩余"/"占比"仅出现于用量卡，唯一）
    expect(await screen.findByText(/剩余/)).toBeTruthy();
    expect(await screen.findByText(/占比 25.0%/)).toBeTruthy();

    // 接近上限警示此时不应出现（25%）
    expect(screen.queryByText(/接近上限/)).toBeNull();
  });

  it("接近上限(>80%)时显示警示色文案", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ ...overviewBody, this_week_tokens: 90_000_000 }),
    );

    render(<OverviewPage />);

    expect(await screen.findByText(/占比 90.0%/)).toBeTruthy();
    expect(await screen.findByText(/接近上限/)).toBeTruthy();
  });

  it("请求失败时展示错误卡片与重试按钮，点击重试重新请求", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse({ detail: "boom" }, false, 500))
      .mockResolvedValueOnce(mockResponse(overviewBody));

    render(<OverviewPage />);

    // 错误态：展示后端 detail 与重试按钮
    const retryBtn = await screen.findByRole("button", { name: /重试/ });
    expect(screen.getByText(/boom/)).toBeTruthy();

    // 点击重试 → 第二次成功，KPI 数据出现
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
      // 标题已渲染
      expect(screen.getByText("管理后台 · 概览")).toBeTruthy();
    });
    // 数据文案尚未出现
    expect(screen.queryByText("1,234")).toBeNull();
  });
});
