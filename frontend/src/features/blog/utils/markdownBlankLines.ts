const ZWSP = "​";

// 判断 DOM 空白段落时允许任意空白（含换行/制表符）+ 零宽占位符，仅用于 textContent 判空。
// eslint-disable-next-line no-irregular-whitespace, no-misleading-character-class
const BLANK_WS_RE = /[\s​‌‍⁠]/g;
// 仅清理零宽占位符（ZWSP/ZWNJ/ZWJ/Word Joiner）。绝不能包含 \s：否则会删除正文里的普通空格、
// 制表符和换行，导致英文单词粘连、标题/列表/代码块结构被压扁破坏。
// eslint-disable-next-line no-irregular-whitespace, no-misleading-character-class
const STRIP_INVISIBLE_RE = /[​‌‍⁠]/g;

export function expandBlankLines(md: string): string {
  return md.replace(/\n{3,}/g, (m) => "\n\n" + `${ZWSP}\n\n`.repeat(m.length - 2));
}

export function preserveBlankLines(resetEl: HTMLElement | null | undefined, markdown: string): string {
  if (!resetEl) return markdown;

  const domBlocks = Array.from(resetEl.children) as HTMLElement[];
  const isBlankP = (el: HTMLElement) =>
    el.tagName === "P" && (el.textContent || "").replace(BLANK_WS_RE, "").length === 0;
  if (!domBlocks.some(isBlankP)) return markdown;

  const normalizedMd = markdown.replace(STRIP_INVISIBLE_RE, "").replace(/\n{3,}/g, "\n\n");
  const segments = normalizedMd.split(/\n{2,}/);
  let out = "";
  let segIdx = 0;
  let pendingBlank = 0;
  for (const block of domBlocks) {
    if (isBlankP(block)) {
      pendingBlank++;
      continue;
    }
    if (segIdx >= segments.length) break;
    out = out === ""
      ? segments[segIdx]
      : `${out}\n\n${"\n".repeat(pendingBlank)}${segments[segIdx]}`;
    segIdx++;
    pendingBlank = 0;
  }
  if (pendingBlank > 0) out += "\n".repeat(pendingBlank);
  return out;
}
