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

export const thinkingModeLabels: Record<ThinkingMode, string> = {
  fast: "快速",
  balanced: "平衡",
  smart: "智能",
};

export const RESEARCH_TOOL_NAMES = new Set([
  "research_add_source",
  "research_add_evidence",
  "research_add_claim",
  "research_add_relation",
  "research_add_proposal",
]);
