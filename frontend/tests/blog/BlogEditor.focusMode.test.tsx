import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import "@testing-library/jest-dom/vitest";
import { AuthProvider } from "../../src/stores/authStore";
import { BlogEditor } from "../../src/features/blog/components/BlogEditor";

class MockResizeObserver {
  observe = () => {};
  disconnect = () => {};
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

vi.mock("vditor", () => ({
  default: class MockVditor {
    vditor = {
      toolbar: { elements: {} },
      currentMode: "wysiwyg",
    };

    constructor(el: string | HTMLElement, opts?: { after?: () => void }) {
      const container = typeof el === "string" ? document.getElementById(el) : el;
      if (container) {
        container.innerHTML = '<div class="vditor"><div class="vditor-toolbar"><button class="vditor-toolbar__item" data-type="edit-mode">edit-mode</button></div><div class="vditor-content"></div></div>';
      }
      queueMicrotask(() => opts?.after?.());
    }
    getValue = () => "";
    setValue = (_v: string) => {};
    destroy = () => {};
    getHTML = () => "";
    insertValue = (_v: string, _pos?: boolean) => {};
    setTheme = (_theme: string, _contentTheme?: string, _codeTheme?: string) => {};
  },
}));

vi.mock("vditor/dist/index.css", () => ({}));
vi.mock("vditor/dist/js/i18n/zh_CN", () => ({}));

vi.mock("../../src/api/blog", () => ({
  createBlogPost: vi.fn(() => Promise.resolve({ id: 1 })),
  updateBlogPost: vi.fn(() => Promise.resolve({ id: 1 })),
  getBlogPost: vi.fn(() => Promise.resolve(null)),
  listBlogPosts: vi.fn(() => Promise.resolve([])),
  generateBlogCover: vi.fn(() => Promise.resolve("")),
  suggestBlogTags: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../src/api/chat", () => ({
  uploadFile: vi.fn(() => Promise.resolve("")),
}));

describe("BlogEditor 工具区折叠/展开", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    // AuthProvider 挂载会调 /auth/refresh 恢复登录态；focusMode 测试不依赖登录用户，模拟未登录快速完成
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认折叠态：紧凑行可见，大卡片内容隐藏", async () => {
    const result = render(
      <MemoryRouter>
        <AuthProvider>
          <BlogEditor />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await result.findByPlaceholderText("输入文章标题...", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(result.queryByText("历史")).toBeInTheDocument();
    expect(result.queryByText("发布")).toBeInTheDocument();
    expect(result.queryByText("文章封面")).toBeNull();

    result.unmount();
  });

  it("工具栏 toggle 按钮在折叠态显示 Maximize 图标且提示展开", async () => {
    const result = render(
      <MemoryRouter>
        <AuthProvider>
          <BlogEditor />
        </AuthProvider>
      </MemoryRouter>,
    );

    const toggleBtn = await result.findByLabelText("展开文章设置", {}, { timeout: 5000 });
    expect(toggleBtn).toBeInTheDocument();

    result.unmount();
  });

  it("点击 toggle 后展开顶部完整卡片，再次点击收缩回去", async () => {
    const result = render(
      <MemoryRouter>
        <AuthProvider>
          <BlogEditor />
        </AuthProvider>
      </MemoryRouter>,
    );

    const toggleBtn = await result.findByLabelText("展开文章设置", {}, { timeout: 5000 });
    fireEvent.click(toggleBtn);

    expect(await result.findByText("文章封面", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(result.queryByLabelText("展开文章设置")).toBeNull();
    const collapseBtn = await result.findByLabelText("收缩文章设置", {}, { timeout: 5000 });
    expect(collapseBtn).toBeInTheDocument();

    fireEvent.click(collapseBtn);
    expect(await result.findByLabelText("展开文章设置", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(result.queryByText("文章封面")).toBeNull();

    result.unmount();
  });

  it("toggle 支持折叠↔展开多次往返切换", async () => {
    const result = render(
      <MemoryRouter>
        <AuthProvider>
          <BlogEditor />
        </AuthProvider>
      </MemoryRouter>,
    );

    for (let i = 0; i < 3; i++) {
      const expandBtn = await result.findByLabelText("展开文章设置", {}, { timeout: 5000 });
      fireEvent.click(expandBtn);
      expect(await result.findByText("文章封面", {}, { timeout: 5000 })).toBeInTheDocument();

      const collapseBtn = await result.findByLabelText("收缩文章设置", {}, { timeout: 5000 });
      fireEvent.click(collapseBtn);
      expect(result.queryByText("文章封面")).toBeNull();
    }

    result.unmount();
  });
});
