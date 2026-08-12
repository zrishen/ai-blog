import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";

import { installCodeLanguageMenu } from "../../src/features/blog/utils/vditorMenus";

import type Vditor from "vditor";

// jsdom 下 getBoundingClientRect 默认全 0,且 vitest 关闭了 CSS(css:false),
// 这里用一个统一 mock 模拟「滚动位置」:代码块顶部随 scrollY 上移,trigger/menu 这类
// fixed 元素按其内联 style.top/left 取值,display:none 时返回全 0(贴近真实浏览器)。
interface FakeRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  x: number;
  y: number;
  toJSON: () => Record<string, number>;
}
const makeRect = (top: number, left: number, width: number, height: number): FakeRect => ({
  top,
  left,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({} as Record<string, number>),
});

function buildEditor() {
  document.body.innerHTML = `
    <div class="vditor">
      <div class="vditor-content">
        <div class="vditor-wysiwyg">
          <div class="vditor-wysiwyg__block" data-type="code-block"><pre><code>print(1)</code></pre></div>
        </div>
      </div>
    </div>
  `;
  return {
    editor: {
      vditor: {
        element: document.querySelector(".vditor"),
        wysiwyg: { element: document.querySelector(".vditor-wysiwyg") },
      },
    } as unknown as Vditor,
    scrollContainer: document.querySelector(".vditor-content") as HTMLElement,
  };
}

describe("installCodeLanguageMenu 滚动行为", () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let cleanup: (() => void) | undefined;
  let scrollY = 0;
  const BLOCK_TOP = 300;

  beforeEach(() => {
    scrollY = 0;
    // 预置 hljs,让 loadHighlightJs 立即 resolve,避免在 jsdom 里拉取 vditor 内置脚本
    Object.defineProperty(window, "hljs", {
      value: { highlight: (code: string) => ({ value: code }), getLanguage: () => true },
      configurable: true,
      writable: true,
    });
    rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: unknown) {
      if (!(this instanceof HTMLElement)) return makeRect(0, 0, 0, 0);
      if (this.classList.contains("vditor-content")) return makeRect(0, 0, 800, 600);
      if (this.classList.contains("vditor-wysiwyg__block")) return makeRect(BLOCK_TOP - scrollY, 50, 700, 200);
      const top = parseFloat(this.style.top || "0") || 0;
      const left = parseFloat(this.style.left || "0") || 0;
      if (this.style.display === "none") return makeRect(0, 0, 0, 0);
      if (this.classList.contains("blog-editor-code-language-trigger")) return makeRect(top, left, 60, 24);
      if (this.classList.contains("blog-editor-code-language-menu")) return makeRect(top, left, 192, 300);
      return makeRect(top, left, 200, 200);
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    rectSpy.mockRestore();
    document.body.innerHTML = "";
    (window as { hljs?: unknown }).hljs = undefined;
  });

  const openMenu = async () => {
    const { editor, scrollContainer } = buildEditor();
    cleanup = installCodeLanguageMenu(editor);
    await waitFor(() => {
      if (!document.querySelector(".blog-editor-code-language-trigger")) throw new Error("trigger 未挂载");
    });
    const trigger = document.querySelector(".blog-editor-code-language-trigger") as HTMLElement;
    trigger.click();
    const menu = document.querySelector(".blog-editor-code-language-menu") as HTMLElement;
    expect(menu.style.display).toBe("block");
    return { scrollContainer, menu };
  };

  it("菜单跟随代码块:可视区内跟随移动,滚出可视区时隐藏,滑回自动重现", async () => {
    const { scrollContainer, menu } = await openMenu();
    const topBefore = menu.style.top;

    // 可视区内滚动 → 菜单跟随移动且保持可见
    scrollY = 120;
    scrollContainer.dispatchEvent(new Event("scroll"));
    expect(menu.style.top).not.toBe(topBefore);
    expect(menu.style.display).toBe("block");

    // 代码块滚出可视区顶部 → 菜单视觉隐藏(保持打开状态,不真正关闭)
    scrollY = BLOCK_TOP + 50;
    scrollContainer.dispatchEvent(new Event("scroll"));
    expect(menu.style.display).toBe("none");

    // 滑回可视区 → 菜单自动重现
    scrollY = 120;
    scrollContainer.dispatchEvent(new Event("scroll"));
    expect(menu.style.display).toBe("block");
  });

  it("hljs 加载挂起时,语言标签按钮仍能挂载(挂载不依赖高亮库)", async () => {
    // 模拟 hljs 脚本加载永久挂起:不预置 window.hljs,并拦截 script 创建使其不触发 load/error。
    // 修复前 initAll 会 `await loadHighlightJs()` 卡住 → trigger 永不挂载(间歇性丢失);
    // 修复后 initAll 不再阻塞,trigger 立即挂载,高亮由 renderHighlightOverlay 按需异步加载。
    (window as { hljs?: unknown }).hljs = undefined;
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag.toLowerCase() === "script") {
        // 吞掉 src 赋值且不触发 load/error → loadHighlightJs 的 await 永久挂起
        Object.defineProperty(el, "src", { configurable: true, set() {}, get() { return ""; } });
      }
      return el;
    });

    try {
      const { editor } = buildEditor();
      cleanup = installCodeLanguageMenu(editor);
      await waitFor(() => {
        if (!document.querySelector(".blog-editor-code-language-trigger")) throw new Error("trigger 未挂载");
      });
      expect(document.querySelector(".blog-editor-code-language-trigger")).toBeTruthy();
    } finally {
      createSpy.mockRestore();
    }
  });
});
