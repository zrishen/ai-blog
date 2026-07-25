import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../src/api/client", () => ({
  getLLMSettings: vi.fn(),
  updateLLMSettings: vi.fn(),
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => null),
}));

import { NavBar } from "../../src/components/NavBar";
import { FileProcessingProvider } from "../../src/features/file-processing/FileProcessingProvider";
import { AuthProvider } from "../../src/stores/authStore";
import { ChatProvider } from "../../src/stores/chatStore";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前路径">{location.pathname}</output>;
}

function renderNav(initialPath = "/files") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <ChatProvider>
          <FileProcessingProvider>
            <NavBar />
            <LocationProbe />
          </FileProcessingProvider>
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("NavBar 一级导航", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("展示首页、文件库和研究图谱，并根据路由切换选中态", async () => {
    const user = userEvent.setup();
    renderNav();

    const navigation = screen.getByRole("group", { name: "主导航" });
    const homeButton = within(navigation).getByRole("button", { name: "首页" });
    const filesButton = within(navigation).getByRole("button", { name: "文件库" });
    const researchButton = within(navigation).getByRole("button", { name: "研究图谱" });

    expect(navigation).not.toHaveClass("border");
    expect(homeButton).toHaveClass("h-9", "min-w-[92px]", "rounded-xl");
    expect(filesButton).toHaveAttribute("aria-current", "page");
    expect(homeButton).not.toHaveAttribute("aria-current");
    expect(researchButton).not.toHaveAttribute("aria-current");

    await user.click(researchButton);
    await waitFor(() => {
      expect(screen.getByLabelText("当前路径")).toHaveTextContent("/research");
      expect(researchButton).toHaveAttribute("aria-current", "page");
    });

    await user.click(homeButton);
    await waitFor(() => {
      expect(screen.getByLabelText("当前路径")).toHaveTextContent("/");
      expect(homeButton).toHaveAttribute("aria-current", "page");
    });
  });

  it("保留品牌标识返回首页的原入口", async () => {
    const user = userEvent.setup();
    renderNav("/research");

    await user.click(screen.getByRole("button", { name: "返回首页" }));

    await waitFor(() => {
      expect(screen.getByLabelText("当前路径")).toHaveTextContent("/");
    });
  });
});
