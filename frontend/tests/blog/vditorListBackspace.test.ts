import { beforeEach, describe, expect, it } from "vitest";
import { applyBackspaceShortcut } from "../../src/features/blog/utils/vditorShortcuts";

function setupEditor(innerHTML: string): HTMLDivElement {
  document.body.innerHTML = "";
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  Object.defineProperty(editor, "isContentEditable", {
    get() { return true; },
    configurable: true,
  });
  editor.innerHTML = innerHTML;
  document.body.appendChild(editor);
  return editor;
}

function placeCursor(target: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(target, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function backspaceEvent(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("unordered list Backspace", () => {
  it("removes a single bullet with one Backspace at the start", () => {
    const editor = setupEditor("<ul data-block='0'><li><wbr>item</li></ul>");
    const item = editor.querySelector("li")!;
    placeCursor(item, 1);
    const event = backspaceEvent();

    expect(applyBackspaceShortcut(editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("p")?.textContent).toBe("item");
    expect(editor.querySelector("wbr")).toBeNull();
  });

  it("turns an empty bullet into an empty paragraph", () => {
    const editor = setupEditor("<ul data-block='0'><li><wbr></li></ul>");
    const item = editor.querySelector("li")!;
    placeCursor(item, 1);

    expect(applyBackspaceShortcut(editor, backspaceEvent())).toBe(true);
    expect(editor.innerHTML).toBe('<p data-block="0"><br></p>');
  });

  it("extracts a middle item and preserves the surrounding list items", () => {
    const editor = setupEditor(
      "<ul data-block='0'><li>before</li><li><wbr>current</li><li>after</li></ul>",
    );
    const items = editor.querySelectorAll("li");
    placeCursor(items[1], 1);

    expect(applyBackspaceShortcut(editor, backspaceEvent())).toBe(true);
    expect(Array.from(editor.children).map((node) => node.tagName)).toEqual(["UL", "P", "UL"]);
    expect(editor.querySelector("p")?.textContent).toBe("current");
    expect(Array.from(editor.querySelectorAll("ul")).map((list) => list.textContent)).toEqual(["before", "after"]);
  });

  it("keeps native text deletion when the caret is inside the item", () => {
    const editor = setupEditor("<ul data-block='0'><li>item</li></ul>");
    placeCursor(editor.querySelector("li")!.firstChild!, 2);
    const event = backspaceEvent();

    expect(applyBackspaceShortcut(editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.querySelector("ul")).not.toBeNull();
  });
});
