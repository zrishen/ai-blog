import type { AISidebarMode } from "../../../stores/chatStore";

export interface AISidebarProps {
  mode: "shared" | "private";
  contextText?: string;
  siteUsername?: string;
  postSlug?: string;
  pageType?: "post" | "home" | "kb" | "research" | "about" | "other";
  postTitle?: string;
}

export const blogToolOperations = new Set([
  "create_post",
  "update_post",
  "patch_post",
  "delete_post",
]);

export const aiModeLabels: Record<AISidebarMode, string> = {
  normal: "知识库：关闭",
  knowledge: "知识库：打开",
  auto: "知识库：自动",
};

export const nextAiSidebarMode: Record<AISidebarMode, AISidebarMode> = {
  auto: "knowledge",
  knowledge: "normal",
  normal: "auto",
};

export const RESEARCH_TOOL_NAMES = new Set([
  "research_add_source",
  "research_add_evidence",
  "research_add_claim",
  "research_add_relation",
  "research_add_proposal",
]);
