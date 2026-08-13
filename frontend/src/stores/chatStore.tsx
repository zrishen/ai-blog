/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect } from "react";

import { blogReducer } from "./slices/blogSlice";
import { aiContextReducer } from "./slices/aiContextSlice";
import { uiReducer } from "./slices/uiSlice";
import { revisionReducer } from "./slices/revisionSlice";
import { aiSidebarReducer } from "./slices/aiSidebarSlice";
import { workspaceReducer } from "./slices/workspaceSlice";
import { brainReducer } from "./slices/brainSlice";
import { skillReducer } from "./slices/skillSlice";

import type { BrainTab, Page, Theme, WorkspaceView } from "./types";
import type { BlogPost, BlogView } from "@/types/blog";
import type {
  AISidebarConversationKey,
  AISidebarHistoryState,
  AIStreamEvent,
  DraftAttachment,
  Message,
  MessageUpdatePatch,
  ThinkingMode,
} from "@/types/chat";
import type { WorkspaceEntry } from "@/api/workspace";
import type { BrainStats } from "@/api/brain";
import type { SkillId } from "@/types/skill";

export interface BlogStreamingState {
  runId: string;
  content: string;
  status: "streaming";
}

export interface BlogPatchStreamingState {
  runId: string;
  targetText: string;
  replacementDelta: string;
}

interface ChatState {
  theme: Theme;

  currentPage: Page;

  aiSidebarOpen: boolean;
  aiSidebarConversationId: number | null;
  aiSidebarSelectedKey: AISidebarConversationKey | null;
  aiSidebarMessagesByKey: Record<AISidebarConversationKey, Message[]>;
  aiSidebarStreamingByKey: Record<AISidebarConversationKey, boolean>;
  aiSidebarInputsByKey: Record<AISidebarConversationKey, string>;
  aiSidebarErrorsByKey: Record<AISidebarConversationKey, string | null>;
  aiSidebarHistoryByKey: Record<AISidebarConversationKey, AISidebarHistoryState>;
  aiSidebarAttachmentsByKey: Record<AISidebarConversationKey, DraftAttachment[]>;
  aiSidebarThinkingMode: ThinkingMode;
  llmSupportsThinking: boolean;

  blogPosts: BlogPost[];
  blogCurrentView: BlogView;
  blogCurrentPostId: number | null;
  blogSelectedTag: string | null;
  blogStreamingByPostId: Record<number, BlogStreamingState>;

  // AI Selection Context (right-click menu)
  aiSelectionContext: { postId: number; selectedText: string; sectionIndex: number } | null;

  // Blog Patch Streaming (in-place replacement preview for blog_edit_post)
  blogPatchStreamingByPostId: Record<number, BlogPatchStreamingState>;

  // 工作区内联预览选中的文件路径（FilePreviewView）
  fileSelectedFile: string | null;

  workspaceTree: WorkspaceEntry[];
  workspaceSelectedView: WorkspaceView;
  workspaceSelectedFolderPath: string | null;
  // 工作区内联编辑的博客 id（null=不在编辑，显示视图列表）
  workspaceEditingBlogId: number | null;

  // AI 大脑：左栏当前视图 + 概览统计（跨 LeftSidebar/BrainPage 兄弟组件共享）
  brainTab: BrainTab;
  brainStats: BrainStats | null;

  // 文件处理成功后递增，触发文件库列表刷新
  fileLibraryRevision: number;

  // Trash — 恢复/永久删除/清空成功后递增,触发会话/博客列表刷新
  trashRevision: number;

  // AI 知识索引完成/移除后递增，触发 AiKnowledgeView 刷新（进度条→徽章）
  aiKnowledgeRevision: number;

  // 博客主页左栏：AI 生成的自定义 HTML + 标签云显隐 + AI 栏编辑上下文
  leftbarHtml: string | null;
  leftbarShowTags: boolean;
  aiLeftbarEditContext: { html: string | null; heightPx?: number | null } | null;

  // skill 启用选择：null=未从后端加载完成（禁止发送，防发空请求）；非空=已加载的启用集（[] = 显式全关）
  enabledSkills: SkillId[] | null;
  // skill 设置是否加载完成（成功或失败都置 true，失败时 enabledSkills 保持 null → 后端默认全开）
  skillsLoaded: boolean;
}

