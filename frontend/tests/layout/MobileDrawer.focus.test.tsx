import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MobileDrawer } from "../../src/components/MobileDrawer";

// 复现真实接线：App.tsx 传给 MobileDrawer 的 onOpenChange 是内联箭头函数，身份每次渲染都变。
function Harness() {
  const [open, setOpen] = useState(true);
  const [, setTick] = useState(0);
  return (
    <>
      <button onClick={() => setTick((t) => t + 1)}>rerender</button>
      <MobileDrawer open={open} side="right" title="AI" onOpenChange={(v) => setOpen(v)}>
        <input data-testid="child-input" />
      </MobileDrawer>
    </>
  );
}

describe("MobileDrawer 焦点稳定", () => {
  it("打开后父组件重渲染不会抢走子输入框焦点（打字不收键盘）", () => {
    render(<Harness />);
    const input = screen.getByTestId("child-input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // 模拟在 AI 输入框打字 → dispatch 触发上层 store 更新 → 父组件重渲染（onOpenChange 换新身份）。
    // 修复前：MobileDrawer effect 依赖 onOpenChange，会重跑并 panelRef.focus() 抢走焦点。
    fireEvent.click(screen.getByText("rerender"));

    expect(document.activeElement).toBe(input);
  });
});
