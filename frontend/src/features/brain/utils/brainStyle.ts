// 知识图谱边配色（react-flow SVG stroke，沿用 research graphLayout 的 hex 范式，
// 不进 tailwind 类，不受 check-design-system.mjs 约束）。
export function edgeTone(relationType: string): string {
  if (relationType === "SAME_AS") return "#a855f7"; // 紫：实体消歧/等价
  if (relationType === "SUPERSEDES") return "#f59e0b"; // 橙：事实演化
  return "#6366f1"; // 靛蓝：默认 RELATES_TO（实体关系）
}

export function entityTypeColor(entityType: string | null): string {
  const t = (entityType ?? "").toLowerCase();
  if (["person", "user", "用户", "人物"].some((k) => t.includes(k))) return "#3b82f6";
  if (["org", "company", "organization", "组织", "公司"].some((k) => t.includes(k))) return "#14b8a6";
  if (["tech", "tool", "product", "技术", "产品", "工具"].some((k) => t.includes(k))) return "#f97316";
  if (["concept", "topic", "概念", "主题"].some((k) => t.includes(k))) return "#8b5cf6";
  return "#64748b";
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    chat: "对话",
    research_event: "研究事件",
    document_ingest: "文档摄入",
  };
  return map[kind] ?? kind;
}
