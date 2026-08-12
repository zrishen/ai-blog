import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom/vitest";
import { MobileDrawer } from "../../src/components/MobileDrawer";

const WIDTH = 1024;
const touchAt = (x: number, y = 200) => ({ clientX: x, clientY: y });

function renderDrawer({ open = false, side = "left" as const }) {
  const onOpenChange = vi.fn();
  render(
    <MobileDrawer open={open} side={side} title="抽屉" onOpenChange={onOpenChange}>
      <div>内容</div>
    </MobileDrawer>,
  );
  return onOpenChange;
}

describe("MobileDrawer 跟随手指手势", () => {
  beforeEach(() => {
    window.innerWidth = WIDTH;
  });

  it("关闭态：左缘向内拖出打开左侧抽屉", () => {
    const onOpenChange = renderDrawer({ open: false, side: "left" });
    fireEvent.touchStart(window, { touches: [touchAt(8)] });
    fireEvent.touchMove(window, { touches: [touchAt(300)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(300)] });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("关闭态：右缘向内拖出打开右侧抽屉", () => {
    const onOpenChange = renderDrawer({ open: false, side: "right" });
    fireEvent.touchStart(window, { touches: [touchAt(WIDTH - 8)] });
    fireEvent.touchMove(window, { touches: [touchAt(WIDTH - 300)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(WIDTH - 300)] });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("关闭态：中部起点不触发（避让中栏横向滚动）", () => {
    const onOpenChange = renderDrawer({ open: false, side: "left" });
    fireEvent.touchStart(window, { touches: [touchAt(400)] });
    fireEvent.touchMove(window, { touches: [touchAt(700)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(700)] });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("打开态：从面板向屏外拖过半关闭", () => {
    const onOpenChange = renderDrawer({ open: true, side: "left" });
    fireEvent.touchStart(window, { touches: [touchAt(300)] });
    fireEvent.touchMove(window, { touches: [touchAt(50)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(50)] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("拖动未过半则回弹，不切换状态", () => {
    const onOpenChange = renderDrawer({ open: false, side: "left" });
    fireEvent.touchStart(window, { touches: [touchAt(8)] });
    fireEvent.touchMove(window, { touches: [touchAt(30)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(30)] });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("纵向为主的滑动不触发（不干扰页面滚动）", () => {
    const onOpenChange = renderDrawer({ open: false, side: "left" });
    fireEvent.touchStart(window, { touches: [touchAt(8, 100)] });
    fireEvent.touchMove(window, { touches: [touchAt(20, 400)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(20, 400)] });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("swipeEnabled=false 时不响应边缘滑动（另一抽屉打开时避让）", () => {
    const onOpenChange = vi.fn();
    render(
      <MobileDrawer open={false} side="left" title="抽屉" onOpenChange={onOpenChange} swipeEnabled={false}>
        <div>内容</div>
      </MobileDrawer>,
    );
    fireEvent.touchStart(window, { touches: [touchAt(8)] });
    fireEvent.touchMove(window, { touches: [touchAt(300)] });
    fireEvent.touchEnd(window, { changedTouches: [touchAt(300)] });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
