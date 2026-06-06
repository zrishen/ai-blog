import { createContext, useContext, useReducer, useEffect } from "react";
import type { MCPServerConfig, ResearchTopicDetail, ResearchTopicSummary } from "../api/client";
import type { TrustChoiceOption } from "../features/ai-chat/trustPrompts";

interface Reference {
  type: "rag" | "mcp";
  source?: string;
  collection?: string;
  distance?: number;
  server?: string;
  tool?: string;
}

interface ToolEvent {
  type: "start" | "end";
  toolName: string;
  result?: string;
  references?: Reference[];
}

interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  image_url?: string;
  file_url?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_results?: string[];
  thinkingContent?: string;
  toolEvents?: ToolEvent[];
  reasoningContent?: string;
  thinkingMode?: ThinkingMode;
  trustChoicePrompt?: string | null;
  trustChoiceOptions?: TrustChoiceOption[];
  token_count: number;
  created_at: string;
}

export function isDisplayableMessage(message: unknown): message is Message {
  if (!message || typeof message !== "object") return false;
  const role = (message as { role?: unknown }).role;
  return role === "user" || role === "assistant";
}

interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface KBDocument {
  id: number;
  collection_name: string;
  original_name: string;
  file_path: string;
  chunk_count: number;
  category_id: number | null;
  created_at: string;
}

// --- New types for blog ---

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  cover_image?: string;
  status: string;
  tags?: string;
  author?: string;
  view_count: number;
  created_at: string;
  updated_at?: string;
  published_at?: string;
}

interface KBCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent_id: number | null;
  children?: KBCategory[];
  created_at: string;
}

type Theme = "dark" | "light";
type Panel = "conversations" | "knowledge" | "mcp";
type Page = "blog" | "knowledge" | "research";
type BlogView = "list" | "view" | "edit";
type AISidebarMode = "normal" | "knowledge" | "auto";
type ThinkingMode = "normal" | "deep";

interface ChatState {
  conversations: Conversation[];
  currentConversationId: number | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  theme: Theme;
  kbDocuments: KBDocument[];
  mcpServers: MCPServerConfig[];
  activePanel: Panel;

  // Layout
  currentPage: Page;
  gearMenuOpen: boolean;
  mcpModalOpen: boolean;

  // AI Sidebar
  aiSidebarOpen: boolean;
  aiSidebarConversationId: number | null;
  aiSidebarMessages: Message[];
  aiSidebarMode: AISidebarMode;
  aiSidebarThinkingMode: ThinkingMode;

  // Blog
  blogPosts: BlogPost[];
  blogCurrentView: BlogView;
  blogCurrentPostId: number | null;
  blogSelectedTag: string | null;
  blogStreamingContent: string | null;

  // AI Selection Context (right-click menu)
  aiSelectionContext: { postId: number; selectedText: string } | null;

  // Blog Patch Streaming (in-place replacement)
  blogPatchStreaming: { targetText: string; replacementDelta: string } | null;

  // KB
  kbCategories: KBCategory[];
  kbSelectedCategoryId: number | null;
  kbSelectedFile: string | null;

  // Research Graph
  researchTopics: ResearchTopicSummary[];
  researchCurrentTopicId: number | null;
  researchCurrentTopic: ResearchTopicDetail | null;
  researchSelectedClaimId: number | null;
  researchSelectedConflictId: number | null;
  researchSelectedProposalId: number | null;
  trustWritingEnabled: boolean;
  pendingResearchPrompt: string | null;
}

