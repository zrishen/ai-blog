export interface TocItem {
  level: number;
  text: string;
  slug: string;
}

const HEADING_RE = /^(#{2,4})\s+(.+)$/gm;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function extractHeadings(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let match: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    items.push({ level, text, slug: slugify(text) });
  }
  return items;
}
