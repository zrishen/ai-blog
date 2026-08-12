import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  state: {
    aiSidebarOpen: true,
    pluginCenterOpen: false,
    currentPage: "workspace",
    blogCurrentPostId: null,
    blogPosts: [],
  },
  dispatch: vi.fn(),
  setLayout: vi.fn(),
  auth: {
    isAuthenticated: true,
    isInitializing: false,
    user: { id: 1, username: "alice", is_admin: false, is_super_admin: false },
  },
}));

vi.mock("../../src/stores/chatStore", () => ({
  useChatState: () => mocks.state,
  useChatDispatch: () => mocks.dispatch,
}));

vi.mock("../../src/stores/authStore", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("../../src/components/NavBar", () => ({
  NavBar: ({
    onOpenNavigation,
    onOpenAI,
    navigationButtonRef,
    aiButtonRef,
  }: {
    onOpenNavigation?: () => void;
    onOpenAI?: () => void;
    navigationButtonRef?: React.Ref<HTMLButtonElement>;
    aiButtonRef?: React.Ref<HTMLButtonElement>;
  }) => (
    <nav>
      {onOpenNavigation && <button ref={navigationButtonRef} onClick={onOpenNavigation}>打开工作区导航</button>}
      {onOpenAI && <button ref={aiButtonRef} onClick={onOpenAI}>打开 AI 助手</button>}
    </nav>
  ),
}));

vi.mock("../../src/components/LeftSidebar", () => ({
  LeftSidebar: () => <div>左侧业务面板</div>,
}));

vi.mock("../../src/features/ai-chat/AISidebar", () => ({
  AISidebar: ({ onRequestClose }: { onRequestClose?: () => void }) => (
    <div>
      AI 助手内容
      {onRequestClose && <button onClick={onRequestClose}>关闭 AI 助手</button>}
    </div>
  ),
}));

vi.mock("../../src/features/blog/components/SiteBlogRoute", () => ({
  SiteBlogRoute: () => <div>博客主页</div>,
}));
vi.mock("../../src/features/blog/components/SitePostRoute", () => ({
  SitePostRoute: () => <div>文章页面</div>,
}));
vi.mock("../../src/features/landing/LandingPage", () => ({
  LandingPage: () => <div>落地页</div>,
}));
vi.mock("../../src/features/workspace/WorkspacePage", () => ({
  WorkspacePage: () => <div>工作区主内容</div>,
}));
vi.mock("../../src/features/plugins/PluginCenterDialog", () => ({
  PluginCenterDialog: () => <div>Plugins</div>,
}));
vi.mock("../../src/features/admin/components/OverviewPage", () => ({
  OverviewPage: () => <div>管理员概览</div>,
}));
vi.mock("../../src/features/admin/components/UsersPage", () => ({
  UsersPage: () => <div>管理员用户</div>,
}));
vi.mock("../../src/features/admin/components/CodesPage", () => ({
  CodesPage: () => <div>管理员兑换码</div>,
}));
vi.mock("../../src/features/admin/components/UsagePage", () => ({
  UsagePage: () => <div>管理员用量</div>,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="desktop-panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Separator: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useGroupCallbackRef: () => [
    { getLayout: vi.fn(), setLayout: mocks.setLayout },
    vi.fn(),
  ],
}));

import App from "../../src/App";

type MediaListener = (event: MediaQueryListEvent) => void;
let mediaMatches = false;
let mediaListeners = new Set<MediaListener>();

function installMatchMedia(matches: boolean) {
  mediaMatches = matches;
  mediaListeners = new Set();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: mediaMatches,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: MediaListener) => mediaListeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function setMediaMatches(matches: boolean) {
  mediaMatches = matches;
  const event = { matches, media: "(max-width: 767px)" } as MediaQueryListEvent;
  mediaListeners.forEach((listener) => listener(event));
}

function renderApp(route = "/workspace") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App 手机端工作台外壳", () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.setLayout.mockClear();
    mocks.state.aiSidebarOpen = true;
    mocks.auth = {
      isAuthenticated: true,
      isInitializing: false,
      user: { id: 1, username: "alice", is_admin: false, is_super_admin: false },
    };
    installMatchMedia(true);
  });

  it("恢复管理员会话期间保留当前管理页 URL", async () => {
    installMatchMedia(false);
    mocks.auth = { isAuthenticated: false, isInitializing: true, user: null };
    const view = renderApp("/admin");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("落地页")).not.toBeInTheDocument();

    mocks.auth = {
      isAuthenticated: true,
      isInitializing: false,
      user: { id: 1, username: "admin", is_admin: true, is_super_admin: false },
    };
    view.rerender(
      <MemoryRouter initialEntries={["/admin"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("管理员概览")).toBeInTheDocument();
  });

  it("手机端只渲染单栏主内容，不挂载桌面 PanelGroup", () => {
    renderApp();

    expect(screen.getByText("工作区主内容")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-panel-group")).not.toBeInTheDocument();
    expect(mocks.setLayout).not.toHaveBeenCalled();
  });

  it("左右抽屉互斥，关闭后恢复触发按钮焦点和页面滚动", async () => {
    const user = userEvent.setup();
    renderApp();

    const navigationTrigger = screen.getByRole("button", { name: "打开工作区导航" });
    await user.click(navigationTrigger);
    expect(screen.getByRole("dialog", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByText("左侧业务面板")).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");

    const aiTrigger = screen.getByRole("button", { name: "打开 AI 助手" });
    await user.click(aiTrigger);
    // 导航抽屉因 AnimatePresence 的滑出动画（exit）会短暂保留在 DOM，等其卸载后再断言互斥。
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "工作区导航" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "AI 助手" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭 AI 助手" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "AI 助手" })).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe("");
      expect(aiTrigger).toHaveFocus();
    });
  });

  it("未登录时移动导航仍提供创作入口，而不是空白抽屉", async () => {
    const user = userEvent.setup();
    mocks.auth = { isAuthenticated: false, isInitializing: false, user: null };
    renderApp();

    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));

    expect(screen.getByRole("navigation", { name: "工作区主导航" })).toBeVisible();
    expect(screen.getByRole("button", { name: "创作" })).toBeVisible();
    expect(screen.queryByText("左侧业务面板")).not.toBeInTheDocument();
  });

  it("按 Escape 关闭当前抽屉", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "工作区导航" })).not.toBeInTheDocument();
    });
  });

  it("跨越断点后恢复桌面三栏，不把手机抽屉状态写入桌面布局", async () => {
    renderApp();
    expect(mocks.setLayout).not.toHaveBeenCalled();

    act(() => setMediaMatches(false));

    expect(await screen.findByTestId("desktop-panel-group")).toBeInTheDocument();
    await waitFor(() => expect(mocks.setLayout).toHaveBeenCalledTimes(1));
  });
});
