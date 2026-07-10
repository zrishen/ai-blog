import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

// BlogPostView 用到 deleteBlogPost/publishBlogPost,右键菜单本身不触发它们,但组件挂载需要可调用
vi.mock("../../src/api/client", () => ({
  deleteBlogPost: vi.fn(() => Promise.resolve()),
  publishBlogPost: vi.fn(() =>
    Promise.resolve({ id: 1, status: "published", published_at: "2026-07-07T00:00:00Z" }),
  ),
  resolveMarkdownImageSrc: (src: string) => src,
}));

import { ChatProvider, useChat } from "../../src/stores/chatStore";
import { BlogPostView } from "../../src/features/blog/components/BlogPostView";

const POST = {
  id: 1,
  title: "测试文章",
  slug: "test-post",
  content: "这是一段足够长的正文内容用于测试右键菜单的定位与交互行为。",
  excerpt: "",
  status: "published",
  tags: "",
  view_count: 0,
  created_at: "2026-07-07T00:00:00Z",
  updated_at: "2026-07-07T00:00:00Z",
  published_at: "2026-07-07T00:00:00Z",
};

/** 把一篇文章注入 chatStore 并渲染 BlogPostView,返回等到文章标题渲染后的容器 */
async function renderView({ isOwner = true }: { isOwner?: boolean } = {}) {
  function Harness() {
    const { dispatch } = useChat();
    React.useEffect(() => {
      dispatch({ type: "SET_BLOG_POSTS", payload: [POST] });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: POST.id });
    }, [dispatch]);
    return <BlogPostView username="tester" isOwner={isOwner} />;
  }

  const utils = render(
    <MemoryRouter>
      <ChatProvider>
        <Harness />
      </ChatProvider>
    </MemoryRouter>,
  );
  // 等 store 注入完成(文章标题渲染出来),否则 handleContextMenu 会因 post 为空提前 return
  await waitFor(() => expect(utils.getByText("测试文章")).toBeInTheDocument());
  return utils;
}

/** 在绑定了 onContextMenu 的内容区触发右键 */
function contextMenuOnContent(container: HTMLElement, x: number, y: number) {
  // onContextMenu 绑在 articleRef 所指 div(含 px-6 pb-10),通过正文段落定位它
  const paragraph = container.querySelector("p");
  fireEvent.contextMenu(paragraph!, { clientX: x, clientY: y });
}

/** jsdom 没有 getSelection 的真实实现,mock 一个可控的选区 */
function mockSelection(text: string) {
  const sel = {
    toString: () => text,
    removeAllRanges: () => {},
    addRange: () => {},
    rangeCount: text ? 1 : 0,
    // getSectionIndexFromSelection 需要 range;jsdom 无真实实现,给一个返回 paragraph 起点的 stub
    getRangeAt: () => ({
      startContainer: document.querySelector("p") ?? document.body,
      startOffset: 0,
    }),
  };
  vi.spyOn(window, "getSelection").mockReturnValue(sel as unknown as Selection);
}

describe("BlogPostView 右键菜单", () => {
  beforeEach(() => {
    mockSelection("");
  });

  it("未选中文本时右键不弹出菜单", async () => {
    mockSelection("");
    const { container } = await renderView();
    contextMenuOnContent(container, 100, 200);
    expect(document.body.textContent).not.toContain("复制");
  });

  it("选中≥5字后右键,菜单出现在点击坐标(clientX/clientY)", async () => {
    mockSelection("一段被选中的文本内容");
    const { container } = await renderView();
    contextMenuOnContent(container, 321, 456);

    // 菜单应出现在 document.body(Portal)下
    const menu = [...document.body.children].find(
      (el) => el.tagName === "DIV" && el.textContent?.includes("复制"),
    );
    expect(menu).toBeTruthy();
    // 位置精确等于 clientX/clientY(本次修复核心:createPortal 后 fixed 以视口为参照)
    expect((menu as HTMLElement).style.left).toBe("321px");
    expect((menu as HTMLElement).style.top).toBe("456px");
  });

  it("菜单通过 Portal 渲染到 document.body,而非 article 内部", async () => {
    mockSelection("另一段足够长的选中文本");
    const { container } = await renderView();
    const article = container.querySelector("article");
    contextMenuOnContent(container, 10, 20);

    const menu = [...document.body.children].find(
      (el) => el.tagName === "DIV" && el.textContent?.includes("复制"),
    );
    expect(menu).toBeTruthy();
    // Portal:菜单 parentElement 是 body,不在 article 内
    expect((menu as HTMLElement).parentElement).toBe(document.body);
    expect(article?.contains(menu as Node)).toBe(false);
  });

  it("点击复制按钮写入剪贴板", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    mockSelection("要被复制的选中文本内容");

    const { container } = await renderView();
    contextMenuOnContent(container, 50, 60);

    const copyBtn = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("复制"),
    );
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn!);
    expect(writeText).toHaveBeenCalledWith("要被复制的选中文本内容");
  });

  it("isOwner=false 时不弹出菜单", async () => {
    mockSelection("访客选中的一段文本内容");
    const { container } = await renderView({ isOwner: false });
    contextMenuOnContent(container, 5, 5);
    expect(document.body.textContent).not.toContain("复制");
  });
});
