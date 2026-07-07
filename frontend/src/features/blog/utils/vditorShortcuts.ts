const UNORDERED_LIST_MARKERS = new Set(["-", "*", "+"]);
const INVISIBLE_TEXT_RE = /(?:\u200b|\u200c|\u200d|\u2060)/g;

function findParagraphBlock(node: Node, root: HTMLElement) {
  let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  while (element && element !== root && element.tagName !== "P") {
    element = element.parentElement;
  }
  return element && element.tagName === "P" ? element : null;
}

export function applyUnorderedListShortcut(editor: HTMLPreElement, event: KeyboardEvent) {
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
  itemElement.innerHTML = blockElement.innerHTML;
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
