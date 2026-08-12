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
  publishBlogPost: vi.fn(),
  listBlogRevisions: vi.fn(),
  getBlogRevision: vi.fn(),
  commitBlogRevision: vi.fn(),
  restoreBlogRevision: vi.fn(),
  deleteBlogRevision: vi.fn(),
  deleteBlogPost: vi.fn(),
  getBlogPost: vi.fn(),
  listBlogPosts: vi.fn(),
  suggestBlogTags: vi.fn(),
  generateBlogCover: vi.fn(),
  uploadFile: vi.fn(),
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
}));

vi.mock("../../src/api/client", () => ({
  getAccessToken: api.getAccessToken,
  setAccessToken: api.setAccessToken,
}));

vi.mock("../../src/api/blog", () => ({
  createBlogPost: api.createBlogPost,
  updateBlogPost: api.updateBlogPost,
  publishBlogPost: api.publishBlogPost,
  listBlogRevisions: api.listBlogRevisions,
  getBlogRevision: api.getBlogRevision,
  commitBlogRevision: api.commitBlogRevision,
  restoreBlogRevision: api.restoreBlogRevision,
  deleteBlogRevision: api.deleteBlogRevision,
  deleteBlogPost: api.deleteBlogPost,
  getBlogPost: api.getBlogPost,
  listBlogPosts: api.listBlogPosts,
  suggestBlogTags: api.suggestBlogTags,
  generateBlogCover: api.generateBlogCover,
}));

