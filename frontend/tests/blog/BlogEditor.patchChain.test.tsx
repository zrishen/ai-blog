import React, { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// 顶部 class 仅用于 lastVditor 的类型标注；实际 mock 取自 vi.mock 工厂。
// 相对 regression 的 MockVditor，这里额外暴露 _input，便于手动驱动 Vditor input 回调。
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
  _input: ((val: string) => void) | undefined;
  vditor: {
    element: HTMLElement;
    wysiwyg: { element: HTMLElement };
    toolbar: { elements: Record<string, HTMLElement> };
    currentMode: string;
  };

  constructor(
    el: string | HTMLElement,
    opts?: { value?: string; after?: () => void; input?: (val: string) => void },
  ) {
    this.value = opts?.value ?? "";
    this._input = opts?.input;
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
    _input: ((val: string) => void) | undefined;
    vditor: {
      element: HTMLElement;
      wysiwyg: { element: HTMLElement };
      toolbar: { elements: Record<string, HTMLElement> };
      currentMode: string;
    };

    constructor(
      el: string | HTMLElement,
      opts?: { value?: string; after?: () => void; input?: (val: string) => void },
    ) {
      this.value = opts?.value ?? "";
      this._input = opts?.input;
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

function StoreSeed({ post }: { post: typeof EXISTING_POST }) {
  const { dispatch } = useChat();
  useEffect(() => {
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
    dispatch({ type: "SET_BLOG_POSTS", payload: [post] });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: post.id });
  }, [dispatch, post]);
  return null;
}

function StoreProbe() {
  const chat = useChat();
  useEffect(() => {
    latestChat = chat;
  }, [chat]);
  return null;
}

function renderEditor(post: typeof EXISTING_POST) {
  return render(
    <MemoryRouter initialEntries={["/u/alice/posts/existing-post?edit"]}>
      <AuthProvider>
        <ChatProvider>
          <StoreSeed post={post} />
          <StoreProbe />
          <BlogEditor />
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function waitForVditor() {
  await waitFor(() => expect(lastVditor).not.toBeNull());
  // 等 after() 钩子跑完（queueMicrotask），vditorReadyRef 置真后 patch/content effect 才生效
  await act(async () => { await Promise.resolve(); });
}

function readMetaCount(): string | null {
  const el = document.querySelector<HTMLElement>(".blog-editor-toolbar-meta-count");
  return el?.textContent ?? null;
}

describe("BlogEditor AI patch 链", () => {
  beforeEach(() => {
    lastVditor = null;
    latestChat = null;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    api.getBlogResearchSummary.mockResolvedValue(null);
    api.listBlogPosts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("P1-B1：START 注入预览 → APPEND 累积文本 → CLEAR 回写 Vditor", async () => {
    renderEditor(EXISTING_POST);
    await waitForVditor();

    const reset = document.querySelector<HTMLElement>(".vditor-reset")!;
    // Vditor mock 用 textContent 渲染初始值，patch 注入需结构化 block 才能被命中
    reset.innerHTML = "<p>原始段落内容</p>";

    // 1) START：命中 <p>，注入 .ai-patch-inline，并置 patchApplyPendingRef
    act(() => {
      latestChat!.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText: "原始段落内容" } });
    });
    const preview = document.querySelector<HTMLElement>(".ai-patch-inline");
    expect(preview).toBeInTheDocument();
    expect(preview!.querySelector(".ai-patch-inline__label")!.textContent).toBe("AI 修改中...");
    // replacementDelta 初始为空，预览占位 "..."
    expect(preview!.querySelector(".ai-patch-inline__text")!.textContent).toBe("...");
    // <p> 已被预览替换
    expect(reset.querySelector("p")).toBeNull();

    // 2) APPEND：流式增量更新预览文本，不重新注入
    act(() => {
      latestChat!.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta: "这是替换后的内容" } });
    });
    expect(document.querySelector<HTMLElement>(".ai-patch-inline__text")!.textContent).toBe("这是替换后的内容");
    expect(document.querySelectorAll(".ai-patch-inline")).toHaveLength(1);

    const setValueCallsBeforeClear = lastVditor!.setValue.mock.calls.length;

    // 3) CLEAR：patchApplyPendingRef 已置真 → 回写 setValue(expandBlankLines(existingPost.content))
    act(() => {
      latestChat!.dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
    });
    expect(lastVditor!.setValue.mock.calls.length).toBe(setValueCallsBeforeClear + 1);
    expect(lastVditor!.setValue).toHaveBeenLastCalledWith(expect.stringContaining("原始段落内容"));
    // 回写用的是文章全量正文，含标题章节
    expect(lastVditor!.setValue).toHaveBeenLastCalledWith(expect.stringContaining("## 第一节"));
    // 预览节点在 CLEAR 后不再存在（setValue 重置了 reset 文本）
    expect(document.querySelector(".ai-patch-inline")).not.toBeInTheDocument();

    // 4) patchApplyPendingRef 已复位：再次 CLEAR 不再触发回写
    act(() => {
      latestChat!.dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
    });
    expect(lastVditor!.setValue.mock.calls.length).toBe(setValueCallsBeforeClear + 1);
  });

  it("P1-B2：目标找不到时不注入预览，CLEAR 也不回写", async () => {
    renderEditor(EXISTING_POST);
    await waitForVditor();

    const reset = document.querySelector<HTMLElement>(".vditor-reset")!;
    reset.innerHTML = "<p>原始段落内容</p>";

    const setValueCallsBefore = lastVditor!.setValue.mock.calls.length;

    // START：targetText 与任何 block 都不匹配
    act(() => {
      latestChat!.dispatch({
        type: "START_BLOG_PATCH_STREAMING",
        payload: { targetText: "完全不存在的目标文本啊啊啊" },
      });
    });
    expect(document.querySelector(".ai-patch-inline")).not.toBeInTheDocument();
    // 未注入预览 → 未置 patchApplyPendingRef → <p> 保留
    expect(reset.querySelector("p")).not.toBeNull();

    // CLEAR：因 patchApplyPendingRef 未置真，跳过回写分支
    act(() => {
      latestChat!.dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
    });
    expect(lastVditor!.setValue.mock.calls.length).toBe(setValueCallsBefore);
  });

  it("P1-B3a：existingPost.content 变化时 programmatic setValue 同步到 Vditor", async () => {
    renderEditor(EXISTING_POST);
    await waitForVditor();

    const setValueCallsBefore = lastVditor!.setValue.mock.calls.length;

    await act(async () => {
      latestChat!.dispatch({
        type: "UPDATE_BLOG_POST",
        payload: { ...EXISTING_POST, content: "## 全新章节\n\n全新的正文内容XYZ" },
      });
    });

    expect(lastVditor!.setValue.mock.calls.length).toBe(setValueCallsBefore + 1);
    expect(lastVditor!.setValue).toHaveBeenLastCalledWith(expect.stringContaining("全新的正文内容XYZ"));
  });

  it("P1-B3b：isProgrammaticChange 阻断 input 回环，消费一次后恢复正常", async () => {
    renderEditor(EXISTING_POST);
    await waitForVditor();
    await waitFor(() => expect(readMetaCount()).not.toBeNull());

    const initialCount = readMetaCount();
    expect(lastVditor!._input).toBeDefined();

    // 触发 programmatic setValue：content 变化 → effect 置 isProgrammaticChange=true 再 setValue
    await act(async () => {
      latestChat!.dispatch({
        type: "UPDATE_BLOG_POST",
        payload: { ...EXISTING_POST, content: "程序化写入的值XYZ" },
      });
    });
    // programmatic 写入不应污染 content state（wordCount 不变）
    expect(readMetaCount()).toBe(initialCount);

    // 模拟 Vditor 内部 input 事件：此时 isProgrammaticChange=true，应早返回，不 setContent
    act(() => {
      lastVditor!._input!("程序化写入的值XYZ");
    });
    expect(readMetaCount()).toBe(initialCount);

    // 消费一次后 isProgrammaticChange 复位，后续 input 正常更新 content
    act(() => {
      lastVditor!._input!("用户真实输入ABC");
    });
    await waitFor(() => expect(readMetaCount()).not.toBe(initialCount));
    // content state 已被 input 回调写为新值
    expect(readMetaCount()).toMatch(/9 字 · 1 行/);
  });
});

