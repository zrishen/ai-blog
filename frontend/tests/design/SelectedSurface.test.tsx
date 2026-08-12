import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminNav } from "../../src/features/admin/components/AdminNav";
import { ConversationListView } from "../../src/features/ai-chat/ai-sidebar/ConversationListView";

describe("soft selected surfaces", () => {
  it("uses a neutral edge for the selected AI conversation card", () => {
    render(
      <ConversationListView
        conversations={[
          {
            key: "server:1",
            id: 1,
            title: "选中的对话",
            created_at: "2026-07-26T00:00:00Z",
            selected: true,
            streaming: false,
            error: null,
            isTemp: false,
          },
        ]}
        error={null}
        onSelect={vi.fn()}
        onDeleteRequest={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );

    const selectedCard = screen.getByText("选中的对话").closest('[role="button"]');
    expect(selectedCard).toHaveClass(
      "border-border/80",
      "bg-primary/6",
      "shadow-foreground/5",
    );
    expect(selectedCard).not.toHaveClass(
      "border-primary/25",
      "shadow-primary/8",
    );
  });

  it("keeps the active admin navigation row on the same soft surface", () => {
    render(
      <MemoryRouter initialEntries={["/admin/usage"]}>
        <AdminNav />
      </MemoryRouter>,
    );

    const activeItem = document.querySelector('a[href="/admin/usage"]');
    expect(activeItem).toHaveClass(
      "border-border/80",
      "bg-primary/8",
      "shadow-foreground/5",
    );
    expect(activeItem).not.toHaveClass(
      "border-primary/18",
      "shadow-primary/8",
    );
  });
});
