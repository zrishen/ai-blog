import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/api/client", () => ({
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => null),
  parseJson: (res: Response) => res.json(),
}));

vi.mock("../../src/api/auth", () => ({
  getLLMSettings: vi.fn(() => Promise.resolve({ protocol: "openai", base_url: "", api_key: "", model: "", supports_thinking: true })),
  updateLLMSettings: vi.fn(),
}));

vi.mock("../../src/api/subscription", () => ({
  getSubscriptionStatus: vi.fn(() => Promise.resolve({
    active: true,
    expires_at: "2099-01-01T00:00:00Z",
    used: 1_000_000,
    limit: 10_000_000,
    remaining: 9_000_000,
    period: "2099-W01",
  })),
  redeemSubscriptionCode: vi.fn(),
}));

import { AuthProvider } from "../../src/stores/authStore";
import { ChatProvider } from "../../src/stores/chatStore";
import { FileProcessingProvider } from "../../src/features/workspace/providers/FileProcessingProvider";
import { NavBar } from "../../src/components/NavBar";

function renderNav() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ChatProvider>
          <FileProcessingProvider>
            <NavBar />
          </FileProcessingProvider>
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("NavBar subscription entry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "token", user: { id: 1, username: "alice", is_admin: false, is_super_admin: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: 200 }),
    ));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("places subscription and usage in the avatar menu instead of the settings dialog", async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(await screen.findByTitle("alice"));
    await user.click(await screen.findByText("订阅"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("rounded-surface", "border-border/70", "shadow-surface-raised");
    expect(within(dialog).getByRole("heading", { name: "订阅" })).toBeInTheDocument();
    expect(await within(dialog).findByText("本周用量")).toBeInTheDocument();
    expect(within(dialog).queryByText("AI API")).not.toBeInTheDocument();
  });
});
