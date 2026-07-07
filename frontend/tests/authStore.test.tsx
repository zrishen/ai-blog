import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AuthProvider, useAuth } from "../src/stores/authStore";

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  localStorage.clear();
});

describe("authStore", () => {
  it("初始状态：未登录", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("login 写入 localStorage 并切换状态", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      result.current.login("tok-123", { id: 7, username: "alice" });
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ id: 7, username: "alice" });
    expect(result.current.token).toBe("tok-123");
    expect(localStorage.getItem("auth_token")).toBe("tok-123");
    expect(JSON.parse(localStorage.getItem("auth_user") || "{}")).toEqual({ id: 7, username: "alice" });
  });

  it("logout 清空状态与 localStorage", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      result.current.login("tok-123", { id: 7, username: "alice" });
    });
    act(() => {
      result.current.logout();
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
  });

  it("从 localStorage 恢复会话", () => {
    localStorage.setItem("auth_token", "persisted");
    localStorage.setItem("auth_user", JSON.stringify({ id: 1, username: "bob" }));
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.username).toBe("bob");
  });

  it("损坏的 auth_user 不会抛错并清空", () => {
    localStorage.setItem("auth_token", "x");
    localStorage.setItem("auth_user", "{not json");
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem("auth_token")).toBeNull();
  });
});
