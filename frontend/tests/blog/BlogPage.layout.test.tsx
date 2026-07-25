import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlogPage } from "../../src/features/blog/components/BlogPage";
import { ChatProvider } from "../../src/stores/chatStore";

const { listSitePostsMock } = vi.hoisted(() => ({
  listSitePostsMock: vi.fn(),
}));

vi.mock("../../src/api/client", () => ({
  listSitePosts: listSitePostsMock,
}));

describe("BlogPage 空状态布局", () => {
  beforeEach(() => {
    listSitePostsMock.mockReset();
    listSitePostsMock.mockResolvedValue({ posts: [] });
  });

  it("空状态卡片填满中栏可用高度，并将提示内容居中", async () => {
    render(
      <MemoryRouter>
        <ChatProvider>
          <BlogPage username="alice" isOwner />
        </ChatProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(listSitePostsMock).toHaveBeenCalled());

    const heading = screen.getByRole("heading", { name: "还没有文章" });
    const emptyCard = heading.closest("section");
    const middleColumn = emptyCard?.parentElement;

    expect(emptyCard).toHaveClass("min-h-0", "flex-1", "items-center", "justify-center");
    expect(emptyCard).not.toHaveClass("min-h-[58vh]");
    expect(emptyCard).not.toHaveClass("border-dashed");
    expect(middleColumn).toHaveClass("flex", "h-full", "min-h-0", "flex-col", "p-2");
  });
});