type ChatAction =
  | { type: "SET_THEME"; payload: Theme }
  | { type: "SET_PAGE"; payload: Page }
  | { type: "SET_AI_SIDEBAR_OPEN"; payload: boolean }
  | { type: "SET_AI_SIDEBAR_CONV_ID"; payload: number | null }
  | { type: "SET_AI_SIDEBAR_SELECTED_KEY"; payload: AISidebarConversationKey | null }
  | { type: "SET_AI_SIDEBAR_MSGS_FOR_KEY"; payload: { key: AISidebarConversationKey; messages: Message[] } }
  | { type: "ADD_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; message: Message } }
  | { type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number } & MessageUpdatePatch }
  | { type: "RECONCILE_AI_SIDEBAR_MESSAGE_IDS"; payload: { key: AISidebarConversationKey; optimisticUserId: number; userMessageId: number; optimisticAssistantId: number; assistantMessageId: number } }
  | { type: "APPLY_AI_STREAM_EVENT_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number; event: AIStreamEvent } }
  | { type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY"; payload: { key: AISidebarConversationKey; streaming: boolean } }
  | { type: "SET_AI_SIDEBAR_INPUT_FOR_KEY"; payload: { key: AISidebarConversationKey; input: string } }
  | { type: "SET_AI_SIDEBAR_ERROR_FOR_KEY"; payload: { key: AISidebarConversationKey; error: string | null } }
  | { type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY"; payload: { key: AISidebarConversationKey; history: AISidebarHistoryState } }
  | { type: "ADD_AI_SIDEBAR_ATTACHMENTS_FOR_KEY"; payload: { key: AISidebarConversationKey; attachments: DraftAttachment[] } }
  | { type: "UPDATE_AI_SIDEBAR_ATTACHMENT_FOR_KEY"; payload: { key: AISidebarConversationKey; localId: string; patch: Partial<DraftAttachment> } }
  | { type: "REMOVE_AI_SIDEBAR_ATTACHMENT_FOR_KEY"; payload: { key: AISidebarConversationKey; localId: string } }
  | { type: "CLEAR_AI_SIDEBAR_ATTACHMENTS_FOR_KEY"; payload: { key: AISidebarConversationKey } }
  | { type: "MIGRATE_AI_SIDEBAR_TEMP_KEY"; payload: { fromKey: AISidebarConversationKey; toKey: AISidebarConversationKey; conversationId: number } }
  | { type: "REMOVE_AI_SIDEBAR_THREAD"; payload: { key: AISidebarConversationKey } }
  | { type: "SET_AI_SIDEBAR_THINKING_MODE"; payload: ThinkingMode }
  | { type: "SET_LLM_SUPPORTS_THINKING"; payload: boolean }
  | { type: "SET_BLOG_POSTS"; payload: BlogPost[] }
  | { type: "SET_BLOG_VIEW"; payload: BlogView }
  | { type: "SET_BLOG_CURRENT_POST_ID"; payload: number | null }
  | { type: "SET_BLOG_SELECTED_TAG"; payload: string | null }
  | { type: "UPDATE_BLOG_POST"; payload: { id: number } & Partial<BlogPost> }
  | { type: "UPSERT_BLOG_POST"; payload: BlogPost }
  | { type: "START_BLOG_STREAMING"; payload: { postId: number; runId: string } }
  | { type: "APPEND_BLOG_STREAMING"; payload: { postId: number; runId: string; contentDelta: string } }
  | { type: "CLEAR_BLOG_STREAMING"; payload: { postId: number; runId: string } }
  | { type: "SET_AI_SELECTION_CONTEXT"; payload: { postId: number; selectedText: string; sectionIndex: number } }
  | { type: "CLEAR_AI_SELECTION_CONTEXT" }
  | { type: "SET_LEFTBAR_HTML"; payload: string | null }
  | { type: "SET_LEFTBAR_SHOW_TAGS"; payload: boolean }
  | { type: "SET_AI_LEFTBAR_EDIT_CONTEXT"; payload: { html: string | null; heightPx?: number | null } | null }
  | { type: "CLEAR_AI_LEFTBAR_EDIT_CONTEXT" }
  | { type: "START_BLOG_PATCH_STREAMING"; payload: { postId: number; runId: string; targetText: string } }
  | { type: "APPEND_BLOG_PATCH_STREAMING"; payload: { postId: number; runId: string; replacementDelta: string } }
  | { type: "CLEAR_BLOG_PATCH_STREAMING"; payload: { postId: number; runId: string } }
  | { type: "SET_FILE_SELECTED_FILE"; payload: string | null }
  | { type: "SET_WORKSPACE_TREE"; payload: WorkspaceEntry[] }
  | { type: "SET_WORKSPACE_BLOG_STATUS"; payload: { id: number; status: string } }
  | { type: "SET_WORKSPACE_SELECTED_VIEW"; payload: WorkspaceView }
  | { type: "SET_WORKSPACE_SELECTED_FOLDER_PATH"; payload: string | null }
  | { type: "INCREMENT_FILE_LIBRARY_REVISION" }
  | { type: "INCREMENT_FILE_RESTORE_REVISIONS" }
  | { type: "INCREMENT_TRASH_REVISION" }
  | { type: "INCREMENT_AI_KNOWLEDGE_REVISION" }
  | { type: "SET_WORKSPACE_EDITING_BLOG"; payload: number | null }
  | { type: "SET_BRAIN_TAB"; payload: BrainTab }
  | { type: "SET_BRAIN_STATS"; payload: BrainStats | null }
  | { type: "DECREMENT_BRAIN_STATS"; payload: { field: "entities" | "facts" | "episodes" | "preferences"; by?: number } }
  | { type: "SET_ENABLED_SKILLS"; payload: SkillId[] }
  | { type: "SET_SKILLS_LOADED"; payload: boolean }
  | { type: "LOGOUT" };

// ── 用户域初始值：initialState 与 LOGOUT 共享同一来源，新字段只需加到一个对象 ──

const AI_SIDEBAR_DEFAULTS = {
  aiSidebarConversationId: null as number | null,
  aiSidebarSelectedKey: null as AISidebarConversationKey | null,
  aiSidebarMessagesByKey: {} as Record<AISidebarConversationKey, Message[]>,
  aiSidebarStreamingByKey: {} as Record<AISidebarConversationKey, boolean>,
  aiSidebarInputsByKey: {} as Record<AISidebarConversationKey, string>,
  aiSidebarErrorsByKey: {} as Record<AISidebarConversationKey, string | null>,
  aiSidebarHistoryByKey: {} as Record<AISidebarConversationKey, AISidebarHistoryState>,
  aiSidebarAttachmentsByKey: {} as Record<AISidebarConversationKey, DraftAttachment[]>,
  aiSidebarThinkingMode: "balanced" as ThinkingMode,
  llmSupportsThinking: true,
};

const BLOG_DEFAULTS = {
  blogPosts: [] as BlogPost[],
  blogCurrentView: "list" as BlogView,
  blogCurrentPostId: null as number | null,
  blogSelectedTag: null as string | null,
  blogStreamingByPostId: {} as Record<number, BlogStreamingState>,
  aiSelectionContext: null as ChatState["aiSelectionContext"],
  blogPatchStreamingByPostId: {} as Record<number, BlogPatchStreamingState>,
  leftbarHtml: null as string | null,
  leftbarShowTags: true,
  aiLeftbarEditContext: null as ChatState["aiLeftbarEditContext"],
};

const WORKSPACE_DEFAULTS = {
  fileSelectedFile: null as string | null,
  workspaceTree: [] as WorkspaceEntry[],
  workspaceSelectedFolderPath: null as string | null,
  workspaceEditingBlogId: null as number | null,
};

const BRAIN_DEFAULTS = {
  brainTab: "graph" as BrainTab,
  brainStats: null as BrainStats | null,
};

const SKILL_DEFAULTS = {
  enabledSkills: null as SkillId[] | null,
  skillsLoaded: false,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  state = blogReducer(state, action);
  state = aiContextReducer(state, action);
  state = uiReducer(state, action);
  state = revisionReducer(state, action);
  state = aiSidebarReducer(state, action);
  state = workspaceReducer(state, action);
  state = brainReducer(state, action);
  state = skillReducer(state, action);
  switch (action.type) {
    // Auth — 登出时清除用户级别 UI 状态（不删后端数据）
    case "LOGOUT":
      return {
        ...state,
        currentPage: getInitialPage(),
        aiSidebarOpen: true,
        ...AI_SIDEBAR_DEFAULTS,
        ...BLOG_DEFAULTS,
        ...WORKSPACE_DEFAULTS,
        ...BRAIN_DEFAULTS,
        ...SKILL_DEFAULTS,
        workspaceSelectedView: "overview" as WorkspaceView,
        fileLibraryRevision: state.fileLibraryRevision + 1,
        trashRevision: state.trashRevision + 1,
        aiKnowledgeRevision: state.aiKnowledgeRevision + 1,
      };
    default:
      return state;
  }
}

const THEMES: readonly Theme[] = ["light", "dark"];
function readSavedTheme(): Theme {
  try {
    const v = localStorage.getItem("theme");
    return v && THEMES.includes(v as Theme) ? (v as Theme) : "light";
  } catch {
    return "light";
  }
}

const savedTheme = readSavedTheme();

function getInitialPage(): Page {
  const path = window.location.pathname;
  if (path.startsWith("/workspace")) return "workspace";
  if (path.startsWith("/brain")) return "brain";
  return "blog";
}

// 工作区选中视图/目录持久化：刷新页面后恢复上次位置，不回退到「全部」。
const WS_VIEWS: WorkspaceView[] = ["overview", "drafts", "published", "ai_knowledge", "trash"];
function loadWorkspaceView(): WorkspaceView {
  const v = localStorage.getItem("ws_view");
  return v && WS_VIEWS.includes(v as WorkspaceView) ? (v as WorkspaceView) : "overview";
}
const initialState: ChatState = {
  theme: savedTheme,

  currentPage: getInitialPage(),
  aiSidebarOpen: true,

  ...AI_SIDEBAR_DEFAULTS,
  ...BLOG_DEFAULTS,
  ...WORKSPACE_DEFAULTS,
  ...BRAIN_DEFAULTS,
  ...SKILL_DEFAULTS,
  workspaceSelectedView: loadWorkspaceView(),

  fileLibraryRevision: 0,
  trashRevision: 0,
  aiKnowledgeRevision: 0,
};

const ChatStateContext = createContext<ChatState>(initialState);
const ChatDispatchContext = createContext<React.Dispatch<ChatAction>>(() => {});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
    try { localStorage.setItem("theme", state.theme); } catch { /* ignore unavailable storage */ }
  }, [state.theme]);

  useEffect(() => {
    try { localStorage.setItem("ws_view", state.workspaceSelectedView); } catch { /* ignore unavailable storage */ }
  }, [state.workspaceSelectedView]);
  useEffect(() => {
    const handleAuthLogout = () => {
      dispatch({ type: "LOGOUT" });
      // 显式清除跨用户持久化，不依赖 LOGOUT→effect 写回的时序
      try { localStorage.removeItem("ws_view"); } catch { /* ignore unavailable storage */ }
      try { localStorage.removeItem("workspace:collapsed-paths"); } catch { /* ignore unavailable storage */ }
    };
    window.addEventListener("auth:logout", handleAuthLogout);
    return () => window.removeEventListener("auth:logout", handleAuthLogout);
  }, []);

  return (
    <ChatStateContext.Provider value={state}>
      <ChatDispatchContext.Provider value={dispatch}>
        {children}
      </ChatDispatchContext.Provider>
    </ChatStateContext.Provider>
  );
}

export function useChat() {
  return { state: useContext(ChatStateContext), dispatch: useContext(ChatDispatchContext) };
}

export function useChatState(): ChatState {
  return useContext(ChatStateContext);
}

export function useChatDispatch(): React.Dispatch<ChatAction> {
  return useContext(ChatDispatchContext);
}

export type { ChatAction, ChatState };

export function toggleTheme(dispatch: React.Dispatch<ChatAction>) {
  const stored = localStorage.getItem("theme");
  const current: Theme = stored && THEMES.includes(stored as Theme) ? (stored as Theme) : "light";
  const next: Theme = current === "dark" ? "light" : "dark";
  dispatch({ type: "SET_THEME", payload: next });
}

