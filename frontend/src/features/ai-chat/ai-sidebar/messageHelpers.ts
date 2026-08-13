import type { Reference } from "@/types/chat";

import { formatMonthDay, parseDate } from "@/lib/datetime";

export function formatDate(dateStr: string): string {
  const d = parseDate(dateStr);
  if (!d) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 172800000) return "昨天";
  return formatMonthDay(dateStr);
}

function dedupeReferences(refs: Reference[]): Reference[] {
  return [
    ...new Map(
      refs.map((r) => {
        const key = r.type === "rag" ? `rag:${r.source}` : `mcp:${r.server}/${r.tool}`;
        return [key, r];
      }),
    ).values(),
  ];
}

export function collectMessageReferences(toolEvents: { type: string; references?: Reference[] }[] | undefined): Reference[] {
  const all = (toolEvents || [])
    .filter((e) => e.type === "end" && e.references?.length)
    .flatMap((e) => e.references || []);
  return dedupeReferences(all);
}
