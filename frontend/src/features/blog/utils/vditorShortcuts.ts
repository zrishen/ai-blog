const UNORDERED_LIST_MARKERS = new Set(["-", "*", "+"]);
const INVISIBLE_TEXT_RE = /(?:\u200b|\u200c|\u200d|\u2060)/g;
const HEADING_TAG_RE = /^H[1-6]$/;
// 保留编辑器实际写入的不可见占位符字面值，避免改变匹配行为。
// eslint-disable-next-line no-misleading-character-class
const WHITESPACE_RE = /[\s\u200b\u200c\u200d\u2060]/g;

function findParagraphBlock(node: Node, root: HTMLElement) {
  let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  while (element && element !== root && element.tagName !== "P") {
    element = element.parentElement;
  }
  return element && element.tagName === "P" ? element : null;
}

export function applyUnorderedListShortcut(editor: HTMLElement, event: KeyboardEvent) {
  if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) {
    return false;
  }

  if (!editor.isContentEditable) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;

  const blockElement = findParagraphBlock(range.startContainer, editor);
  if (!blockElement) return false;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(blockElement);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeText = beforeRange.toString().replace(INVISIBLE_TEXT_RE, "");
  if (!UNORDERED_LIST_MARKERS.has(beforeText)) return false;

  event.preventDefault();

  const deleteRange = document.createRange();
  deleteRange.selectNodeContents(blockElement);
  deleteRange.setEnd(range.startContainer, range.startOffset);
  deleteRange.deleteContents();

  const wbr = document.createElement("wbr");
  range.insertNode(wbr);

  const listElement = document.createElement("ul");
  listElement.setAttribute("data-block", "0");
  const itemElement = document.createElement("li");
  while (blockElement.firstChild) {
    itemElement.appendChild(blockElement.firstChild);
  }
  listElement.appendChild(itemElement);
  blockElement.replaceWith(listElement);

  const nextRange = document.createRange();
  nextRange.setStartAfter(wbr);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);

  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function isPlainEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter"
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    && !event.isComposing;
}

function findAncestorHeading(node: Node, root: HTMLElement): HTMLElement | null {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
  while (el && el !== root) {
    if (HEADING_TAG_RE.test(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

function isAtBlockStart(range: Range, block: HTMLElement): boolean {
  if (!range.collapsed) return false;
  const before = range.cloneRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().replace(WHITESPACE_RE, "") === "";
}

function isEmptyParagraph(el: Element | null | undefined): el is HTMLParagraphElement {
  if (!el || el.tagName !== "P") return false;
  const text = (el.textContent || "").replace(WHITESPACE_RE, "");
  if (text.length > 0) return false;
  const hasNonBrChild = Array.from(el.children).some((c) => c.tagName !== "BR" && c.tagName !== "WBR");
  return !hasNonBrChild;
}

function insertBlankParagraph(reference: HTMLElement, position: InsertPosition): void {
  const p = document.createElement("p");
  p.setAttribute("data-block", "0");
  p.textContent = "​";
  reference.insertAdjacentElement(position, p);
  const range = document.createRange();
  range.setStart(p, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function applyEnterShortcuts(editor: HTMLElement, event: KeyboardEvent): boolean {
  if (!isPlainEnter(event)) return false;
  if (!editor.isContentEditable) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;

  const heading = findAncestorHeading(range.startContainer, editor);
  if (heading && isAtBlockStart(range, heading)) {
    event.preventDefault();
    const p = document.createElement("p");
    p.setAttribute("data-block", "0");
    p.textContent = "​";
    heading.insertAdjacentElement("beforebegin", p);
    return true;
  }

  const startEl = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : (range.startContainer as HTMLElement | null);
  const p = startEl?.closest?.("p") ?? null;
  if (isEmptyParagraph(p) && editor.contains(p)) {
    event.preventDefault();
    insertBlankParagraph(p, "afterend");
    return true;
  }

  return false;
}

function isPlainBackspace(event: KeyboardEvent): boolean {
  return event.key === "Backspace"
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    && !event.isComposing;
}

function findAncestorListItem(node: Node, root: HTMLElement): HTMLLIElement | null {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
  while (el && el !== root) {
    if (el.tagName === "LI") return el as HTMLLIElement;
    el = el.parentElement;
  }
  return null;
}

function moveListItemToParagraph(editor: HTMLElement, item: HTMLLIElement): boolean {
  const list = item.parentElement;
  if (!list || list.tagName !== "UL" || !editor.contains(list)) return false;

  const paragraph = document.createElement("p");
  paragraph.setAttribute("data-block", list.getAttribute("data-block") ?? "0");
  while (item.firstChild) paragraph.appendChild(item.firstChild);
  paragraph.querySelectorAll("wbr").forEach((node) => node.remove());
  if (!paragraph.hasChildNodes()) paragraph.appendChild(document.createElement("br"));

  const items = Array.from(list.children);
  const followingItems = items.slice(items.indexOf(item) + 1);
  if (followingItems.length === 0) {
    list.insertAdjacentElement("afterend", paragraph);
  } else {
    const trailingList = list.cloneNode(false) as HTMLUListElement;
    followingItems.forEach((followingItem) => trailingList.appendChild(followingItem));
    list.insertAdjacentElement("afterend", paragraph);
    paragraph.insertAdjacentElement("afterend", trailingList);
  }
  item.remove();
  if (!list.children.length) list.remove();

  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.setStart(paragraph, 0);
  nextRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

export function applyBackspaceShortcut(editor: HTMLElement, event: KeyboardEvent): boolean {
  if (!isPlainBackspace(event)) return false;
  if (!editor.isContentEditable) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;

  const listItem = findAncestorListItem(range.startContainer, editor);
  if (listItem?.parentElement?.tagName === "UL" && isAtBlockStart(range, listItem)) {
    event.preventDefault();
    return moveListItemToParagraph(editor, listItem);
  }

  const heading = findAncestorHeading(range.startContainer, editor);
  if (!heading || !isAtBlockStart(range, heading)) return false;

  const prev = heading.previousElementSibling;
  if (!prev || !isEmptyParagraph(prev)) return false;

  event.preventDefault();
  prev.remove();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
