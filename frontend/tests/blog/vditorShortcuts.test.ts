import { describe, it, expect, beforeEach } from "vitest";

import { applyBackspaceShortcut, applyEnterShortcuts, applyUnorderedListShortcut } from "../../src/features/blog/utils/vditorShortcuts";

const ZWSP = "​";

function setupEditor(innerHTML: string, editable = true): HTMLDivElement {
  document.body.innerHTML = "";
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", editable ? "true" : "false");
  // jsdom 不支持 isContentEditable,这里模拟真实浏览器行为
  Object.defineProperty(editor, "isContentEditable", {
    get() { return editable; },
    configurable: true,
  });
  editor.innerHTML = innerHTML;
  document.body.appendChild(editor);
  return editor;
}

function placeCursor(target: Node, offset: number): Range {
  const range = document.createRange();
  range.setStart(target, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function keyEvent(key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean }> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: !!mods.shiftKey,
    ctrlKey: !!mods.ctrlKey,
    metaKey: !!mods.metaKey,
    altKey: !!mods.altKey,
    isComposing: !!mods.isComposing,
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("applyUnorderedListShortcut", () => {
  it("非空格键不触发", () => {
    const editor = setupEditor("<p data-block='0'>- </p>");
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 2);
    const result = applyUnorderedListShortcut(editor as unknown as HTMLPreElement, keyEvent("Enter"));
    expect(result).toBe(false);
    expect(editor.innerHTML).toContain("<p data-block=\"0\">- </p>");
  });

  it("带修饰键(Shift/Ctrl/Meta/Alt)不触发", () => {
    const editor = setupEditor("<p data-block='0'>- </p>");
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 2);
    for (const mod of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
      const event = keyEvent(" ", { [mod]: true });
      expect(applyUnorderedListShortcut(editor as unknown as HTMLPreElement, event)).toBe(false);
    }
  });

  it("isComposing 不触发", () => {
    const editor = setupEditor("<p data-block='0'>- </p>");
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 2);
    const event = keyEvent(" ", { isComposing: true });
    expect(applyUnorderedListShortcut(editor as unknown as HTMLPreElement, event)).toBe(false);
  });

  it("editor 不可编辑时不触发", () => {
    const editor = setupEditor("<p data-block='0'>- </p>", false);
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 2);
    const event = keyEvent(" ");
    expect(applyUnorderedListShortcut(editor as unknown as HTMLPreElement, event)).toBe(false);
  });

  it("'-'/'*'/'+' + 空格触发,转成 <ul><li>", () => {
    // keydown 在空格插入前触发:此时 DOM 内是 marker,光标在 marker 后(offset=1)
    for (const marker of ["-", "*", "+"]) {
      const editor = setupEditor(`<p data-block='0'>${marker}</p>`);
      const p = editor.querySelector("p")!;
      placeCursor(p.firstChild!, 1);
      const event = keyEvent(" ");
      const result = applyUnorderedListShortcut(editor as unknown as HTMLPreElement, event);
      expect(result).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      const ul = editor.querySelector("ul");
      expect(ul).not.toBeNull();
      expect(ul!.getAttribute("data-block")).toBe("0");
      const li = ul!.querySelector("li");
      expect(li).not.toBeNull();
      const caretAnchor = li!.querySelector("wbr");
      expect(caretAnchor).not.toBeNull();
      expect(caretAnchor!.isConnected).toBe(true);
      const selection = window.getSelection()!;
      expect(selection.anchorNode).toBe(li);
      expect(selection.anchorOffset).toBe(Array.from(li!.childNodes).indexOf(caretAnchor!) + 1);
    }
  });

  it("普通文本 + 空格不触发", () => {
    const editor = setupEditor("<p data-block='0'>普通文字</p>");
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 4);
    const event = keyEvent(" ");
    expect(applyUnorderedListShortcut(editor as unknown as HTMLPreElement, event)).toBe(false);
    expect(editor.querySelector("ul")).toBeNull();
  });
});

