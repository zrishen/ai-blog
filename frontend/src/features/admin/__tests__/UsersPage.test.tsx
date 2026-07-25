import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { UsersPage } from "../components/UsersPage";

const authState = vi.hoisted(() => ({ isSuperAdmin: false }));

vi.mock("@/stores/authStore", () => ({
  useAuth: () => ({
    user: {
      id: 99,
      username: "operator",
      is_admin: true,
      is_super_admin: authState.isSuperAdmin,
    },
  }),
}));

// ---- helpers ----

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

// radix Dialog 在 jsdom 中需要的最小 polyfill（仅在当前测试文件生效）。
function applyRadixPolyfills() {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
}

describe("UsersPage", () => {
  beforeEach(() => {
    applyRadixPolyfills();
    authState.isSuperAdmin = false;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("smoke: 渲染用户列表并展示关键数据（管理员徽标 / 分页计数）", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/admin/users") && !url.includes("subscription")) {
        return jsonResponse({
          items: [
            {
              id: 1,
              username: "alice",
              is_admin: true,
              is_super_admin: false,
              subscription_expires_at: "2099-01-01T00:00:00Z",
              created_at: "2024-01-01T00:00:00Z",
            },
            {
              id: 2,
              username: "bob",
              is_admin: false,
              is_super_admin: false,
              subscription_expires_at: null,
              created_at: null,
            },
          ],
          total: 2,
          offset: 0,
          limit: 20,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UsersPage />);

    // 关键用户名展示
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    // 管理员徽标
    expect(screen.getByText("管理员")).toBeInTheDocument();
    // 未订阅用户展示占位符
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // 分页计数：第 1-2 条 / 共 2 条
    expect(screen.getByText("第 1-2 条 / 共 2 条")).toBeInTheDocument();
    // 首页时“上一页”禁用
    expect(screen.getByRole("button", { name: /上一页/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /下一页/ })).toBeDisabled();
  });

  it("延期订阅：打开对话框 → 确认 → 调用 grant 并展示内联成功提示", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/subscription/grant")) {
        calls.push(`GRANT:${init?.method ?? "GET"}`);
        return jsonResponse({ subscription_expires_at: "2099-12-31T00:00:00Z" });
      }
      if (url.includes("/admin/users")) {
        calls.push("LIST");
        return jsonResponse({
          items: [
            {
              id: 1,
              username: "alice",
              is_admin: true,
              is_super_admin: false,
              subscription_expires_at: "2099-01-01T00:00:00Z",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          total: 1,
          offset: 0,
          limit: 20,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UsersPage />);
    await screen.findByText("alice");

    // 打开延期对话框
    fireEvent.click(screen.getByRole("button", { name: "延期订阅" }));
    // 对话框标题（heading）出现
    expect(
      await screen.findByRole("heading", { name: "延期订阅" }),
    ).toBeInTheDocument();
    // 确认按钮
    fireEvent.click(screen.getByRole("button", { name: "确认延期" }));

    // grant 被调用
    await waitFor(() => {
      expect(calls.some((c) => c.startsWith("GRANT:POST"))).toBe(true);
    });
    // 内联成功提示
    expect(await screen.findByText(/已为 alice 延期至/)).toBeInTheDocument();
  });

  it("延期订阅失败时在对话框内展示错误，且不关闭对话框", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/subscription/grant")) {
        return jsonResponse({ detail: "余额不足" }, false, 400);
      }
      return jsonResponse({
        items: [
          {
            id: 1,
            username: "alice",
            is_admin: false,
            is_super_admin: false,
            subscription_expires_at: null,
            created_at: null,
          },
        ],
        total: 1,
        offset: 0,
        limit: 20,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UsersPage />);
    await screen.findByText("alice");

    fireEvent.click(screen.getByRole("button", { name: "延期订阅" }));
    await screen.findByRole("heading", { name: "延期订阅" });
    fireEvent.click(screen.getByRole("button", { name: "确认延期" }));

    // 对话框内展示错误文案
    expect(await screen.findByText("余额不足")).toBeInTheDocument();
    // 对话框仍在（标题仍可见）
    expect(screen.getByRole("heading", { name: "延期订阅" })).toBeInTheDocument();
  });

  it("仅超级管理员可见管理员授权操作，且超级管理员显示独立角色徽标", async () => {
    authState.isSuperAdmin = true;
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      items: [
        {
          id: 1,
          username: "root",
          is_admin: true,
          is_super_admin: true,
          subscription_expires_at: null,
          created_at: null,
        },
        {
          id: 2,
          username: "member",
          is_admin: false,
          is_super_admin: false,
          subscription_expires_at: null,
          created_at: null,
        },
      ],
      total: 2,
      offset: 0,
      limit: 20,
    })));

    render(<UsersPage />);

    expect(await screen.findByText("超级管理员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为管理员" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤销管理员" })).toBeNull();
  });
});
