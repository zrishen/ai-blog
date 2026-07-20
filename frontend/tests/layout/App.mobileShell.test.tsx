import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  state: {
    aiSidebarOpen: true,
    mcpModalOpen: false,
    blogCurrentPostId: null,
    blogPosts: [],
    researchCurrentTopic: null,
  },
  dispatch: vi.fn(),
  setLayout: vi.fn(),
}));

vi.mock("../../src/stores/chatStore", () => ({
  useChatState: () => mocks.state,
  useChatDispatch: () => mocks.dispatch,
}));

vi.mock("../../src/stores/authStore", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 1, username: "alice" } }),
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
vi.mock("../../src/features/file/FileLibraryPage", () => ({
  FileLibraryPage: () => <div>文件库主内容</div>,
}));
vi.mock("../../src/features/research/ResearchGraphPage", () => ({
  ResearchGraphPage: () => <div>研究图谱主内容</div>,
}));
vi.mock("../../src/features/ai-chat/components/MCPModal", () => ({
  MCPModal: () => <div>MCP</div>,
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

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/files"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App 手机端工作台外壳", () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.setLayout.mockClear();
    mocks.state.aiSidebarOpen = true;
    installMatchMedia(true);
  });

  it("手机端只渲染单栏主内容，不挂载桌面 PanelGroup", () => {
    renderApp();

    expect(screen.getByText("文件库主内容")).toBeInTheDocument();
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
    expect(screen.queryByRole("dialog", { name: "工作区导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "AI 助手" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭 AI 助手" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "AI 助手" })).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe("");
      expect(aiTrigger).toHaveFocus();
    });
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
