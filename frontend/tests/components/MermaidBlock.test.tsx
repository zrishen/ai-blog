import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const mermaidRender = vi.fn();
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: mermaidRender },
}));

import { MermaidBlock } from "@/components/MermaidBlock";

describe("MermaidBlock", () => {
  beforeEach(() => mermaidRender.mockReset());

  it("渲染成功时注入 mermaid 返回的 SVG", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg data-testid='ok'>diagram</svg>" });
    const { container } = render(<MermaidBlock code={"flowchart LR\nA-->B"} />);
    await waitFor(() => {
      expect(container.querySelector(".mermaid-chart svg")).toBeTruthy();
    });
  });

  it("render 失败时降级为源码展示", async () => {
    // render 返回非法结构，触发解构异常 → 走 catch 降级为源码（mock 自身不抛，避免 vitest 误报 unhandled）
    mermaidRender.mockResolvedValue(undefined as unknown as { svg: string });
    const { container } = render(<MermaidBlock code="not valid mermaid" />);
    await waitFor(() => {
      expect(container.querySelector("pre code")?.textContent).toContain("not valid mermaid");
    });
  });

  it("空源码不触发渲染", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg/>" });
    const { container } = render(<MermaidBlock code="   " />);
    // 防抖 setTimeout 内 trim 后为空，直接 return，不渲染 mermaid、也不显示降级
    expect(container.querySelector(".mermaid-chart")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });
});
