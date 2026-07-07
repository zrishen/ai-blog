import type { CSSProperties } from "react";

const TAG_COLORS = [
  { hue: 14, saturation: 72, lightness: 62 },
  { hue: 32, saturation: 76, lightness: 60 },
  { hue: 52, saturation: 72, lightness: 58 },
  { hue: 142, saturation: 56, lightness: 54 },
  { hue: 172, saturation: 64, lightness: 52 },
  { hue: 204, saturation: 68, lightness: 58 },
  { hue: 235, saturation: 60, lightness: 66 },
  { hue: 268, saturation: 58, lightness: 64 },
  { hue: 318, saturation: 60, lightness: 62 },
  { hue: 354, saturation: 64, lightness: 62 },
];

function hashText(text: string) {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function splitBlogTags(tags?: string, limit = Number.POSITIVE_INFINITY) {
  const values = tags?.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) ?? [];
  return values.slice(0, limit);
}

export function getBlogTagStyle(tag: string): CSSProperties {
  const color = TAG_COLORS[hashText(tag) % TAG_COLORS.length];
  const base = `${color.hue} ${color.saturation}% ${color.lightness}%`;
  return {
    backgroundColor: `hsl(${base} / 0.12)`,
    borderColor: `hsl(${base} / 0.28)`,
    color: `hsl(${base})`,
  };
}
