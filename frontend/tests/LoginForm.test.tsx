import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../src/stores/authStore";
import { LoginForm } from "../src/features/auth/LoginForm";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  // LoginForm 的 label 没有 htmlFor 关联，直接用 input 类型查询
  const usernameInput = screen.getByRole("textbox");
  const passwordInput = document.querySelector('input[type="password"]')!;
  await user.type(usernameInput, "alice");
  await user.type(passwordInput, "secret");
  // 顶部 mode 切换 + 表单提交都叫"登录"，按 type=submit 精确选中
  const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  await user.click(submitBtn);
}

describe("LoginForm", () => {
  it("登录成功：调用 login 写入 token，并回调 onSuccess", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "tok", user: { id: 7, username: "alice" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />, { wrapper });

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: 7, username: "alice" });
    });
    expect(localStorage.getItem("auth_token")).toBe("tok");
  });

  it("登录失败（HTTP 400 + detail）：显示后端错误信息", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "用户名或密码错误" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<LoginForm />, { wrapper });
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("用户名或密码错误")).toBeInTheDocument();
    });
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("网络错误：显示网络错误提示", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("net"));

    render(<LoginForm />, { wrapper });
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText(/网络错误/)).toBeInTheDocument();
    });
  });

  it("切换到注册模式时调用 /register 端点", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "t", user: { id: 1, username: "x" } }), {
        status: 200,
      }),
    );

    render(<LoginForm />, { wrapper });
    await user.click(screen.getByRole("button", { name: "注册" }));
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("提交期间按钮 disabled 且显示处理中文案", async () => {
    const user = userEvent.setup();
    // 让 fetch 永远 pending，确保按钮停在 loading 态
    fetchMock.mockReturnValueOnce(new Promise(() => {}));

    render(<LoginForm />, { wrapper });
    await fillAndSubmit(user);

    await waitFor(() => {
      const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(btn).toBeDisabled();
      expect(btn.textContent).toMatch(/处理中/);
    });
  });
});
