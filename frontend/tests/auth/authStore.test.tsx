import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../src/stores/authStore";
import { getAccessToken, setAccessToken } from "../../src/api/client";

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function refreshResponse(status = 401, body: unknown = { detail: "no session" }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  setAccessToken(null);
  // AuthProvider 挂载即用 cookie 调 /auth/refresh 恢复登录态；默认模拟未登录
  vi.stubGlobal("fetch", vi.fn(async () => refreshResponse(401)));
});

describe("authStore", () => {
  it("初始未登录，恢复完成后 isInitializing 置 false", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    await waitFor(() => expect(result.current.isInitializing).toBe(false));
  });

  it("login 写入内存 access holder 并切换状态，不写 localStorage", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    act(() => {
      result.current.login("access-1", { id: 7, username: "alice" });
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ id: 7, username: "alice" });
    expect(getAccessToken()).toBe("access-1");
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("logout 调后端并清空状态与 access holder", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/logout")
        ? new Response("{}", { status: 200 })
        : refreshResponse(401),
    );
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    act(() => result.current.login("access-1", { id: 7, username: "alice" }));
    act(() => result.current.logout());
    expect(result.current.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" })),
    );
  });

  it("通过 refresh cookie 恢复会话", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      refreshResponse(200, { access_token: "restored", user: { id: 1, username: "bob" } }),
    ));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.user?.username).toBe("bob");
    expect(getAccessToken()).toBe("restored");
  });

  it("auth:logout 事件清空登录态", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isInitializing).toBe(false));
    act(() => result.current.login("access-1", { id: 7, username: "alice" }));
    act(() => window.dispatchEvent(new Event("auth:logout")));
    expect(result.current.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
  });
});
