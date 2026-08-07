import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { LandingPage } from "../../src/features/landing/LandingPage";

const authState = vi.hoisted(() => ({
  user: null as { id: number; username: string } | null,
  isAuthenticated: false,
}));

vi.mock("../../src/stores/authStore", () => ({
  useAuth: () => authState,
}));

vi.mock("../../src/features/auth/LoginDialog", () => ({
  LoginDialog: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: (user: { id: number; username: string }) => void;
  }) => open ? (
    <div role="dialog" aria-label="登录到 AI Blog">
      <button type="button" onClick={() => onSuccess?.({ id: 7, username: "alice" })}>
        模拟登录
      </button>
    </div>
  ) : null,
}));

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/u/:username" element={<div>个人博客首页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  beforeEach(() => {
    authState.user = null;
    authState.isAuthenticated = false;
  });

  it("在根路由渲染独立首页", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /把零散的想法/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "首页导航" })).toBeInTheDocument();
  });

  it("未登录点击工作台入口时显示登录框，登录后进入个人博客", async () => {
    const user = userEvent.setup();
    renderLanding();

    const entry = screen.getByRole("link", { name: "打开工作台" });
    expect(entry).toHaveAttribute("href", "/");

    await user.click(entry);
    expect(screen.getByRole("dialog", { name: "登录到 AI Blog" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "模拟登录" }));
    expect(screen.getByText("个人博客首页")).toBeInTheDocument();
  });

  it("已登录时所有创作入口都指向当前用户的个人博客", async () => {
    authState.user = { id: 7, username: "alice" };
    authState.isAuthenticated = true;
    const user = userEvent.setup();
    renderLanding();

    const entryNames = ["打开工作台", "进入创作空间", "打开 AI Blog"];
    for (const name of entryNames) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/u/alice");
    }

    await user.click(screen.getByRole("link", { name: "进入创作空间" }));
    expect(screen.getByText("个人博客首页")).toBeInTheDocument();
  });
});
