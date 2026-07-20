import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";

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
  content: "这是一段足够长的正文内容用于测试删除按钮触发的对话框。",
  excerpt: "",
  status: "published",
  tags: "",
  view_count: 0,
  created_at: "2026-07-07T00:00:00Z",
  updated_at: "2026-07-07T00:00:00Z",
  published_at: "2026-07-07T00:00:00Z",
};

async function renderView() {
  function Harness() {
    const { dispatch } = useChat();
    React.useEffect(() => {
      dispatch({ type: "SET_BLOG_POSTS", payload: [POST] });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: POST.id });
    }, [dispatch]);
    return <BlogPostView username="tester" isOwner={true} />;
  }
  const utils = render(
    <MemoryRouter>
      <ChatProvider>
        <Harness />
      </ChatProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(utils.getByText("测试文章")).toBeInTheDocument());
  return utils;
}

describe("BlogPostView 删除文案改为可在回收站恢复", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("点击删除按钮后弹出可在回收站恢复提示", async () => {
    await renderView();
    const deleteBtn = screen.getByRole("button", { name: /删除/ });
    fireEvent.click(deleteBtn);
    expect(await screen.findByText(/可在回收站恢复/)).toBeInTheDocument();
  });
});

describe("四处删除确认文案都改为可在回收站恢复", () => {
  const cases: Array<{ name: string; rel: string; marker: string }> = [
    {
      name: "AISidebar 删除对话确认",
      rel: path.join("src", "features", "ai-chat", "ai-sidebar", "AISidebarList.tsx"),
      marker: "删除后可在回收站恢复。",
    },
    {
      name: "FilePanel 删除文件确认",
      rel: path.join("src", "components", "left-sidebar", "FilePanel.tsx"),
      marker: "删除后可在回收站恢复。",
    },
    {
      name: "BlogPostView 删除文章确认",
      rel: path.join("src", "features", "blog", "components", "BlogPostView.tsx"),
      marker: "删除后可在回收站恢复。",
    },
    {
      name: "BlogEditor 删除草稿确认",
      rel: path.join("src", "features", "blog", "components", "BlogEditor.tsx"),
      marker: "删除后可在回收站恢复。",
    },
  ];

  for (const c of cases) {
    it(`${c.name} 文案包含 "可在回收站恢复"`, () => {
      const file = path.resolve(__dirname, "..", "..", c.rel);
      const src = fs.readFileSync(file, "utf-8");
      expect(src).toContain(c.marker);
    });
  }
});

