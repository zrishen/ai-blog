import type { ThinkingMode } from "../../../api/chat";

export interface AISidebarProps {
  mode: "shared" | "private";
  contextText?: string;
  siteUsername?: string;
  postSlug?: string;
  pageType?: "post" | "home" | "files" | "research" | "about" | "other";
  postTitle?: string;
}

export const blogToolOperations = new Set([
  "create_post",
  "write_post",
  "edit_post",
  "delete_post",
]);

export const DEFAULT_AI_SIDEBAR_THINKING_MODE: ThinkingMode = "balanced";

export const thinkingModeLabels: Record<ThinkingMode, string> = {
  fast: "快速",
  balanced: "平衡",
  smart: "智能",
};

export function getAISidebarThinkingModeStorageKey(userId: number): string {
  return `ai-sidebar-thinking-mode:${userId}`;
}

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return value === "fast" || value === "balanced" || value === "smart";
}

export function loadAISidebarThinkingMode(userId: number): ThinkingMode {
  try {
    const stored = localStorage.getItem(getAISidebarThinkingModeStorageKey(userId));
    return isThinkingMode(stored) ? stored : DEFAULT_AI_SIDEBAR_THINKING_MODE;
  } catch {
    return DEFAULT_AI_SIDEBAR_THINKING_MODE;
  }
}

export function saveAISidebarThinkingMode(userId: number, mode: ThinkingMode): void {
  try {
    localStorage.setItem(getAISidebarThinkingModeStorageKey(userId), mode);
  } catch {
    // 本地存储不可用时仍保留当前会话内的选择。
  }
}

export const RESEARCH_TOOL_NAMES = new Set([
  "research_add_source",
  "research_add_evidence",
  "research_add_claim",
  "research_add_relation",
  "research_add_proposal",
]);
