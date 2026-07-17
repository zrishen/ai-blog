import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../src/stores/authStore";
import { ChatProvider, useChat } from "../../src/stores/chatStore";
import { AISidebar } from "../../src/features/ai-chat/AISidebar";
import {
  DEFAULT_AI_SIDEBAR_THINKING_MODE,
  getAISidebarThinkingModeStorageKey,
  loadAISidebarThinkingMode,
  saveAISidebarThinkingMode,
} from "../../src/features/ai-chat/ai-sidebar/constants";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI 侧栏思考模式偏好", () => {
  it("没有保存值时使用平衡模式", () => {
    expect(loadAISidebarThinkingMode(7)).toBe(DEFAULT_AI_SIDEBAR_THINKING_MODE);
  });

  it.each(["fast", "balanced", "smart"] as const)("可以恢复 %s 模式", (mode) => {
    localStorage.setItem(getAISidebarThinkingModeStorageKey(7), mode);
    expect(loadAISidebarThinkingMode(7)).toBe(mode);
  });

  it("非法保存值安全回退为平衡模式", () => {
    localStorage.setItem(getAISidebarThinkingModeStorageKey(7), "unknown");
    expect(loadAISidebarThinkingMode(7)).toBe(DEFAULT_AI_SIDEBAR_THINKING_MODE);
  });

  it("按用户分别保存选择", () => {
    saveAISidebarThinkingMode(7, "fast");
    saveAISidebarThinkingMode(8, "smart");

    expect(loadAISidebarThinkingMode(7)).toBe("fast");
    expect(loadAISidebarThinkingMode(8)).toBe("smart");
  });

  it("刷新后按当前登录用户恢复模式", async () => {
    localStorage.setItem("auth_token", "persisted");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, username: "alice" }));
    saveAISidebarThinkingMode(7, "fast");
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "a", user: { id: 7, username: "alice" } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({ conversations: [] }), {
            status: 200, headers: { "Content-Type": "application/json" },
          }),
    ));

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatProvider>
            <AISidebar mode="private" />
          </ChatProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "快速" })).toBeInTheDocument());
    expect(loadAISidebarThinkingMode(7)).toBe("fast");
  });

  it("用户切换模式时立即保存", async () => {
    const user = userEvent.setup();
    localStorage.setItem("auth_token", "persisted");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, username: "alice" }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "a", user: { id: 7, username: "alice" } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({ conversations: [] }), {
            status: 200, headers: { "Content-Type": "application/json" },
          }),
    ));

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatProvider>
            <AISidebar mode="private" />
          </ChatProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "平衡" }));
    await user.click(await screen.findByText("快速", { selector: '[role="menuitem"] *' }));

    expect(await screen.findByRole("button", { name: "快速" })).toBeInTheDocument();
    expect(loadAISidebarThinkingMode(7)).toBe("fast");
  });

  it("登出重置内存模式但保留用户偏好", () => {
    saveAISidebarThinkingMode(7, "smart");
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({ type: "SET_AI_SIDEBAR_THINKING_MODE", payload: "smart" });
    });
    expect(result.current.state.aiSidebarThinkingMode).toBe("smart");

    act(() => {
      result.current.dispatch({ type: "LOGOUT" });
    });

    expect(result.current.state.aiSidebarThinkingMode).toBe("balanced");
    expect(loadAISidebarThinkingMode(7)).toBe("smart");
  });
});
