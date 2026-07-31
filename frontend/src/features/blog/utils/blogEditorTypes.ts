export const DEFAULT_COVERS = Array.from(
  { length: 10 },
  (_, index) => `/blog-covers/cover-${String(index + 1).padStart(2, "0")}.svg`,
);

export function recordString(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === "string" ? value : "";
}

export function recordNumber(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === "number" ? value : null;
}
