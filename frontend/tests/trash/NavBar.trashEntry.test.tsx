import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

// 阻止 NavBar 在挂载时拉取 LLM 设置
vi.mock("../../src/api/client", () => ({
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => null),
  parseJson: (res: Response) => res.json(),
}));

vi.mock("../../src/api/auth", () => ({
  getLLMSettings: vi.fn(() => Promise.resolve({ protocol: "openai", base_url: "", api_key: "", model: "", supports_thinking: true })),
  updateLLMSettings: vi.fn(),
}));

import { AuthProvider } from "../../src/stores/authStore";
import { ChatProvider } from "../../src/stores/chatStore";
import { FileProcessingProvider } from "../../src/features/workspace/providers/FileProcessingProvider";
import { NavBar } from "../../src/components/NavBar";

async function renderNav(authed = true) {
  if (authed) {
    localStorage.setItem("auth_token", "t");
    localStorage.setItem("auth_user", JSON.stringify({ id: 1, username: "alice" }));
  }
  const utils = render(
    <MemoryRouter>
      <AuthProvider>
        <ChatProvider>
          <FileProcessingProvider>
            <NavBar />
          </FileProcessingProvider>
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return utils;
}

describe("NavBar 回收站入口", () => {
  beforeEach(() => {
    localStorage.clear();
    // AuthProvider 挂载用 cookie 调 /auth/refresh 恢复登录态；模拟已登录 alice
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "a", user: { id: 1, username: "alice", is_admin: false, is_super_admin: false } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: 200 }),
    ));
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("登录后用户菜单包含「回收站」项,位于「设置」与「登出」之间", async () => {
    const user = userEvent.setup();
    await renderNav(true);
    const trigger = await screen.findByTitle("alice");
    await user.click(trigger);
    const settingsItem = await screen.findByText("设置");
    const trashItem = await screen.findByText("回收站");
    const logoutItem = await screen.findByText("登出");
    expect(settingsItem).toBeInTheDocument();
    expect(trashItem).toBeInTheDocument();
    expect(logoutItem).toBeInTheDocument();
    const all = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const iSettings = all.findIndex((el) => el.textContent?.includes("设置"));
    const iTrash = all.findIndex((el) => el.textContent?.includes("回收站"));
    const iLogout = all.findIndex((el) => el.textContent?.includes("登出"));
    expect(iSettings).toBeGreaterThanOrEqual(0);
    expect(iTrash).toBeGreaterThan(iSettings);
    expect(iLogout).toBeGreaterThan(iTrash);
  });

  it("点击「回收站」菜单项跳转到工作区回收站", async () => {
    const user = userEvent.setup();
    let currentPath = "";
    const Probe = () => {
      currentPath = useLocation().pathname;
      return null;
    };
    localStorage.setItem("auth_token", "t");
    localStorage.setItem("auth_user", JSON.stringify({ id: 1, username: "alice" }));
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatProvider>
            <FileProcessingProvider>
              <NavBar />
              <Probe />
            </FileProcessingProvider>
          </ChatProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    const trigger = await screen.findByTitle("alice");
    await user.click(trigger);
    const trashItem = await screen.findByText("回收站");
    await user.click(trashItem);
    await waitFor(() => expect(currentPath).toBe("/workspace"));
  });
});

