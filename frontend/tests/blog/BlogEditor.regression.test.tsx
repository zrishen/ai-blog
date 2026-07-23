import React, { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChatProvider, useChat } from "../../src/stores/chatStore";
import { AuthProvider } from "../../src/stores/authStore";
import { BlogEditor } from "../../src/features/blog/components/BlogEditor";

class MockResizeObserver {
  observe = () => {};
  disconnect = () => {};
}

let lastVditor: MockVditor | null = null;

class MockVditor {
  value: string;
  setValue = vi.fn((value: string) => {
    this.value = value;
    const reset = this.vditor.wysiwyg.element.querySelector<HTMLElement>(".vditor-reset");
    if (reset) reset.textContent = value;
  });
  destroy = vi.fn();
  getHTML = () => "";
  insertValue = () => {};
  setTheme = () => {};
  vditor: {
    element: HTMLElement;
    wysiwyg: { element: HTMLElement };
    toolbar: { elements: Record<string, HTMLElement> };
    currentMode: string;
  };

  constructor(el: string | HTMLElement, opts?: { value?: string; after?: () => void }) {
    this.value = opts?.value ?? "";
    const container = typeof el === "string" ? document.getElementById(el) : el;
    if (!container) throw new Error("缺少 Vditor 容器");
    container.innerHTML = [
      '<div class="vditor">',
      '<div class="vditor-toolbar"><button data-type="edit-mode">编辑模式</button></div>',
      '<div class="vditor-wysiwyg" contenteditable="true"><div class="vditor-reset" contenteditable="true"></div></div>',
      "</div>",
    ].join("");
    const element = container.querySelector<HTMLElement>(".vditor")!;
    const wysiwyg = container.querySelector<HTMLElement>(".vditor-wysiwyg")!;
    const reset = container.querySelector<HTMLElement>(".vditor-reset")!;
    reset.textContent = this.value;
    this.vditor = {
      element,
      wysiwyg: { element: wysiwyg },
      toolbar: { elements: {} },
      currentMode: "wysiwyg",
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastVditor = this;
    queueMicrotask(() => opts?.after?.());
  }

  getValue = () => this.value;
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);
vi.mock("vditor", () => ({
  default: class {
    value = "";
    setValue = vi.fn((value: string) => {
      this.value = value;
      const reset = this.vditor.wysiwyg.element.querySelector<HTMLElement>(".vditor-reset");
      if (reset) reset.textContent = value;
    });
    destroy = vi.fn();
    getHTML = () => "";
    insertValue = () => {};
    setTheme = () => {};
    vditor: {
      element: HTMLElement;
      wysiwyg: { element: HTMLElement };
      toolbar: { elements: Record<string, HTMLElement> };
      currentMode: string;
    };

    constructor(el: string | HTMLElement, opts?: { value?: string; after?: () => void }) {
      this.value = opts?.value ?? "";
      const container = typeof el === "string" ? document.getElementById(el) : el;
      if (!container) throw new Error("缺少 Vditor 容器");
      container.innerHTML = [
        '<div class="vditor">',
        '<div class="vditor-toolbar"><button data-type="edit-mode">编辑模式</button></div>',
        '<div class="vditor-wysiwyg" contenteditable="true"><div class="vditor-reset" contenteditable="true"></div></div>',
        "</div>",
      ].join("");
      const element = container.querySelector<HTMLElement>(".vditor")!;
      const wysiwyg = container.querySelector<HTMLElement>(".vditor-wysiwyg")!;
      const reset = container.querySelector<HTMLElement>(".vditor-reset")!;
      reset.textContent = this.value;
      this.vditor = {
        element,
        wysiwyg: { element: wysiwyg },
        toolbar: { elements: {} },
        currentMode: "wysiwyg",
      };
      lastVditor = this as unknown as MockVditor;
      queueMicrotask(() => opts?.after?.());
    }

    getValue = () => this.value;
  },
}));
vi.mock("vditor/dist/index.css", () => ({}));
vi.mock("vditor/dist/js/i18n/zh_CN", () => ({}));
vi.mock("../../src/features/blog/utils/vditorMenus", () => ({
  getEditorI18n: () => ({}),
  installCodeLanguageMenu: () => () => {},
  installControlledEditModeMenu: () => () => {},
  installControlledTableMenu: () => () => {},
  installTableCellMenu: () => () => {},
}));

const api = vi.hoisted(() => ({
  createBlogPost: vi.fn(),
  updateBlogPost: vi.fn(),
  deleteBlogPost: vi.fn(),
  getBlogPost: vi.fn(),
  getBlogResearchSummary: vi.fn(),
  getResearchTopic: vi.fn(),
  listBlogPosts: vi.fn(),
  suggestBlogTags: vi.fn(),
  generateBlogCover: vi.fn(),
  uploadFile: vi.fn(),
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
}));

vi.mock("../../src/api/client", () => api);

const EXISTING_POST = {
  id: 17,
  title: "已有文章",
  slug: "existing-post",
  content: "## 第一节\n\n原始段落内容",
  status: "draft",
  view_count: 0,
  created_at: "2026-01-01T00:00:00Z",
};

let latestChat: ReturnType<typeof useChat> | null = null;

function StoreSeed({ post }: { post?: typeof EXISTING_POST }) {
  const { dispatch } = useChat();
  useEffect(() => {
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
    if (!post) return;
    dispatch({ type: "SET_BLOG_POSTS", payload: [post] });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: post.id });
  }, [dispatch, post]);
  return null;
}

