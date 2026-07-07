import { AlertCircle, FileSearch, Search, ShieldCheck, XCircle, Zap, type LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";

export const STAGE_KEYS = [
  "search_sources",
  "fetch_pages",
  "extract_claims",
  "detect_conflicts",
  "await_review",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  search_sources: "搜索来源",
  fetch_pages: "抓取页面",
  extract_claims: "提取事实",
  detect_conflicts: "检测冲突",
  await_review: "等待审核",
};

export const STAGE_ICONS: Record<StageKey, LucideIcon> = {
  search_sources: Search,
  fetch_pages: FileSearch,
  extract_claims: Zap,
  detect_conflicts: AlertCircle,
  await_review: ShieldCheck,
};

export interface OperationLog {
  ts: string;
  type: "tool" | "thinking";
  tool?: string;
  action: string;
  detail: string;
  status: "ok" | "error" | "info";
}

export const LOG_STATUS_ICON: Record<OperationLog["status"], LucideIcon> = {
  ok: CheckCircle2,
  error: XCircle,
  info: Search,
};

export interface StageProgressItem {
  key: StageKey;
  label: string;
  done: boolean;
  current: boolean;
}

export function formatTime(dateStr?: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function getStageProgress(progress: Record<string, unknown>): StageProgressItem[] {
  let foundCurrent = false;
  const activeKey = STAGE_KEYS.find((key) => {
    const val = progress[key];
    return val === "running" || val === "processing" || val === "started";
  });

  return STAGE_KEYS.map((key) => {
    const val = progress[key];
    const done = val === true || val === "done" || val === "completed";
    const current = !done && (activeKey ? key === activeKey : !foundCurrent);
    if (current) foundCurrent = true;
    return { key, label: STAGE_LABELS[key], done, current };
  });
}

export function getStageLogs(progress: Record<string, unknown>, stageKey: StageKey): OperationLog[] {
  const raw = progress[`${stageKey}_log`];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is OperationLog => (
      typeof item === "object" && item !== null &&
      typeof item.ts === "string" && typeof item.action === "string"
    ))
    .slice(-50);
}
