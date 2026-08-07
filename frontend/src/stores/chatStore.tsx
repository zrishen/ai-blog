/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect } from "react";
import type { BrainStats, WorkspaceNode } from "../api/client";
import type { ThinkingMode } from "../api/chat";
import type {
  AISidebarConversationKey,
  AISidebarHistoryState,
  AIStreamEvent,
  ChatAttachment,
  Conversation,
  DraftAttachment,
  Message,
  Reference,
  ToolEvent,
} from "../features/ai-chat/types";
import { isDisplayableMessage } from "../features/ai-chat/types";
import type { BlogPost, BlogView } from "../features/blog/types";
import type { FileDocument } from "../api/client";
import type { BrainTab, Page, Panel, Theme, WorkspaceView } from "./types";
import { conversationReducer } from "./slices/conversationSlice";
import { blogReducer } from "./slices/blogSlice";
import { uiReducer } from "./slices/uiSlice";
import { revisionReducer } from "./slices/revisionSlice";
import { aiSidebarReducer } from "./slices/aiSidebarSlice";
import { workspaceReducer } from "./slices/workspaceSlice";
import { brainReducer } from "./slices/brainSlice";

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
  conversations: Conversation[];
  currentConversationId: number | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  theme: Theme;
  activePanel: Panel;

  currentPage: Page;
  gearMenuOpen: boolean;
  pluginCenterOpen: boolean;

  aiSidebarOpen: boolean;
  aiSidebarConversationId: number | null;
  aiSidebarSelectedKey: AISidebarConversationKey | null;
  aiSidebarMessages: Message[];
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

  workspaceTree: WorkspaceNode[];
  workspaceSelectedFolderId: number | null;
  workspaceSelectedView: WorkspaceView;
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
}

