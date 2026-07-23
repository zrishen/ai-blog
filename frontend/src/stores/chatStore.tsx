/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect } from "react";
import type { MCPServerConfig, ResearchTopicDetail, ResearchTopicSummary } from "../api/client";
import type { TrustChoiceOption } from "../features/ai-chat/trustPrompts";
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
import type { FileCategory, FileDocument } from "../features/file/types";
import type { Page, Panel, Theme } from "./types";
import { researchReducer } from "./slices/researchSlice";
import { conversationReducer } from "./slices/conversationSlice";
import { blogReducer } from "./slices/blogSlice";
import { fileReducer } from "./slices/fileSlice";
import { uiReducer } from "./slices/uiSlice";
import { revisionReducer } from "./slices/revisionSlice";
import { aiSidebarReducer } from "./slices/aiSidebarSlice";

interface ChatState {
  conversations: Conversation[];
  currentConversationId: number | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  theme: Theme;
  fileDocuments: FileDocument[];
  mcpServers: MCPServerConfig[];
  activePanel: Panel;

  // Layout
  currentPage: Page;
  gearMenuOpen: boolean;
  mcpModalOpen: boolean;

  // AI Sidebar
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

  // Blog
  blogPosts: BlogPost[];
  blogCurrentView: BlogView;
  blogCurrentPostId: number | null;
  blogSelectedTag: string | null;
  blogStreamingContent: string | null;

  // AI Selection Context (right-click menu)
  aiSelectionContext: { postId: number; selectedText: string; sectionIndex: number } | null;

  // Blog Patch Streaming (in-place replacement preview for blog_edit_post)
  blogPatchStreaming: { targetText: string; replacementDelta: string } | null;

  // File Library
  fileCategories: FileCategory[];
  fileSelectedCategoryId: number | null;
  fileSelectedFile: string | null;

  // Research Graph
  researchTopics: ResearchTopicSummary[];
  researchCurrentTopicId: number | null;
  researchCurrentTopic: ResearchTopicDetail | null;
  researchSelectedClaimId: number | null;
  researchSelectedConflictId: number | null;
  researchSelectedProposalId: number | null;
  trustWritingEnabled: boolean;
  pendingResearchPrompt: string | null;

  // 文件处理成功后递增，触发文件库列表刷新
  fileLibraryRevision: number;