vi.mock("../../src/api/chat", () => ({
  uploadFile: api.uploadFile,
}));

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
    api.listBlogPosts.mockResolvedValue([]);
    api.listBlogRevisions.mockResolvedValue([]);
    api.publishBlogPost.mockResolvedValue({
      id: 99,
      title: "新文章",
      slug: "new-post",
      content: "编辑器最新正文",
      status: "draft",
      view_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    });
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

  it("正文为空时点击正文内容区空白会将光标聚焦到首行", async () => {
    const view = renderEditor();
    await waitFor(() => expect(lastVditor).not.toBeNull());

    const canvas = view.container.querySelector<HTMLElement>(".vditor-wysiwyg")!;
    const contentArea = document.createElement("div");
    contentArea.className = "vditor-content";
    canvas.replaceWith(contentArea);
    contentArea.append(canvas);
    const editorEl = view.container.querySelector<HTMLElement>(".vditor-reset")!;
    lastVditor!.vditor.wysiwyg.element = editorEl;
    const focus = vi.spyOn(editorEl, "focus");

    expect(fireEvent.pointerDown(contentArea, { button: 0 })).toBe(false);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(editorEl);
    expect(window.getSelection()?.anchorNode).toBe(editorEl);
    expect(window.getSelection()?.anchorOffset).toBe(0);

    lastVditor!.value = "已有正文";
    editorEl.textContent = "已有正文";
    expect(fireEvent.pointerDown(contentArea, { button: 0 })).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("预览使用当前未保存内容渲染发布后的文章视图", async () => {
    const user = userEvent.setup();
    renderEditor(EXISTING_POST);

    const title = await screen.findByPlaceholderText("输入文章标题...");
    await user.clear(title);
    await user.type(title, "预览中的标题");
    await waitFor(() => expect(lastVditor).not.toBeNull());
    lastVditor!.value = "## 预览小节\n\n预览正文";

    await user.click(screen.getByRole("button", { name: "预览" }));

    expect(screen.getByRole("heading", { name: "预览中的标题", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("预览正文")).toBeInTheDocument();
    expect(api.updateBlogPost).not.toHaveBeenCalled();
    expect(api.publishBlogPost).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "返回" })[0]);
    expect(await screen.findByPlaceholderText("输入文章标题...")).toHaveValue("预览中的标题");
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
    await user.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledOnce());
    expect(api.createBlogPost).toHaveBeenCalledWith(expect.objectContaining({
      title: "新文章",
      content: "编辑器最新正文",
      excerpt: "编辑器最新正文",
      status: "draft",
      cover_image: null,
    }));
    await waitFor(() => expect(api.publishBlogPost).toHaveBeenCalledWith(99, true));
    await waitFor(() => expect(view.getState()?.blogPosts[0]?.id).toBe(99));
    expect(view.getState()?.blogCurrentPostId).toBe(99);
    expect(view.getState()?.blogCurrentView).toBe("list");
  });

  it("更新已有文章只调用更新分支并返回详情视图", async () => {
    const user = userEvent.setup();
    api.updateBlogPost.mockResolvedValueOnce({ ...EXISTING_POST, title: "更新后的标题", content: "更新正文" });
    api.publishBlogPost.mockResolvedValueOnce({ ...EXISTING_POST, title: "更新后的标题", content: "更新正文", status: "published" });
    const view = renderEditor(EXISTING_POST);

    const title = await screen.findByPlaceholderText("输入文章标题...");
    await waitFor(() => expect(title).toHaveValue("已有文章"));
    await user.clear(title);
    await user.type(title, "更新后的标题");
    lastVditor!.value = "更新正文";
    await user.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() => expect(api.updateBlogPost).toHaveBeenCalledOnce());
    expect(api.updateBlogPost).toHaveBeenCalledWith(17, expect.objectContaining({
      title: "更新后的标题",
      content: "更新正文",
    }));
    await waitFor(() => expect(api.publishBlogPost).toHaveBeenCalledWith(17, true));
    expect(api.createBlogPost).not.toHaveBeenCalled();
    await waitFor(() => expect(view.getState()?.blogCurrentView).toBe("view"));
    expect(view.getState()?.blogPosts[0]?.title).toBe("更新后的标题");
  });

  it("保存草稿先保存工作副本、创建 commit 修订，并留在编辑器", async () => {
    const user = userEvent.setup();
    api.updateBlogPost.mockResolvedValueOnce({ ...EXISTING_POST, content: "草稿工作副本" });
    api.commitBlogRevision.mockResolvedValueOnce({
      id: 201,
      revision_number: 1,
      kind: "commit",
      title: EXISTING_POST.title,
      content: "草稿工作副本",
      created_at: "2026-01-01T00:00:00Z",
      is_published: false,
    });
    const view = renderEditor(EXISTING_POST);
    await screen.findByPlaceholderText("输入文章标题...");
    lastVditor!.value = "草稿工作副本";

    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(await screen.findByRole("button", { name: "保存版本" }));

    await waitFor(() => expect(api.updateBlogPost).toHaveBeenCalledWith(17, expect.objectContaining({ content: "草稿工作副本" })));
    await waitFor(() => expect(api.commitBlogRevision).toHaveBeenCalledWith(17));
    expect(api.publishBlogPost).not.toHaveBeenCalled();
    expect(view.getState()?.blogCurrentView).toBe("edit");
    expect(screen.getByRole("button", { name: "保存版本" })).toBeInTheDocument();
  });

  it("历史达到十个版本时，保存前会明确确认将被删除的版本", async () => {
    const user = userEvent.setup();
    api.listBlogRevisions.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      revision_number: 10 - index,
      kind: "commit" as const,
      title: "历史版本",
      created_at: "2026-01-01T00:00:00Z",
      is_published: false,
    })));
    api.updateBlogPost.mockResolvedValueOnce({ ...EXISTING_POST, content: "确认后保存的正文" });
    api.commitBlogRevision.mockResolvedValueOnce({
      id: 11,
      revision_number: 11,
      kind: "commit",
      title: EXISTING_POST.title,
      content: "确认后保存的正文",
      created_at: "2026-02-01T00:00:00Z",
      is_published: false,
    });
    renderEditor(EXISTING_POST);
    await screen.findByPlaceholderText("输入文章标题...");
    lastVditor!.value = "确认后保存的正文";

    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(await screen.findByRole("button", { name: "保存版本" }));

    const confirmation = await screen.findByRole("dialog", { name: "历史版本已满" });
    expect(confirmation).toHaveTextContent("版本 1");
    expect(api.updateBlogPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除并保存版本" }));
    await waitFor(() => expect(api.updateBlogPost).toHaveBeenCalledWith(17, expect.objectContaining({ content: "确认后保存的正文" })));
    await waitFor(() => expect(api.commitBlogRevision).toHaveBeenCalledWith(17));
  });

  it("新文章打开历史时会先同步工作副本", async () => {
    const user = userEvent.setup();
    const view = renderEditor();
    await user.type(await screen.findByPlaceholderText("输入文章标题..."), "新文章");
    await waitFor(() => expect(lastVditor).not.toBeNull());
    lastVditor!.value = "新文章正文";

    await user.click(screen.getByRole("button", { name: "历史" }));

    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledWith(expect.objectContaining({
      title: "新文章",
      content: "新文章正文",
      status: "draft",
    })));
    expect(await screen.findByRole("button", { name: "保存版本" })).toBeInTheDocument();
    await waitFor(() => expect(view.getState()?.blogCurrentPostId).toBe(99));
  });

  it("历史以下拉面板展示，并在悬停版本时加载预览和操作", async () => {
    const user = userEvent.setup();
    api.listBlogRevisions.mockResolvedValue([{
      id: 301,
      revision_number: 3,
      kind: "commit",
      title: "历史版本标题",
      created_at: "2026-01-02T00:00:00Z",
      is_published: false,
    }, {
      id: 302,
      revision_number: 2,
      kind: "commit",
      title: "另一历史版本",
      created_at: "2026-01-01T00:00:00Z",
      is_published: false,
    }]);
    api.getBlogRevision.mockImplementation(async (_postId: number, revisionId: number) => (
      revisionId === 301
        ? {
            id: 301,
            revision_number: 3,
            kind: "commit",
            title: "历史版本标题",
            content: "历史版本正文",
            slug: "existing-post",
            created_at: "2026-01-02T00:00:00Z",
            is_published: false,
          }
        : {
            id: 302,
            revision_number: 2,
            kind: "commit",
            title: "另一历史版本",
            content: "另一历史版本正文",
            slug: "existing-post",
            created_at: "2026-01-01T00:00:00Z",
            is_published: false,
          }
    ));
    renderEditor(EXISTING_POST);

    await user.click(await screen.findByRole("button", { name: "历史" }));
    const revision = await screen.findByRole("button", { name: /版本 3/ });
    fireEvent.mouseEnter(revision);

    await waitFor(() => expect(api.getBlogRevision).toHaveBeenCalledWith(17, 301));
    expect(screen.getByText("历史版本正文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();

    await user.click(revision);
    await waitFor(() => expect(revision).toHaveAttribute("aria-pressed", "true"));

    const otherRevision = screen.getByRole("button", { name: /版本 2/ });
    fireEvent.mouseEnter(otherRevision);
    await waitFor(() => expect(api.getBlogRevision).toHaveBeenCalledWith(17, 302));
    expect(screen.getByText("另一历史版本正文")).toBeInTheDocument();

    fireEvent.mouseLeave(otherRevision.parentElement!);
    await waitFor(() => expect(screen.getByText("历史版本正文")).toBeInTheDocument());

    await user.click(revision);
    await waitFor(() => expect(revision).toHaveAttribute("aria-pressed", "false"));

    await user.click(screen.getByRole("button", { name: "展开查看" }));
    expect(screen.getByRole("dialog", { name: "版本 3 完整内容" })).toHaveTextContent("历史版本正文");
  });

  it("恢复前存在未保存修改时会提示，并允许放弃修改后恢复", async () => {
    const user = userEvent.setup();
    api.listBlogRevisions.mockResolvedValue([{
      id: 401,
      revision_number: 4,
      kind: "commit" as const,
      title: "可恢复版本",
      created_at: "2026-01-02T00:00:00Z",
      is_published: false,
    }]);
    api.getBlogRevision.mockResolvedValue({
      id: 401,
      revision_number: 4,
      kind: "commit",
      title: "可恢复版本",
      content: "恢复后的正文",
      slug: "existing-post",
      created_at: "2026-01-02T00:00:00Z",
      is_published: false,
    });
    api.restoreBlogRevision.mockResolvedValue({
      ...EXISTING_POST,
      title: "可恢复版本",
      content: "恢复后的正文",
    });
    renderEditor(EXISTING_POST);

    const title = await screen.findByPlaceholderText("输入文章标题...");
    await user.type(title, "（未保存修改）");
    await user.click(screen.getByRole("button", { name: "历史" }));
    const revision = await screen.findByRole("button", { name: /版本 4/ });
    fireEvent.mouseEnter(revision);
    await waitFor(() => expect(api.getBlogRevision).toHaveBeenCalledWith(17, 401));

    await user.click(screen.getByRole("button", { name: "恢复" }));

    const confirmation = await screen.findByRole("dialog", { name: "当前修改尚未保存为版本" });
    expect(confirmation).toHaveTextContent("版本 4");
    expect(api.restoreBlogRevision).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "展开查看" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "放弃修改并恢复" }));
    await waitFor(() => expect(api.restoreBlogRevision).toHaveBeenCalledWith(17, 401));
    expect(api.commitBlogRevision).not.toHaveBeenCalled();
    await waitFor(() => expect(title).toHaveValue("可恢复版本"));
  });

  it("恢复前存在未保存修改时可以先保存为历史版本", async () => {
    const user = userEvent.setup();
    api.listBlogRevisions.mockResolvedValue([{
      id: 402,
      revision_number: 4,
      kind: "commit" as const,
      title: "可恢复版本",
      created_at: "2026-01-02T00:00:00Z",
      is_published: false,
    }]);
    api.getBlogRevision.mockResolvedValue({
      id: 402,
      revision_number: 4,
      kind: "commit",
      title: "可恢复版本",
      content: "恢复后的正文",
      slug: "existing-post",
      created_at: "2026-01-02T00:00:00Z",
      is_published: false,
    });
    api.updateBlogPost.mockResolvedValue({ ...EXISTING_POST, title: "已有文章（未保存修改）" });
    api.commitBlogRevision.mockResolvedValue({
      id: 403,
      revision_number: 5,
      kind: "commit",
      title: "已有文章（未保存修改）",
      content: EXISTING_POST.content,
      created_at: "2026-01-02T00:01:00Z",
      is_published: false,
    });
    api.restoreBlogRevision.mockResolvedValue({
      ...EXISTING_POST,
      title: "可恢复版本",
      content: "恢复后的正文",
    });
    renderEditor(EXISTING_POST);

    const title = await screen.findByPlaceholderText("输入文章标题...");
    await user.type(title, "（未保存修改）");
    await user.click(screen.getByRole("button", { name: "历史" }));
    const revision = await screen.findByRole("button", { name: /版本 4/ });
    fireEvent.mouseEnter(revision);
    await waitFor(() => expect(api.getBlogRevision).toHaveBeenCalledWith(17, 402));

    await user.click(screen.getByRole("button", { name: "恢复" }));
    await user.click(await screen.findByRole("button", { name: "保存版本并恢复" }));

    await waitFor(() => expect(api.commitBlogRevision).toHaveBeenCalledWith(17));
    await waitFor(() => expect(api.restoreBlogRevision).toHaveBeenCalledWith(17, 402));
    await waitFor(() => expect(title).toHaveValue("可恢复版本"));
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
