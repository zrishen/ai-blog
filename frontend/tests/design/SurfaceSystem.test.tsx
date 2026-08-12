import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavItem } from "../../src/components/ui/nav-item";
import { SelectableSurface, Surface } from "../../src/components/ui/surface";

describe("shared visual system", () => {
  it("keeps the default card surface on shared tokens", () => {
    render(<Surface data-testid="surface">内容</Surface>);

    expect(screen.getByTestId("surface")).toHaveClass(
      "rounded-surface",
      "border-border/70",
      "bg-card/86",
      "shadow-surface",
    );
  });

  it("uses a neutral edge for selected interactive surfaces", () => {
    render(<SelectableSurface selected>已选中</SelectableSurface>);

    expect(screen.getByRole("button", { name: "已选中" })).toHaveClass(
      "border-border/80",
      "bg-primary/6",
      "shadow-foreground/5",
    );
    expect(screen.getByRole("button", { name: "已选中" })).not.toHaveClass("border-primary");
  });

  it("keeps top and side navigation on one active-state rule", () => {
    render(
      <>
        <NavItem state="active">顶栏入口</NavItem>
        <NavItem layout="side" state="active">侧栏入口</NavItem>
      </>,
    );

    expect(screen.getByRole("button", { name: "顶栏入口" })).toHaveClass("bg-primary/8", "rounded-control");
    expect(screen.getByRole("button", { name: "顶栏入口" })).not.toHaveClass("border-primary");
    expect(screen.getByRole("button", { name: "侧栏入口" })).toHaveClass("border-border/80", "rounded-control");
  });
});
