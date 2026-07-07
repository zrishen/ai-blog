export function generateExcerpt(markdown: string): string {
  const text = markdown
    .replace(/^#+\s.+$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`>[]!|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= 128 ? text : text.substring(0, 128) + "…";
}
