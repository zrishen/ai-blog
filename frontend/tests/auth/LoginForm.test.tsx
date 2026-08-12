import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthProvider } from "../../src/stores/authStore";
import { getAccessToken, setAccessToken } from "../../src/api/client";
import { LoginForm } from "../../src/features/auth/LoginForm";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAccessToken(null);
  fetchMock = vi.fn(async (url: string) => {
    // AuthProvider 挂载会调 /auth/refresh 恢复登录态；测试默认未登录
    if (typeof url === "string" && url.includes("/auth/refresh")) {
      return new Response(JSON.stringify({ detail: "no session" }), { status: 401 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, inviteCode?: string) {
  const usernameInput = screen.getByLabelText("用户名");
  const passwordInput = screen.getByLabelText("密码");
  await user.type(usernameInput, "alice");
  await user.type(passwordInput, "secret");
  if (inviteCode) {
    await user.type(screen.getByLabelText("邀请码"), inviteCode);
  }
  // 顶部 mode 切换 + 表单提交都叫"登录"，按 type=submit 精确选中
  const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  await user.click(submitBtn);
}

function loginResponse() {
  return new Response(JSON.stringify({ access_token: "tok", user: { id: 7, username: "alice", is_admin: false, is_super_admin: false } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LoginForm", () => {
  it("登录成功：写入 access holder 并回调 onSuccess", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response("{}", { status: 401 })
        : loginResponse(),
    );

    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />, { wrapper });

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: 7, username: "alice", is_admin: false, is_super_admin: false });
    });
    await waitFor(() => expect(getAccessToken()).toBe("tok"));
  });

  it("登录失败（HTTP 400 + detail）：显示后端错误信息", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ detail: "用户名或密码错误" }), { status: 400 }),
    );

    render(<LoginForm />, { wrapper });
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("用户名或密码错误")).toBeInTheDocument();
    });
    expect(getAccessToken()).toBeNull();
  });

  it("网络错误：显示网络错误提示", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/auth/refresh")) {
        return new Response("{}", { status: 401 });
      }
      throw new Error("net");
    });

    render(<LoginForm />, { wrapper });
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText(/网络错误/)).toBeInTheDocument();
    });
  });

  it("切换到注册模式时调用 /register 端点", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response("{}", { status: 401 })
        : loginResponse(),
    );

    render(<LoginForm />, { wrapper });
    await user.click(screen.getByRole("tab", { name: "注册" }));
    await fillAndSubmit(user, "invite-123");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ username: "alice", password: "secret", invite_code: "invite-123" }),
        }),
      );
    });
  });

  it("提交期间按钮 disabled 且显示处理中文案", async () => {
    const user = userEvent.setup();
    // login 请求永远 pending，确保按钮停在 loading 态（refresh 仍返回 401 完成）
    fetchMock.mockImplementation(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response("{}", { status: 401 })
        : new Promise(() => {}),
    );

    render(<LoginForm />, { wrapper });
    await fillAndSubmit(user);

    await waitFor(() => {
      const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(btn).toBeDisabled();
      expect(btn.textContent).toMatch(/处理中/);
    });
  });
});