type ChatAction =
  | { type: "SET_CONVERSATIONS"; payload: Conversation[] }
  | { type: "SET_CURRENT_CONVERSATION"; payload: number | null }
  | { type: "SET_MESSAGES"; payload: Message[] }
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "UPDATE_MESSAGE"; payload: { id: number; content?: string; image_url?: string; tool_calls?: Array<{ id: string; name: string; arguments: string }>; tool_results?: string[] } }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_STREAMING"; payload: boolean }
  | { type: "SET_THEME"; payload: Theme }
  | { type: "SET_KB_DOCUMENTS"; payload: KBDocument[] }
  | { type: "REMOVE_KB_DOCUMENT"; payload: number }
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
  | { type: "SET_AI_SIDEBAR_MSGS"; payload: Message[] }
  | { type: "ADD_AI_SIDEBAR_MSG"; payload: Message }
  | { type: "UPDATE_AI_SIDEBAR_MSG"; payload: { id: number; content?: string; thinkingContent?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; thinkingMode?: ThinkingMode; trustChoicePrompt?: string | null; trustChoiceOptions?: TrustChoiceOption[] } }
  | { type: "REORGANIZE_AI_MSG"; payload: { id: number; splitPosition: number } }
  | { type: "SET_AI_SIDEBAR_MODE"; payload: AISidebarMode }
  | { type: "SET_AI_SIDEBAR_THINKING_MODE"; payload: ThinkingMode }
  // Blog
  | { type: "SET_BLOG_POSTS"; payload: BlogPost[] }
  | { type: "SET_BLOG_VIEW"; payload: BlogView }
  | { type: "SET_BLOG_CURRENT_POST_ID"; payload: number | null }
  | { type: "SET_BLOG_SELECTED_TAG"; payload: string | null }
  | { type: "UPDATE_BLOG_POST"; payload: BlogPost }
  | { type: "APPEND_BLOG_STREAMING"; payload: string }
  | { type: "CLEAR_BLOG_STREAMING" }
  // AI Selection Context
  | { type: "SET_AI_SELECTION_CONTEXT"; payload: { postId: number; selectedText: string } }
  | { type: "CLEAR_AI_SELECTION_CONTEXT" }
  // Blog Patch Streaming
  | { type: "START_BLOG_PATCH_STREAMING"; payload: { targetText: string } }
  | { type: "APPEND_BLOG_PATCH_STREAMING"; payload: string }
  | { type: "CLEAR_BLOG_PATCH_STREAMING" }
  // KB
  | { type: "SET_KB_CATEGORIES"; payload: KBCategory[] }
  | { type: "SET_KB_SELECTED_CATEGORY_ID"; payload: number | null }
  | { type: "SET_KB_SELECTED_FILE"; payload: string | null }
  // Research Graph
  | { type: "SET_RESEARCH_TOPICS"; payload: ResearchTopicSummary[] }
  | { type: "SET_RESEARCH_CURRENT_TOPIC_ID"; payload: number | null }
  | { type: "SET_RESEARCH_CURRENT_TOPIC"; payload: ResearchTopicDetail | null }
  | { type: "SET_RESEARCH_SELECTED_CLAIM_ID"; payload: number | null }
  | { type: "SET_RESEARCH_SELECTED_CONFLICT_ID"; payload: number | null }
  | { type: "SET_RESEARCH_SELECTED_PROPOSAL_ID"; payload: number | null }
  | { type: "SET_TRUST_WRITING_ENABLED"; payload: boolean }
  | { type: "SET_PENDING_RESEARCH_PROMPT"; payload: string | null }
  // Navigation
  | { type: "RESET_TO_BLOG_HOME" }
  // Auth
  | { type: "LOGOUT" };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.payload };
    case "SET_CURRENT_CONVERSATION":
      return { ...state, currentConversationId: action.payload };
    case "SET_MESSAGES":
      return { ...state, messages: action.payload };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.id ? { ...m, ...action.payload } : m
        ),
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_STREAMING":
      return { ...state, isStreaming: action.payload };
    case "SET_THEME": {
      const newTheme = action.payload;
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      return { ...state, theme: newTheme };
    }
    case "SET_KB_DOCUMENTS":
      return { ...state, kbDocuments: action.payload };
    case "REMOVE_KB_DOCUMENT":
      return {
        ...state,
        kbDocuments: state.kbDocuments.filter((d) => d.id !== action.payload),
      };
    case "SET_MCP_SERVERS":
      return { ...state, mcpServers: action.payload };
    case "REMOVE_MCP_SERVER":
      return {
        ...state,
        mcpServers: state.mcpServers.filter((s) => s.id !== action.payload),
      };
    case "SET_ACTIVE_PANEL":
      return { ...state, activePanel: action.payload };
    // Layout
    case "SET_PAGE":
      return { ...state, currentPage: action.payload, gearMenuOpen: false };
    case "TOGGLE_GEAR_MENU":
      return { ...state, gearMenuOpen: action.payload !== undefined ? action.payload : !state.gearMenuOpen };
    case "TOGGLE_MCP_MODAL":
      return { ...state, mcpModalOpen: action.payload !== undefined ? action.payload : !state.mcpModalOpen, gearMenuOpen: false };
    // AI Sidebar
    case "SET_AI_SIDEBAR_OPEN":
      return { ...state, aiSidebarOpen: action.payload };
    case "SET_AI_SIDEBAR_CONV_ID":
      return { ...state, aiSidebarConversationId: action.payload };
    case "SET_AI_SIDEBAR_MSGS":
      return { ...state, aiSidebarMessages: action.payload.filter(isDisplayableMessage) };
    case "ADD_AI_SIDEBAR_MSG":
      if (!isDisplayableMessage(action.payload)) return state;
      return { ...state, aiSidebarMessages: [...state.aiSidebarMessages, action.payload] };
    case "UPDATE_AI_SIDEBAR_MSG":
      return {
        ...state,
        aiSidebarMessages: state.aiSidebarMessages.map((m) =>
          m.id === action.payload.id ? {
            ...m,
            ...(action.payload.content !== undefined ? { content: action.payload.content } : {}),
            ...(action.payload.thinkingContent !== undefined ? { thinkingContent: action.payload.thinkingContent } : {}),
            ...(action.payload.toolEvents !== undefined ? { toolEvents: action.payload.toolEvents } : {}),
            ...(action.payload.reasoningContent !== undefined ? { reasoningContent: action.payload.reasoningContent } : {}),
            ...(action.payload.thinkingMode !== undefined ? { thinkingMode: action.payload.thinkingMode } : {}),
            ...(action.payload.trustChoicePrompt !== undefined ? { trustChoicePrompt: action.payload.trustChoicePrompt } : {}),
            ...(action.payload.trustChoiceOptions !== undefined ? { trustChoiceOptions: action.payload.trustChoiceOptions } : {}),
          } : m
        ),
      };
    case "REORGANIZE_AI_MSG": {
      const { id: msgId, splitPosition } = action.payload;
      const msg = state.aiSidebarMessages.find((m) => m.id === msgId);
      if (!msg || !msg.toolEvents?.length) return state;
      const lastEndEvent = [...(msg.toolEvents || [])].reverse().find((e) => e.type === "end");
      if (!lastEndEvent) return state;
      const thinkingContent = msg.content.slice(0, splitPosition).trim();
      const finalContent = msg.content.slice(splitPosition).trim();
      if (!finalContent && !thinkingContent) return state;
      return {
        ...state,
        aiSidebarMessages: state.aiSidebarMessages.map((m) =>
          m.id === msgId
            ? { ...m, content: finalContent, thinkingContent }
            : m
        ),
      };
    }
    case "SET_AI_SIDEBAR_MODE":
      return { ...state, aiSidebarMode: action.payload };
    case "SET_AI_SIDEBAR_THINKING_MODE":
      return { ...state, aiSidebarThinkingMode: action.payload };
    // Blog
    case "SET_BLOG_POSTS":
      return { ...state, blogPosts: action.payload };
    case "SET_BLOG_VIEW":
      return { ...state, blogCurrentView: action.payload };
    case "SET_BLOG_CURRENT_POST_ID":
      return { ...state, blogCurrentPostId: action.payload };
    case "SET_BLOG_SELECTED_TAG":
      return { ...state, blogSelectedTag: action.payload };
    case "UPDATE_BLOG_POST":
      return {
        ...state,
        blogPosts: state.blogPosts.map((p) =>
          p.id === action.payload.id ? { ...p, ...action.payload } : p
        ),
      };
    case "APPEND_BLOG_STREAMING":
      return {
        ...state,
        blogStreamingContent: (state.blogStreamingContent ?? "") + action.payload,
      };
    case "CLEAR_BLOG_STREAMING":
      return { ...state, blogStreamingContent: null };
    // AI Selection Context
    case "SET_AI_SELECTION_CONTEXT":
      return { ...state, aiSelectionContext: action.payload };
    case "CLEAR_AI_SELECTION_CONTEXT":
      return { ...state, aiSelectionContext: null };
    // Blog Patch Streaming
    case "START_BLOG_PATCH_STREAMING":
      return {
        ...state,
        blogPatchStreaming: { targetText: action.payload.targetText, replacementDelta: "" },
        blogStreamingContent: null, // 互斥：清除 BLOGDELTA
      };
    case "APPEND_BLOG_PATCH_STREAMING":
      if (!state.blogPatchStreaming) return state;
      return {
        ...state,
        blogPatchStreaming: {
          ...state.blogPatchStreaming,
          replacementDelta: state.blogPatchStreaming.replacementDelta + action.payload,
        },
      };
    case "CLEAR_BLOG_PATCH_STREAMING":
      return { ...state, blogPatchStreaming: null };
    // KB
    case "SET_KB_CATEGORIES":
      return { ...state, kbCategories: action.payload };
    case "SET_KB_SELECTED_CATEGORY_ID":
      return { ...state, kbSelectedCategoryId: action.payload };
    case "SET_KB_SELECTED_FILE":
      return { ...state, kbSelectedFile: action.payload };
    // Research Graph
    case "SET_RESEARCH_TOPICS":
      return { ...state, researchTopics: action.payload };
    case "SET_RESEARCH_CURRENT_TOPIC_ID":
      return { ...state, researchCurrentTopicId: action.payload };
    case "SET_RESEARCH_CURRENT_TOPIC":
      return { ...state, researchCurrentTopic: action.payload };
    case "SET_RESEARCH_SELECTED_CLAIM_ID":
      return { ...state, researchSelectedClaimId: action.payload };
    case "SET_RESEARCH_SELECTED_CONFLICT_ID":
      return { ...state, researchSelectedConflictId: action.payload };
    case "SET_RESEARCH_SELECTED_PROPOSAL_ID":
      return { ...state, researchSelectedProposalId: action.payload };
    case "SET_TRUST_WRITING_ENABLED":
      return { ...state, trustWritingEnabled: action.payload };
    case "SET_PENDING_RESEARCH_PROMPT":
      return { ...state, pendingResearchPrompt: action.payload };
    // Navigation
    case "RESET_TO_BLOG_HOME":
      return {
        ...state,
        currentPage: "blog",
        blogCurrentView: "list",
        blogCurrentPostId: null,
        gearMenuOpen: false,
      };
    // Auth — 登出时清除用户级别 UI 状态（不删后端数据）
    case "LOGOUT":
      return {
        ...state,
        conversations: [],
        currentConversationId: null,
        messages: [],
        aiSidebarConversationId: null,
        aiSidebarMessages: [],
        blogPosts: [],
        blogCurrentView: "list",
        blogCurrentPostId: null,
        blogSelectedTag: null,
        blogStreamingContent: null,
        aiSelectionContext: null,
        blogPatchStreaming: null,
        kbCategories: [],
        kbDocuments: [],
        kbSelectedCategoryId: null,
        kbSelectedFile: null,
        researchTopics: [],
        researchCurrentTopicId: null,
        researchCurrentTopic: null,
        researchSelectedClaimId: null,
        researchSelectedConflictId: null,
        researchSelectedProposalId: null,
        trustWritingEnabled: false,
        pendingResearchPrompt: null,
        mcpServers: [],
      };
    default:
      return state;
  }
}