describe("applyEnterShortcuts - 标题分支", () => {
  it("非 Enter 不处理", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyEnterShortcuts(editor, keyEvent("Backspace"))).toBe(false);
  });

  it("Shift/Ctrl/Meta/Alt + Enter 不处理", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    for (const mod of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
      expect(applyEnterShortcuts(editor, keyEvent("Enter", { [mod]: true }))).toBe(false);
    }
  });

  it("isComposing 不处理", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyEnterShortcuts(editor, keyEvent("Enter", { isComposing: true }))).toBe(false);
  });

  it("editor 不可编辑时不处理", () => {
    const editor = setupEditor("<h2>标题</h2>", false);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyEnterShortcuts(editor, keyEvent("Enter"))).toBe(false);
  });

  it("H2 行首 Enter: preventDefault + 前插 ZWSP 段,H2 数量保持 1", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event = keyEvent("Enter");
    const result = applyEnterShortcuts(editor, event);
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelectorAll("h2").length).toBe(1);
    expect(editor.querySelector("h2")?.textContent).toBe("标题");
    const insertedP = editor.querySelector("p");
    expect(insertedP).not.toBeNull();
    expect(insertedP!.getAttribute("data-block")).toBe("0");
    expect(insertedP!.textContent).toBe(ZWSP);
  });

  it("H3 行首 Enter 同样拦截", () => {
    const editor = setupEditor("<h3>子标题</h3>");
    const h3 = editor.querySelector("h3")!;
    placeCursor(h3.firstChild!, 0);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelectorAll("h3").length).toBe(1);
    expect(editor.querySelector("p")?.textContent).toBe(ZWSP);
  });

  it("H2 中间 Enter 不拦截(让 Vditor 默认拆分)", () => {
    const editor = setupEditor("<h2>标题文字</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 2);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.querySelectorAll("h2").length).toBe(1);
    expect(editor.querySelector("p")).toBeNull();
  });

  it("H2 末尾 Enter 不拦截", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    const text = h2.firstChild!;
    placeCursor(text, text.textContent!.length);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("标题前有内容时,H2 行首 Enter 也只产生 1 个 H2", () => {
    const editor = setupEditor("<p data-block='0'>段落</p><h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(true);
    expect(editor.querySelectorAll("h2").length).toBe(1);
    expect(editor.querySelectorAll("p").length).toBe(2);
  });

  it("连按两次(模拟):第一次插入 ZWSP 段后,若光标仍命中标题行首,不会新增 H2", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event1 = keyEvent("Enter");
    applyEnterShortcuts(editor, event1);
    expect(editor.querySelectorAll("h2").length).toBe(1);

    placeCursor(h2.firstChild!, 0);
    const event2 = keyEvent("Enter");
    applyEnterShortcuts(editor, event2);
    expect(editor.querySelectorAll("h2").length).toBe(1);
    expect(editor.querySelectorAll("p").length).toBe(2);
  });
});

