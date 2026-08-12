import type { ThinkingMode } from "@/types/chat";

export type AISidebarMode = "pending" | "shared" | "private";

export interface AISidebarProps {
  mode: AISidebarMode;
  contextText?: string;
  siteUsername?: string;
  postSlug?: string;
  pageType?: "post" | "home" | "about" | "other";
  postTitle?: string;
  onRequestClose?: () => void;
  forceExpanded?: boolean;
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

export type AISidebarSession =
  | { version: 1; view: "list" }
  | { version: 1; view: "chat"; target: { kind: "new" } }
  | { version: 1; view: "chat"; target: { kind: "server"; conversationId: number } };

const LEGACY_AI_SIDEBAR_VIEW_STORAGE_KEY = "ai-sidebar-view";
const LEGACY_AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY = "ai-sidebar-selected-key";

export function getAISidebarSessionStorageKey(userId: number): string {
  return `ai-sidebar-session:v1:${userId}`;
}

function parseAISidebarSession(value: unknown): AISidebarSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  if (session.version !== 1) return null;
  if (session.view === "list") return { version: 1, view: "list" };
  if (session.view !== "chat" || !session.target || typeof session.target !== "object") return null;
  const target = session.target as Record<string, unknown>;
  if (target.kind === "new") return { version: 1, view: "chat", target: { kind: "new" } };
  if (target.kind === "server" && Number.isInteger(target.conversationId) && Number(target.conversationId) > 0) {
    return { version: 1, view: "chat", target: { kind: "server", conversationId: Number(target.conversationId) } };
  }
  return null;
}

export function loadAISidebarSession(userId: number): AISidebarSession {
  try {
    const scoped = localStorage.getItem(getAISidebarSessionStorageKey(userId));
    if (scoped) {
      return parseAISidebarSession(JSON.parse(scoped)) ?? { version: 1, view: "list" };
    }

    // 仅用于把当前版本升级前的同浏览器状态迁移一次；迁移后立即删除全局 key，
    // 后续状态全部按用户隔离，避免账号切换互相覆盖。
    const legacyView = localStorage.getItem(LEGACY_AI_SIDEBAR_VIEW_STORAGE_KEY);
    const legacyKey = localStorage.getItem(LEGACY_AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
    const legacyId = legacyKey?.startsWith("server:") ? Number(legacyKey.slice(7)) : null;
    const migrated: AISidebarSession = legacyView === "chat"
      ? Number.isInteger(legacyId) && Number(legacyId) > 0
        ? { version: 1, view: "chat", target: { kind: "server", conversationId: Number(legacyId) } }
        : { version: 1, view: "chat", target: { kind: "new" } }
      : { version: 1, view: "list" };
    localStorage.setItem(getAISidebarSessionStorageKey(userId), JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_AI_SIDEBAR_VIEW_STORAGE_KEY);
    localStorage.removeItem(LEGACY_AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
    return migrated;
  } catch {
    return { version: 1, view: "list" };
  }
}

export function saveAISidebarSession(userId: number, session: AISidebarSession): void {
  try {
    localStorage.setItem(getAISidebarSessionStorageKey(userId), JSON.stringify(session));
  } catch {
    // 本地存储不可用时仍保留当前页面内状态。
  }
}
