import type { ResearchTopicDetail } from "../../../api/client";

export function formatDate(dateStr?: string | null) {
  if (!dateStr) return "未检查";
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    researching: "研究中",
    reviewing: "待审核",
    ready: "已确认",
    stale: "可能过期",
    archived: "已归档",
    pending: "待审核",
    supported: "已支持",
    conflicting: "有冲突",
    rejected: "已拒绝",
  };
  return labels[status] ?? status;
}

export function sourceTypeLabel(type: string) {
  const labels: Record<string, string> = {
    official: "官方",
    media: "媒体",
    paper: "论文",
    blog: "博客",
    forum: "论坛",
    social: "社交",
    knowledge_base: "知识库",
    mcp_result: "MCP",
    manual: "手动",
  };
  return labels[type] ?? type;
}

export function trustLabel(level: string) {
  const labels: Record<string, string> = {
    high: "高可信",
    medium: "中可信",
    low: "低可信",
    unknown: "待评估",
  };
  return labels[level] ?? level;
}

export function statusTone(status: string) {
  if (["supported", "ready", "approved", "applied"].includes(status)) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (["conflicting", "stale", "rejected", "failed"].includes(status)) return "border-destructive/25 bg-destructive/10 text-destructive";
  return "border-primary/20 bg-primary/10 text-primary";
}

export const RESEARCH_TABS = [
  ["overview", "概览"],
  ["process", "过程"],
  ["claims", "事实"],
  ["sources", "来源"],
  ["conflicts", "冲突"],
  ["graph", "图谱"],
  ["proposals", "提案"],
] as const;

export type ResearchTabKey = (typeof RESEARCH_TABS)[number][0];

export function isResearchTabKey(value: string | null): value is ResearchTabKey {
  return RESEARCH_TABS.some(([key]) => key === value);
}

export type ProposalConflictSummary = {
  between: string;
  reason: string;
};

export function numberArrayField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

export function numberField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : null;
}

export function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export function conflictField(payload: Record<string, unknown>) {
  const value = payload.conflicts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProposalConflictSummary[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const between = stringField(record, "between");
    const reason = stringField(record, "reason");
    return between || reason ? [{ between, reason }] : [];
  });
}

export function proposalOneLineSummary(payload?: Record<string, unknown> | null) {
  if (!payload) return "暂无结构化摘要";
  const parts = [
    numberArrayField(payload, "new_sources").length ? `新增来源 ${numberArrayField(payload, "new_sources").length} 个` : null,
    numberArrayField(payload, "new_claims").length ? `新增事实 ${numberArrayField(payload, "new_claims").length} 条` : null,
    numberField(payload, "new_relations") !== null ? `新增关系 ${numberField(payload, "new_relations")} 条` : null,
    conflictField(payload).length ? `冲突 ${conflictField(payload).length} 个` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "包含系统更新明细";
}

export type ResearchTopicClaim = ResearchTopicDetail["claims"][number];
export type ResearchTopicSource = ResearchTopicDetail["sources"][number];
export type ResearchTopicEvidence = ResearchTopicDetail["evidence"][number];
export type ResearchTopicProposal = ResearchTopicDetail["proposals"][number];
export type ResearchTopicRelation = ResearchTopicDetail["relations"][number];

export type ConflictPair = {
  relation: ResearchTopicRelation;
  fromClaim?: ResearchTopicClaim;
  toClaim?: ResearchTopicClaim;
  resolved: boolean;
  acceptedClaimId: number | null;
  rejectedClaimId: number | null;
};