  // Trash — 恢复/永久删除/清空成功后递增,触发会话/博客列表刷新
  trashRevision: number;
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
  | { type: "SET_FILE_DOCUMENTS"; payload: FileDocument[] }
  | { type: "REMOVE_FILE_DOCUMENT"; payload: number }
  | { type: "SET_MCP_SERVERS"; payload: MCPServerConfig[] }
  | { type: "REMOVE_MCP_SERVER"; payload: number }
  | { type: "SET_ACTIVE_PANEL"; payload: Panel }
  // Layout
  | { type: "SET_PAGE"; payload: Page }
  | { type: "TOGGLE_GEAR_MENU"; payload?: boolean }
  | { type: "TOGGLE_MCP_MODAL"; payload?: boolean }
  // AI Sidebar
  | { type: "SET_AI_SIDEBAR_OPEN"; payload: boolean }
  | { type: "SET_AI_SIDEBAR_CONV_ID"; payload: number | null }
  | { type: "SET_AI_SIDEBAR_SELECTED_KEY"; payload: AISidebarConversationKey | null }
  | { type: "SET_AI_SIDEBAR_MSGS"; payload: Message[] }
  | { type: "SET_AI_SIDEBAR_MSGS_FOR_KEY"; payload: { key: AISidebarConversationKey; messages: Message[] } }
  | { type: "ADD_AI_SIDEBAR_MSG"; payload: Message }
  | { type: "ADD_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; message: Message } }
  | { type: "UPDATE_AI_SIDEBAR_MSG"; payload: { id: number; content?: string; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number; trustChoicePrompt?: string | null; trustChoiceOptions?: TrustChoiceOption[] } }
  | { type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number; content?: string; conversation_id?: number; attachments?: ChatAttachment[]; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number; trustChoicePrompt?: string | null; trustChoiceOptions?: TrustChoiceOption[] } }
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
  // Blog
  | { type: "SET_BLOG_POSTS"; payload: BlogPost[] }
  | { type: "SET_BLOG_VIEW"; payload: BlogView }
  | { type: "SET_BLOG_CURRENT_POST_ID"; payload: number | null }
  | { type: "SET_BLOG_SELECTED_TAG"; payload: string | null }
  | { type: "UPDATE_BLOG_POST"; payload: BlogPost }
  | { type: "APPEND_BLOG_STREAMING"; payload: string }
  | { type: "CLEAR_BLOG_STREAMING" }
  // AI Selection Context
  | { type: "SET_AI_SELECTION_CONTEXT"; payload: { postId: number; selectedText: string; sectionIndex: number } }
  | { type: "CLEAR_AI_SELECTION_CONTEXT" }
  // Blog Patch Streaming
  | { type: "START_BLOG_PATCH_STREAMING"; payload: { targetText: string } }
  | { type: "APPEND_BLOG_PATCH_STREAMING"; payload: { replacementDelta: string } }
  | { type: "CLEAR_BLOG_PATCH_STREAMING" }
  // File Library
  | { type: "SET_FILE_CATEGORIES"; payload: FileCategory[] }
  | { type: "SET_FILE_SELECTED_CATEGORY_ID"; payload: number | null }
  | { type: "SET_FILE_SELECTED_FILE"; payload: string | null }
  // Research Graph
  | { type: "SET_RESEARCH_TOPICS"; payload: ResearchTopicSummary[] }
  | { type: "SET_RESEARCH_CURRENT_TOPIC_ID"; payload: number | null }
  | { type: "SET_RESEARCH_CURRENT_TOPIC"; payload: ResearchTopicDetail | null }
  | { type: "SET_RESEARCH_SELECTED_CLAIM_ID"; payload: number | null }
  | { type: "SET_RESEARCH_SELECTED_CONFLICT_ID"; payload: number | null }
  | { type: "SET_RESEARCH_SELECTED_PROPOSAL_ID"; payload: number | null }
  | { type: "SET_TRUST_WRITING_ENABLED"; payload: boolean }
  | { type: "SET_PENDING_RESEARCH_PROMPT"; payload: string | null }
  // File processing / Trash
  | { type: "INCREMENT_FILE_LIBRARY_REVISION" }
  | { type: "INCREMENT_FILE_RESTORE_REVISIONS" }
  | { type: "INCREMENT_TRASH_REVISION" }
  // Auth
  | { type: "LOGOUT" };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  state = researchReducer(state, action);
  state = conversationReducer(state, action);
  state = blogReducer(state, action);
  state = fileReducer(state, action);
  state = uiReducer(state, action);
  state = revisionReducer(state, action);
  state = aiSidebarReducer(state, action);
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
        blogStreamingContent: null,
        aiSelectionContext: null,
        blogPatchStreaming: null,
        fileCategories: [],
        fileDocuments: [],
        fileSelectedCategoryId: null,
        fileSelectedFile: null,
        researchTopics: [],
        researchCurrentTopicId: null,
        researchCurrentTopic: null,
        researchSelectedClaimId: null,
        researchSelectedConflictId: null,
        researchSelectedProposalId: null,
        trustWritingEnabled: false,
        pendingResearchPrompt: null,
        mcpServers: [],
        fileLibraryRevision: state.fileLibraryRevision + 1,
        trashRevision: state.trashRevision + 1,
      };
    default:
      return state;
  }
}

const savedTheme = (localStorage.getItem("theme") as Theme) || "light";

function getInitialPage(): Page {
  const path = window.location.pathname;
  if (path.startsWith("/files")) return "files";
  if (path.startsWith("/research")) return "research";
  return "blog";
}

const initialState: ChatState = {
  conversations: [],
  currentConversationId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  theme: savedTheme,
  fileDocuments: [],
  mcpServers: [],
  activePanel: "conversations",

  // Layout
  currentPage: getInitialPage(),
  gearMenuOpen: false,
  mcpModalOpen: false,

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

  // Blog
  blogPosts: [],
  blogCurrentView: "list",
  blogCurrentPostId: null,
  blogSelectedTag: null,
  blogStreamingContent: null,
  aiSelectionContext: null,
  blogPatchStreaming: null,

  // File Library
  fileCategories: [],
  fileSelectedCategoryId: null,
  fileSelectedFile: null,

  // Research Graph
  researchTopics: [],
  researchCurrentTopicId: null,
  researchCurrentTopic: null,
  researchSelectedClaimId: null,
  researchSelectedConflictId: null,
  researchSelectedProposalId: null,
  trustWritingEnabled: false,
  pendingResearchPrompt: null,

  // File processing / Trash
  fileLibraryRevision: 0,
  trashRevision: 0,
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

export type { Message, Conversation, DraftAttachment, FileDocument, BlogPost, FileCategory, ChatState, ChatAction, AISidebarConversationKey, ToolEvent, Reference, ResearchTopicDetail };
export { isDisplayableMessage };