type ChatAction =
  | { type: "SET_CONVERSATIONS"; payload: Conversation[] }
  | { type: "SET_CURRENT_CONVERSATION"; payload: number | null }
  | { type: "SET_MESSAGES"; payload: Message[] }
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "UPDATE_MESSAGE"; payload: { id: number; content?: string; image_url?: string; tool_calls?: Array<{ id: string; name: string; arguments: string }>; tool_results?: string[] } }
  | { type: "APPLY_MESSAGE_STREAM_EVENT"; payload: { id: number; event: AIStreamEvent } }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_STREAMING"; payload: boolean }
  | { type: "SET_THEME"; payload: Theme }
  | { type: "SET_ACTIVE_PANEL"; payload: Panel }
  | { type: "SET_PAGE"; payload: Page }
  | { type: "TOGGLE_GEAR_MENU"; payload?: boolean }
  | { type: "TOGGLE_PLUGIN_CENTER"; payload?: boolean }
  | { type: "SET_AI_SIDEBAR_OPEN"; payload: boolean }
  | { type: "SET_AI_SIDEBAR_CONV_ID"; payload: number | null }
  | { type: "SET_AI_SIDEBAR_SELECTED_KEY"; payload: AISidebarConversationKey | null }
  | { type: "SET_AI_SIDEBAR_MSGS"; payload: Message[] }
  | { type: "SET_AI_SIDEBAR_MSGS_FOR_KEY"; payload: { key: AISidebarConversationKey; messages: Message[] } }
  | { type: "ADD_AI_SIDEBAR_MSG"; payload: Message }
  | { type: "ADD_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; message: Message } }
  | { type: "UPDATE_AI_SIDEBAR_MSG"; payload: { id: number; content?: string; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number } }
  | { type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number; content?: string; conversation_id?: number; attachments?: ChatAttachment[]; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number } }
  | { type: "RECONCILE_AI_SIDEBAR_MESSAGE_IDS"; payload: { key: AISidebarConversationKey; optimisticUserId: number; userMessageId: number; optimisticAssistantId: number; assistantMessageId: number } }
  | { type: "APPLY_AI_STREAM_EVENT"; payload: { id: number; event: AIStreamEvent } }
  | { type: "APPLY_AI_STREAM_EVENT_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number; event: AIStreamEvent } }
  | { type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY"; payload: { key: AISidebarConversationKey; streaming: boolean } }
  | { type: "SET_AI_SIDEBAR_INPUT_FOR_KEY"; payload: { key: AISidebarConversationKey; input: string } }
  | { type: "SET_AI_SIDEBAR_ERROR_FOR_KEY"; payload: { key: AISidebarConversationKey; error: string | null } }
  | { type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY"; payload: { key: AISidebarConversationKey; history: AISidebarHistoryState } }
  | { type: "ADD_AI_SIDEBAR_ATTACHMENTS_FOR_KEY"; payload: { key: AISidebarConversationKey; attachments: DraftAttachment[] } }
  | { type: "UPDATE_AI_SIDEBAR_ATTACHMENT_FOR_KEY"; payload: { key: AISidebarConversationKey; localId: string; patch: Partial<DraftAttachment> } }
  | { type: "REMOVE_AI_SIDEBAR_ATTACHMENT_FOR_KEY"; payload: { key: AISidebarConversationKey; localId: string } }
  | { type: "SORT_AI_SIDEBAR_ATTACHMENTS_FOR_KEY"; payload: { key: AISidebarConversationKey; localIds: string[] } }
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
  | { type: "SET_WORKSPACE_TREE"; payload: WorkspaceNode[] }
  | { type: "SET_WORKSPACE_BLOG_STATUS"; payload: { id: number; status: string } }
  | { type: "SET_WORKSPACE_SELECTED_FOLDER"; payload: number | null }
  | { type: "SET_WORKSPACE_SELECTED_VIEW"; payload: WorkspaceView }
  | { type: "INCREMENT_FILE_LIBRARY_REVISION" }
  | { type: "INCREMENT_FILE_RESTORE_REVISIONS" }
  | { type: "INCREMENT_TRASH_REVISION" }
  | { type: "INCREMENT_AI_KNOWLEDGE_REVISION" }
  | { type: "SET_WORKSPACE_EDITING_BLOG"; payload: number | null }
  | { type: "SET_BRAIN_TAB"; payload: BrainTab }
  | { type: "SET_BRAIN_STATS"; payload: BrainStats | null }
  | { type: "DECREMENT_BRAIN_STATS"; payload: { field: "entities" | "facts" | "episodes" | "preferences"; by?: number } }
  | { type: "LOGOUT" };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  state = conversationReducer(state, action);
  state = blogReducer(state, action);
  state = uiReducer(state, action);
  state = revisionReducer(state, action);
  state = aiSidebarReducer(state, action);
  state = workspaceReducer(state, action);
  state = brainReducer(state, action);
  switch (action.type) {
    // Auth — 登出时清除用户级别 UI 状态（不删后端数据）
    case "LOGOUT":
      return {
        ...state,
        conversations: [],
        currentConversationId: null,
        messages: [],
        aiSidebarConversationId: null,
        aiSidebarSelectedKey: null,
        aiSidebarMessages: [],
        aiSidebarMessagesByKey: {},
        aiSidebarStreamingByKey: {},
        aiSidebarInputsByKey: {},
        aiSidebarErrorsByKey: {},
        aiSidebarHistoryByKey: {},
        aiSidebarAttachmentsByKey: {},
        aiSidebarThinkingMode: "balanced",
        blogPosts: [],
        blogCurrentView: "list",
        blogCurrentPostId: null,
        blogSelectedTag: null,
        blogStreamingByPostId: {},
        aiSelectionContext: null,
        leftbarHtml: null,
        leftbarShowTags: true,
        aiLeftbarEditContext: null,
        blogPatchStreamingByPostId: {},
        fileSelectedFile: null,
        workspaceTree: [],
        workspaceSelectedFolderId: null,
        workspaceSelectedView: "overview",
        workspaceEditingBlogId: null,
        brainTab: "graph",
        brainStats: null,
        fileLibraryRevision: state.fileLibraryRevision + 1,
        trashRevision: state.trashRevision + 1,
        aiKnowledgeRevision: state.aiKnowledgeRevision + 1,
      };
    default:
      return state;
  }
}

const savedTheme = (localStorage.getItem("theme") as Theme) || "light";

function getInitialPage(): Page {
  const path = window.location.pathname;
  if (path.startsWith("/workspace")) return "workspace";
  if (path.startsWith("/brain")) return "brain";
  return "blog";
}

// 工作区选中视图/目录持久化：刷新页面后恢复上次位置，不回退到「全部」。
const WS_VIEWS: WorkspaceView[] = ["overview", "drafts", "published", "ai_knowledge", "inbox", "trash"];
function loadWorkspaceView(): WorkspaceView {
  const v = localStorage.getItem("ws_view");
  return v && WS_VIEWS.includes(v as WorkspaceView) ? (v as WorkspaceView) : "overview";
}
function loadWorkspaceFolder(): number | null {
  const raw = localStorage.getItem("ws_folder");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const initialState: ChatState = {
  conversations: [],
  currentConversationId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  theme: savedTheme,
  activePanel: "conversations",

  currentPage: getInitialPage(),
  gearMenuOpen: false,
  pluginCenterOpen: false,

  // AI Sidebar — default open, no conversation yet
  aiSidebarOpen: true,
  aiSidebarConversationId: null,
  aiSidebarSelectedKey: null,
  aiSidebarMessages: [],
  aiSidebarMessagesByKey: {},
  aiSidebarStreamingByKey: {},
  aiSidebarInputsByKey: {},
  aiSidebarErrorsByKey: {},
  aiSidebarHistoryByKey: {},
  aiSidebarAttachmentsByKey: {},
  aiSidebarThinkingMode: "balanced",
  llmSupportsThinking: true,

  blogPosts: [],
  blogCurrentView: "list",
  blogCurrentPostId: null,
  blogSelectedTag: null,
  blogStreamingByPostId: {},
  aiSelectionContext: null,
  leftbarHtml: null,
  leftbarShowTags: true,
  aiLeftbarEditContext: null,
  blogPatchStreamingByPostId: {},

  fileSelectedFile: null,

  workspaceTree: [],
  workspaceSelectedFolderId: loadWorkspaceFolder(),
  workspaceSelectedView: loadWorkspaceView(),
  workspaceEditingBlogId: null,

  brainTab: "graph",
  brainStats: null,

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
    localStorage.setItem("theme", state.theme);
  }, [state.theme]);

  useEffect(() => {
    localStorage.setItem("ws_view", state.workspaceSelectedView);
  }, [state.workspaceSelectedView]);
  useEffect(() => {
    if (state.workspaceSelectedFolderId == null) localStorage.removeItem("ws_folder");
    else localStorage.setItem("ws_folder", String(state.workspaceSelectedFolderId));
  }, [state.workspaceSelectedFolderId]);

  useEffect(() => {
    const handleAuthLogout = () => dispatch({ type: "LOGOUT" });
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

export function toggleTheme(dispatch: React.Dispatch<ChatAction>) {
  const current = localStorage.getItem("theme") as Theme || "light";
  const next: Theme = current === "dark" ? "light" : "dark";
  dispatch({ type: "SET_THEME", payload: next });
}

export type { Message, Conversation, DraftAttachment, FileDocument, BlogPost, ChatState, ChatAction, AISidebarConversationKey, ToolEvent, Reference };
export { isDisplayableMessage };
