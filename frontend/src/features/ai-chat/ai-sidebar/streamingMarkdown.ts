const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * 流式渲染时把"未闭合的表格头"从末尾剥掉，避免 react-markdown 把 `| col1 | col2 |`
 * 这种单行表格头当成普通段落渲染，从而暴露 Markdown 源码字符。
 *
 * 规则：
 * - 从文本末尾向前找连续的表格行块
 * - 如果块里没有 separator 行（|---|---|），整块都剥掉
 * - 如果块里有 separator，保留整块（react-markdown 会渲染成空 body 表格 + 后续数据行）
 * - 代码块（``` / ~~~）内的内容不处理；遇到未闭合的 fence 也不剥
 */
export function maskStreamingMarkdown(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");

  // 跨过未闭合的 fenced code：如果整个文本有奇数个 fence 行，说明末尾在代码块内，原样返回
  let fenceCount = 0;
  for (const line of lines) {
    if (FENCE_RE.test(line)) fenceCount++;
  }
  if (fenceCount % 2 === 1) return text;

  // 从末尾往前找连续表格行块
  const blockEnd = lines.length;
  let blockStart = blockEnd;
  while (blockStart > 0 && TABLE_ROW_RE.test(lines[blockStart - 1])) {
    blockStart--;
  }

  if (blockStart === blockEnd) return text;

  const block = lines.slice(blockStart, blockEnd);
  const hasSeparator = block.some((line) => TABLE_SEPARATOR_RE.test(line));
  if (hasSeparator) return text;

  // 未闭合——剥掉整块。直接基于原文本截断，保留块前的换行/空行结构。
  let cutPos = 0;
  for (let i = 0; i < blockStart; i++) {
    cutPos += lines[i].length + 1; // 行内容 + 该行末尾的 \n
  }
  return text.slice(0, cutPos);
}
