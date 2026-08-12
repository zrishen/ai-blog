import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { UsagePage } from "@/features/admin/components/UsagePage";

// 构造一个最小 Response-like 对象，满足 apiFetch 对 ok/status/json/text 的调用。
function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => "",
  };
}

describe("UsagePage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("加载用户列表，选中后展示订阅状态与用量进度", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/admin/users")) {
        return mockResponse({
          items: [
            {
              id: 1,
              username: "alice",
              is_admin: false,
              subscription_expires_at: null,
              created_at: null,
            },
            {
              id: 2,
              username: "bob",
              is_admin: false,
              subscription_expires_at: null,
              created_at: null,
            },
          ],
          total: 2,
          offset: 0,
          limit: 50,
        });
      }
      if (url.includes("/admin/usage/user/1")) {
        return mockResponse({
          user_id: 1,
          username: "alice",
          active: true,
          period: "2026-W30",
          used: 50_000_000,
          limit: 100_000_000,
          remaining: 50_000_000,
        });
      }
      return mockResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UsagePage />);

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();

    fireEvent.click(screen.getByText("alice"));

    await waitFor(() => {
      expect(screen.getByText("订阅生效")).toBeInTheDocument();
    });
    expect(screen.getByText("2026-W30")).toBeInTheDocument();
    expect(screen.getByText("50.0M")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();

    // 用户列表请求只发了一次（limit=50）
    const usersCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/admin/users"),
    );
    expect(usersCalls.length).toBe(1);
  });

  it("未选中用户时右侧显示空态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        mockResponse({ items: [], total: 0, offset: 0, limit: 50 }),
      ),
    );

    render(<UsagePage />);
    expect(await screen.findByText("请从左侧选择用户")).toBeInTheDocument();
  });

  it("用户列表加载失败时展示错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => mockResponse({ detail: "读取用户列表失败" }, false)),
    );

    render(<UsagePage />);
    expect(await screen.findByText("读取用户列表失败")).toBeInTheDocument();
  });
});
