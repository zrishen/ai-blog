export type DragSource = { kind: "cat" | "file"; id: number };

export function parseDragSource(data: string): DragSource | null {
  if (!data) return null;
  if (data.startsWith("cat:")) {
    const id = Number(data.slice(4));
    return Number.isFinite(id) && id > 0 ? { kind: "cat", id } : null;
  }
  if (data.startsWith("file:")) {
    const id = Number(data.slice(5));
    return Number.isFinite(id) && id > 0 ? { kind: "file", id } : null;
  }
  const legacyId = Number(data);
  return Number.isFinite(legacyId) && legacyId > 0
    ? { kind: "cat", id: legacyId }
    : null;
}
