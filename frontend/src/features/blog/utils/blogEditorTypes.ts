export interface DraftInfo {
  id: number;
  title: string;
  time: string;
}

export const DEFAULT_COVERS = Array.from(
  { length: 10 },
  (_, index) => `/blog-covers/cover-${String(index + 1).padStart(2, "0")}.svg`,
);

export function formatSaveTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDraftTime(dateStr: string) {
  if (!dateStr) return "未知时间";
  return new Date(dateStr).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function recordString(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === "string" ? value : "";
}

export function recordNumber(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === "number" ? value : null;
}
