import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthProvider } from "../../src/stores/authStore";
import { LoginDialog } from "../../src/features/auth/LoginDialog";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) =>
    // AuthProvider 挂载会调 /auth/refresh 恢复登录态；默认未登录
    typeof url === "string" && url.includes("/auth/refresh")
      ? new Response("{}", { status: 401 })
      : new Response("{}", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

function mockLoginSuccess() {
  fetchMock.mockImplementation(async (url: string) =>
    typeof url === "string" && url.includes("/auth/refresh")
      ? new Response("{}", { status: 401 })
      : new Response(JSON.stringify({ access_token: "t", user: { id: 1, username: "alice", is_admin: false, is_super_admin: false } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
  );
}

async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
  const usernameInput = screen.getByRole("textbox");
  const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
  await user.type(usernameInput, "alice");
  await user.type(passwordInput, "secret");
  const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  await user.click(submitBtn);
}

describe("LoginDialog", () => {
  it("open=true 时渲染标题与描述", () => {
    render(
      <LoginDialog open={true} onOpenChange={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByText("登录到 AI Blog")).toBeInTheDocument();
    expect(screen.getByText(/输入你的用户名和密码/)).toBeInTheDocument();
  });

  it("open=false 时不渲染对话框内容", () => {
    render(
      <LoginDialog open={false} onOpenChange={vi.fn()} />,
      { wrapper },
    );
    expect(screen.queryByText("登录到 AI Blog")).toBeNull();
  });

  it("登录成功后调用 onOpenChange(false) 与 onSuccess", async () => {
    const user = userEvent.setup();
    mockLoginSuccess();
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    render(
      <LoginDialog open={true} onOpenChange={onOpenChange} onSuccess={onSuccess} />,
      { wrapper },
    );

    await submitLogin(user);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: 1, username: "alice", is_admin: false, is_super_admin: false });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports a light appearance inside fixed-light pages", () => {
    render(
      <LoginDialog open={true} onOpenChange={vi.fn()} appearance="light" />,
      { wrapper },
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("data-theme", "light");
  });
});