describe("applyEnterShortcuts - 空段落分支", () => {
  it("完全空 p 内 Enter: 插入新空 p 到后面", () => {
    const editor = setupEditor("<p data-block='0'> </p>");
    const p = editor.querySelector("p")!;
    placeCursor(p, 0);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(2);
  });

  it("ZWSP 内容的 p 也算空段落", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p>`);
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 1);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(2);
  });

  it("含 BR 的 p 也算空段落", () => {
    const editor = setupEditor("<p data-block='0'><br></p>");
    const p = editor.querySelector("p")!;
    placeCursor(p, 0);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(2);
  });

  it("有内容的 p 内 Enter 不拦截", () => {
    const editor = setupEditor("<p data-block='0'>普通段落文字</p>");
    const p = editor.querySelector("p")!;
    placeCursor(p.firstChild!, 3);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(false);
    expect(editor.querySelectorAll("p").length).toBe(1);
  });
});

describe("applyEnterShortcuts - 选区与光标位置边界", () => {
  it("选区未折叠(有选区)不处理", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    const text = h2.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(false);
  });

  it("光标不在 editor 内不处理", () => {
    const editor = setupEditor("<h2>标题</h2>");
    document.body.innerHTML += "<div id='outside' contenteditable='true'><p>x</p></div>";
    const outside = document.getElementById("outside")!;
    const op = outside.querySelector("p")!;
    placeCursor(op.firstChild!, 1);
    const event = keyEvent("Enter");
    expect(applyEnterShortcuts(editor, event)).toBe(false);
  });
});

describe("applyBackspaceShortcut - 标题行首 Backspace", () => {
  it("非 Backspace 键不处理", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h2>标题</h2>`);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyBackspaceShortcut(editor, keyEvent("Enter"))).toBe(false);
  });

  it("Shift/Ctrl/Meta/Alt + Backspace 不处理", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h2>标题</h2>`);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    for (const mod of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
      expect(applyBackspaceShortcut(editor, keyEvent("Backspace", { [mod]: true }))).toBe(false);
    }
  });

  it("isComposing 不处理", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h2>标题</h2>`);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyBackspaceShortcut(editor, keyEvent("Backspace", { isComposing: true }))).toBe(false);
  });

  it("editor 不可编辑时不处理", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h2>标题</h2>`, false);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyBackspaceShortcut(editor, keyEvent("Backspace"))).toBe(false);
  });

  it("光标不在标题内不处理(普通段落内 Backspace)", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><p data-block='0'>正文</p>`);
    const ps = editor.querySelectorAll("p");
    placeCursor(ps[1].firstChild!, 1);
    expect(applyBackspaceShortcut(editor, keyEvent("Backspace"))).toBe(false);
  });

  it("光标在标题中间不处理(默认删除字符)", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h2>标题文字</h2>`);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 2);
    const event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("标题在最前(无前一兄弟)不处理", () => {
    const editor = setupEditor("<h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    expect(applyBackspaceShortcut(editor, keyEvent("Backspace"))).toBe(false);
  });

  it("前一兄弟是非空段落 → 不拦截,让 Vditor 默认退出标题格式", () => {
    const editor = setupEditor("<p data-block='0'>普通段落</p><h2>标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.querySelectorAll("p").length).toBe(1);
    expect(editor.querySelectorAll("h2").length).toBe(1);
  });

  it("前一兄弟是空段(ZWSP 内容) → 拦截,删除空段,保留标题", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h2>标题</h2>`);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event = keyEvent("Backspace");
    const result = applyBackspaceShortcut(editor, event);
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(0);
    expect(editor.querySelector("h2")?.textContent).toBe("标题");
  });

  it("前一兄弟是含 <br> 的空段 → 拦截删除", () => {
    const editor = setupEditor(`<p data-block='0'><br></p><h2>标题</h2>`);
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(0);
    expect(editor.querySelector("h2")?.textContent).toBe("标题");
  });

  it("前一兄弟是另一个标题(h1) → 不拦截(让默认合并)", () => {
    const editor = setupEditor("<h1>大标题</h1><h2>小标题</h2>");
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    const event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("空段在 H3 前同样生效", () => {
    const editor = setupEditor(`<p data-block='0'>${ZWSP}</p><h3>子标题</h3>`);
    const h3 = editor.querySelector("h3")!;
    placeCursor(h3.firstChild!, 0);
    const event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(0);
    expect(editor.querySelector("h3")?.textContent).toBe("子标题");
  });

  it("多次连按 Backspace:每次删一个空段,标题始终保留", () => {
    const editor = setupEditor(
      `<p data-block='0'>${ZWSP}</p><p data-block='0'>${ZWSP}</p><h2>标题</h2>`,
    );
    const h2 = editor.querySelector("h2")!;
    placeCursor(h2.firstChild!, 0);
    let event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(1);
    placeCursor(h2.firstChild!, 0);
    event = keyEvent("Backspace");
    expect(applyBackspaceShortcut(editor, event)).toBe(true);
    expect(editor.querySelectorAll("p").length).toBe(0);
    expect(editor.querySelector("h2")?.textContent).toBe("标题");
  });
});