function StoreProbe({ onState }: { onState: (state: ReturnType<typeof useChat>["state"]) => void }) {
  const chat = useChat();
  useEffect(() => {
    latestChat = chat;
    onState(chat.state);
  }, [chat, onState]);
  return null;
}

function renderEditor(post?: typeof EXISTING_POST) {
  let latestState: ReturnType<typeof useChat>["state"] | null = null;
  const result = render(
    <MemoryRouter initialEntries={[post ? "/u/alice/posts/existing-post?edit" : "/u/alice"]}>
      <AuthProvider>
        <ChatProvider>
          <StoreSeed post={post} />
          <StoreProbe onState={(state) => { latestState = state; }} />
          <BlogEditor />
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...result, getState: () => latestState };
}

function selectText(node: Text, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("BlogEditor 核心回归", () => {
  beforeEach(() => {
    lastVditor = null;
    vi.clearAllMocks();
    // AuthProvider 挂载会调 /auth/refresh；回归测试不依赖登录用户身份，模拟未登录快速完成
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    api.getBlogResearchSummary.mockResolvedValue(null);
    api.listBlogPosts.mockResolvedValue([]);
    api.createBlogPost.mockResolvedValue({
      id: 99,
      title: "新文章",
      slug: "new-post",
      content: "这是编辑器中的正文。",
      status: "draft",
      view_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  it("发布新文章时使用 Vditor 当前正文并写入博客状态", async () => {
    const user = userEvent.setup();
    api.createBlogPost.mockResolvedValueOnce({
      id: 99,
      title: "新文章",
      slug: "new-post",
      content: "编辑器最新正文",
      status: "published",
      view_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    });
    const view = renderEditor();

    await user.type(await screen.findByPlaceholderText("输入文章标题..."), " 新文章 ");
    await waitFor(() => expect(lastVditor).not.toBeNull());
    lastVditor!.value = "编辑器最新正文";
    await user.click(screen.getByRole("button", { name: "发布文章" }));

    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledOnce());
    expect(api.createBlogPost).toHaveBeenCalledWith(expect.objectContaining({
      title: "新文章",
      content: "编辑器最新正文",
      excerpt: "编辑器最新正文",
      status: "published",
      cover_image: null,
    }));
    await waitFor(() => expect(view.getState()?.blogPosts[0]?.id).toBe(99));
    expect(view.getState()?.blogCurrentPostId).toBe(99);
    expect(view.getState()?.blogCurrentView).toBe("list");
  });

  it("更新已有文章只调用更新分支并返回详情视图", async () => {
    const user = userEvent.setup();
    api.updateBlogPost.mockResolvedValueOnce({ ...EXISTING_POST, title: "更新后的标题", content: "更新正文" });
    const view = renderEditor(EXISTING_POST);

    const title = await screen.findByPlaceholderText("输入文章标题...");
    await waitFor(() => expect(title).toHaveValue("已有文章"));
    await user.clear(title);
    await user.type(title, "更新后的标题");
    lastVditor!.value = "更新正文";
    await user.click(screen.getByRole("button", { name: "更新文章" }));

    await waitFor(() => expect(api.updateBlogPost).toHaveBeenCalledOnce());
    expect(api.updateBlogPost).toHaveBeenCalledWith(17, expect.objectContaining({
      title: "更新后的标题",
      content: "更新正文",
      status: "published",
    }));
    expect(api.createBlogPost).not.toHaveBeenCalled();
    await waitFor(() => expect(view.getState()?.blogCurrentView).toBe("view"));
    expect(view.getState()?.blogPosts[0]?.title).toBe("更新后的标题");
  });

  it("已有文章的编辑器选区会携带章节信息打开 AI 修改", async () => {
    const user = userEvent.setup();
    const view = renderEditor(EXISTING_POST);
    await screen.findByPlaceholderText("输入文章标题...");
    const reset = document.querySelector<HTMLElement>(".vditor-reset")!;
    reset.innerHTML = "<h2>第一节</h2><p>这是需要 AI 修改的完整原文。</p>";
    const paragraphText = reset.querySelector("p")!.firstChild! as Text;
    selectText(paragraphText, 0, paragraphText.textContent!.length);

    fireEvent.contextMenu(document.querySelector(".vditor-wrapper")!, { clientX: 120, clientY: 80 });
    await user.click(await screen.findByRole("button", { name: "AI 修改" }));

    await waitFor(() => expect(view.getState()?.aiSelectionContext).toEqual({
      postId: 17,
      selectedText: "这是需要 AI 修改的完整原文。",
      sectionIndex: 1,
    }));
    expect(view.getState()?.aiSidebarOpen).toBe(true);
    expect(api.createBlogPost).not.toHaveBeenCalled();
  });

  it("新文章进入 AI 修改时只静默创建 draft，并保留编辑视图", async () => {
    const user = userEvent.setup();
    const view = renderEditor();
    await user.type(await screen.findByPlaceholderText("输入文章标题..."), "新文章");
    const reset = document.querySelector<HTMLElement>(".vditor-reset")!;
    reset.innerHTML = "<h2>第一节</h2><p>这是新文章中需要修改的原文。</p>";
    lastVditor!.value = "## 第一节\n\n这是新文章中需要修改的原文。";
    const paragraphText = reset.querySelector("p")!.firstChild! as Text;
    selectText(paragraphText, 0, paragraphText.textContent!.length);

    fireEvent.contextMenu(document.querySelector(".vditor-wrapper")!, { clientX: 120, clientY: 80 });
    await user.click(await screen.findByRole("button", { name: "AI 修改" }));

    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledOnce());
    expect(api.createBlogPost).toHaveBeenCalledWith(expect.objectContaining({
      status: "draft",
      content: "## 第一节\n\n这是新文章中需要修改的原文。",
    }));
    await waitFor(() => expect(view.getState()?.aiSelectionContext?.postId).toBe(99));
    expect(view.getState()?.blogCurrentView).toBe("edit");
  });

  it("patch 从目标出现时计时，增量不会延长超时", async () => {
    vi.useFakeTimers();
    renderEditor(EXISTING_POST);
    await act(async () => { await Promise.resolve(); });
    expect(lastVditor).not.toBeNull();

    const reset = document.querySelector<HTMLElement>(".vditor-reset")!;
    reset.innerHTML = "<p>原始段落内容</p>";
    act(() => {
      latestChat!.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { postId: 17, runId: "timeout", targetText: "原始段落内容" } });
    });
    expect(document.querySelector(".ai-patch-inline")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(29_000);
      latestChat!.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { postId: 17, runId: "timeout", replacementDelta: "正在生成" } });
      vi.advanceTimersByTime(1_000);
    });

    expect(latestChat!.state.blogPatchStreamingByPostId[17]).toBeUndefined();
    expect(screen.getByText("AI 修改超时，请重试")).toBeInTheDocument();
  });
});
