import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SubscriptionPanel } from "../components/SubscriptionPanel";

function mockResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => "",
  } as unknown as Response;
}

const ACTIVE_STATUS = {
  active: true,
  expires_at: "2099-01-01T00:00:00Z",
  period: "2026-W30",
  used: 30_000_000,
  limit: 100_000_000,
  remaining: 70_000_000,
};

describe("SubscriptionPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("展示订阅状态 + 周配额进度条关键数据", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(ACTIVE_STATUS));
    render(<SubscriptionPanel />);

    expect(await screen.findByText("订阅生效")).toBeTruthy();
    expect(screen.getByTestId("subscription-status-surface")).toHaveClass(
      "rounded-panel",
      "border-border/60",
      "bg-background/55",
    );
    // 用量 / 限额 / 剩余 / 周期
    expect(screen.getByText(/30.0M/)).toBeTruthy();
    expect(screen.getByText(/100.0M/)).toBeTruthy();
    expect(screen.getByText(/剩余 70.0M/)).toBeTruthy();
    expect(screen.getByText(/周期 2026-W30/)).toBeTruthy();
  });

  it("输入兑换码兑换成功后展示成功提示", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({ ...ACTIVE_STATUS, active: false, expires_at: null }),
      )
      .mockResolvedValueOnce(mockResponse(ACTIVE_STATUS));

    render(<SubscriptionPanel />);
    await screen.findByText("未订阅 / 已过期");

    fireEvent.change(screen.getByPlaceholderText("输入兑换码"), {
      target: { value: "CODE-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "兑换" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2); // status + redeem
    });
    expect(await screen.findByText(/兑换成功/)).toBeTruthy();
    expect(screen.getByRole("status")).toHaveClass("border-success/20", "bg-success/8");
  });

  it("额度接近上限时使用警示色而非错误色", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ ...ACTIVE_STATUS, used: 90_000_000, remaining: 10_000_000 }),
    );
    render(<SubscriptionPanel />);

    expect(await screen.findByText(/占比 90.0%/)).toHaveClass("text-warning-foreground");
  });
});
