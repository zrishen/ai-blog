/** 根据当前选区计算所属章节序号（1-based，按所有 heading 出现顺序）。
 *
 * 用于右键 AI 修改时把 section_index 传给后端 blog_edit_post，
 * 让精准替换可以限定在单章节内，避免全文重复被拒绝。
 *
 * - 容器可以是 Vditor WYSIWYG 元素，也可以是 react-markdown 渲染的 .prose 节点。
 * - 没有选区、没有 heading 或选区在所有 heading 之前时返回 0。
 */
export function getSectionIndexFromSelection(container: HTMLElement | null): number {
  if (!container) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const startNode = range.startContainer;
  const headings = Array.from(
    container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  let sectionIdx = 0;
  for (const heading of headings) {
    const rel = heading.compareDocumentPosition(startNode);
    if (rel & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) {
      sectionIdx++;
    } else {
      break;
    }
  }
  return sectionIdx;
}