describe("BlogEditor dirty 追踪", () => {
  beforeEach(() => {
    lastVditor = null;
    latestChat = null;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    api.getBlogResearchSummary.mockResolvedValue(null);
    api.listBlogPosts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("P1-B5 切文章时 skipDirtyOnceRef 跳过一次 dirty，返回不弹保存草稿框", async () => {
    renderEditor(EXISTING_POST);
    await waitForVditor();

    // 改标题 → dirty
    const title = screen.getByPlaceholderText("输入文章标题...");
    fireEvent.change(title, { target: { value: "改过的标题" } });
    // 点返回 → dirty，弹"是否保存草稿？"
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText("是否保存草稿？")).toBeInTheDocument();

    // 继续编辑关闭弹窗
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.queryByText("是否保存草稿？")).not.toBeInTheDocument());

    // 切到 post B：表单整体重置 + skipDirtyOnceRef=true，字段 effect 消费后不标 dirty
    const POST_B = { ...EXISTING_POST, id: 18, title: "文章B", content: "## B节\n\nB内容" };
    act(() => {
      latestChat!.dispatch({ type: "SET_BLOG_POSTS", payload: [POST_B] });
      latestChat!.dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: POST_B.id });
    });
    await act(async () => { await Promise.resolve(); });

    // 点返回 → 不弹保存草稿框，直接退到 view
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.queryByText("是否保存草稿？")).not.toBeInTheDocument());
    expect(latestChat!.state.blogCurrentView).toBe("view");
  });
});

describe("BlogEditor Vditor 生命周期", () => {
  beforeEach(() => {
    lastVditor = null;
    latestChat = null;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    api.getBlogResearchSummary.mockResolvedValue(null);
    api.listBlogPosts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("P1-Mount: Vditor 实例 mount-only，content 变化只 setValue 不重建，unmount 销毁", async () => {
    const { unmount } = renderEditor(EXISTING_POST);
    await waitForVditor();
    const instance = lastVditor;
    expect(instance).not.toBeNull();
    expect(instance!.destroy).not.toHaveBeenCalled();

    // content 变化 → content 同步 effect 调 setValue，但 Vditor 实例不重建（mount-only 空 deps）
    await act(async () => {
      latestChat!.dispatch({ type: "UPDATE_BLOG_POST", payload: { ...EXISTING_POST, content: "## 全新章节\n\n全新正文XYZ" } });
    });
    expect(lastVditor).toBe(instance);
    expect(instance!.setValue).toHaveBeenCalledWith(expect.stringContaining("全新正文XYZ"));

    // unmount → cleanup 调 destroy
    unmount();
    expect(instance!.destroy).toHaveBeenCalled();
  });
});
