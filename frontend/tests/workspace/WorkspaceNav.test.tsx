import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { ChatProvider, useChat } from "../../src/stores/chatStore";
import { WorkspaceNav } from "../../src/features/workspace/WorkspaceNav";

import type { WorkspaceEntry } from "../../src/api/workspace";

const api = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
  moveEntry: vi.fn(),
  renameEntry: vi.fn(),
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  deleteUnmanagedWorkspaceFile: vi.fn(),
  joinAiKnowledge: vi.fn(),
  getBlogPost: vi.fn(),
  listFileDocuments: vi.fn(),
  startUpload: vi.fn(),
}));

vi.mock("../../src/api/workspace", () => ({
  createFolder: api.createFolder,
  deleteUnmanagedWorkspaceFile: api.deleteUnmanagedWorkspaceFile,
  deleteFolder: api.deleteFolder,
  getWorkspaceTree: api.getWorkspaceTree,
  joinAiKnowledge: api.joinAiKnowledge,
  moveEntry: api.moveEntry,
  renameEntry: api.renameEntry,
}));
vi.mock("../../src/api/blog", () => ({ getBlogPost: api.getBlogPost }));
vi.mock("../../src/api/files", () => ({ listFileDocuments: api.listFileDocuments }));
vi.mock("../../src/features/workspace/providers/FileProcessingProvider", () => ({
  useFileProcessing: () => ({ startUpload: api.startUpload }),
}));
// 删除资源对话框依赖额外 API，挂载即 null，跳过以避免拖慢
vi.mock("../../src/features/workspace/components/DeleteResourceDialog", () => ({
  DeleteResourceDialog: () => null,
}));

let latestState: ReturnType<typeof useChat>["state"] | null = null;

function Seed() {
  const { state } = useChat();
  latestState = state;
  return null;
}

function entry(path: string, kind: WorkspaceEntry["kind"], extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    kind,
    resource_type: null,
    resource_id: null,
    blog_status: null,
    ...extra,
  };
}

function renderNav(tree?: WorkspaceEntry[]) {
  if (tree) api.getWorkspaceTree.mockResolvedValue(tree);
  return render(
    <MemoryRouter>
      <ChatProvider>
        <Seed />
        <WorkspaceNav />
      </ChatProvider>
    </MemoryRouter>,
  );
}

function dropTo(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = {
    path: "",
    setData(_type: string, value: string) {
      this.path = value;
    },
    getData() {
      return this.path;
    },
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe("WorkspaceNav", () => {
  beforeEach(() => {
    localStorage.clear();
    latestState = null;
    vi.clearAllMocks();
    api.getWorkspaceTree.mockResolvedValue([]);
    api.moveEntry.mockResolvedValue({});
    api.renameEntry.mockResolvedValue({});
    api.createFolder.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载后渲染树，文件夹排前、同级按名称排序", async () => {
    renderNav([
      entry("b.md", "file"),
      entry("folder", "folder"),
      entry("a.md", "file"),
    ]);
    await waitFor(() => expect(api.getWorkspaceTree).toHaveBeenCalled());
    const texts = screen.getAllByText(/^(folder|a\.md|b\.md)$/).map((el) => el.textContent);
    expect(texts).toEqual(["folder", "a.md", "b.md"]);
  });

  it("点击顶部视图切换 workspace 选中视图", async () => {
    renderNav([]);
    await waitFor(() => expect(api.getWorkspaceTree).toHaveBeenCalled());
    await act(async () => {
      screen.getByRole("button", { name: "草稿" }).click();
    });
    expect(latestState?.workspaceSelectedView).toBe("drafts");
    await act(async () => {
      screen.getByRole("button", { name: "回收站" }).click();
    });
    expect(latestState?.workspaceSelectedView).toBe("trash");
  });

  it("打开 blog 条目时拉取文章并设为当前文章", async () => {
    api.getBlogPost.mockResolvedValue({
      id: 7,
      title: "文章七",
      slug: "post-7",
      status: "draft",
      view_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    });
    renderNav([entry("post", "blog", { resource_id: 7 })]);
    await waitFor(() => expect(screen.getByText("post")).toBeInTheDocument());
    await act(async () => {
      screen.getByText("post").click();
    });
    await waitFor(() => expect(api.getBlogPost).toHaveBeenCalledWith(7));
    await waitFor(() => expect(latestState?.blogCurrentPostId).toBe(7));
    expect(latestState?.workspaceEditingBlogId).toBe(7);
  });

  it("moveFromDrop 拖到自身或父目录不调用 API，拖到合法目标调用", async () => {
    renderNav([
      entry("a", "folder"),
      entry("a/b", "folder"),
      entry("x", "folder"),
    ]);
    await waitFor(() => expect(screen.getByText("b")).toBeInTheDocument());

    const a = screen.getByText("a");
    const b = screen.getByText("b");
    const x = screen.getByText("x");

    // 拖到自身：sourcePath === targetPath，守卫拦截
    dropTo(b, b);
    await waitFor(() => expect(api.moveEntry).not.toHaveBeenCalled());

    // 拖到父目录：parentPath(sourcePath) === targetPath，守卫拦截
    dropTo(b, a);
    await waitFor(() => expect(api.moveEntry).not.toHaveBeenCalled());

    // 拖到合法兄弟目标：调用 moveEntry
    dropTo(b, x);
    await waitFor(() => expect(api.moveEntry).toHaveBeenCalledTimes(1));
    expect(api.moveEntry).toHaveBeenCalledWith("a/b", "x");
  });

  it("折叠文件夹隐藏子项并持久化到 localStorage", async () => {
    renderNav([
      entry("a", "folder"),
      entry("a/b", "folder"),
    ]);
    await waitFor(() => expect(screen.getByText("b")).toBeInTheDocument());
    await act(async () => {
      screen.getAllByRole("button", { name: "折叠文件夹" })[0].click();
    });
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("workspace:collapsed-paths") ?? "[]")).toEqual(["a"]);
    });
    await act(async () => {
      screen.getByRole("button", { name: "展开文件夹" }).click();
    });
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("树加载失败时展示错误文案", async () => {
    api.getWorkspaceTree.mockRejectedValue(new Error("网络错误"));
    renderNav();
    await waitFor(() => expect(screen.getByText("网络错误")).toBeInTheDocument());
  });
});