const savedTheme = (localStorage.getItem("theme") as Theme) || "light";

function getInitialPage(): Page {
  const path = window.location.pathname;
  if (path.startsWith("/knowledge")) return "knowledge";
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
  kbDocuments: [],
  mcpServers: [],
  activePanel: "conversations",

  // Layout
  currentPage: getInitialPage(),
  gearMenuOpen: false,
  mcpModalOpen: false,

  // AI Sidebar — default open, no conversation yet
  aiSidebarOpen: true,
  aiSidebarConversationId: null,
  aiSidebarMessages: [],
  aiSidebarMode: "auto",
  aiSidebarThinkingMode: "normal",

  // Blog
  blogPosts: [],
  blogCurrentView: "list",
  blogCurrentPostId: null,
  blogSelectedTag: null,
  blogStreamingContent: null,
  aiSelectionContext: null,
  blogPatchStreaming: null,

  // KB
  kbCategories: [],
  kbSelectedCategoryId: null,
  kbSelectedFile: null,

  // Research Graph
  researchTopics: [],
  researchCurrentTopicId: null,
  researchCurrentTopic: null,
  researchSelectedClaimId: null,
  researchSelectedConflictId: null,
  researchSelectedProposalId: null,
  trustWritingEnabled: false,
  pendingResearchPrompt: null,
};

const ChatContext = createContext<{
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
}>({ state: initialState, dispatch: () => {} });

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  return (
    <ChatContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
}

export function toggleTheme(dispatch: React.Dispatch<ChatAction>) {
  const current = localStorage.getItem("theme") as Theme || "light";
  const next: Theme = current === "dark" ? "light" : "dark";
  dispatch({ type: "SET_THEME", payload: next });
}

export type { Message, Conversation, KBDocument, BlogPost, KBCategory, ChatState, ChatAction, Theme, Panel, Page, BlogView, AISidebarMode, ThinkingMode, ToolEvent, Reference, ResearchTopicDetail, ResearchTopicSummary };
