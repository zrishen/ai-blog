/* eslint-disable react-refresh/only-export-components */
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
  callId?: string;
  roundId?: number;
  loopStepIndex?: number;
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
  streamingRound?: string;
  streamFinalized?: boolean;
  streamError?: string;
  toolEvents?: ToolEvent[];
  reasoningContent?: string;
  loopSteps?: string[];
  thinkingMode?: ThinkingMode;
  thinkingDurationMs?: number;
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

interface FileDocument {
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

interface FileCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent_id: number | null;
  children?: FileCategory[];
  created_at: string;
}

type Theme = "dark" | "light";
type Panel = "conversations" | "files" | "mcp";
type Page = "blog" | "files" | "research";
type BlogView = "list" | "view" | "edit";
type ThinkingMode = "fast" | "balanced" | "smart";
type AISidebarConversationKey = `server:${number}` | `temp:${string}`;

interface AISidebarHistoryState {
  loading: boolean;
  error: string | null;
}

type AIStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "loop"; content: string; roundId?: number; loopStepIndex?: number }
  | { type: "final"; content: string }
  | { type: "discard" }
  | { type: "error"; message: string };

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
  | { type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number; content?: string; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number; trustChoicePrompt?: string | null; trustChoiceOptions?: TrustChoiceOption[] } }
  | { type: "APPLY_AI_STREAM_EVENT"; payload: { id: number; event: AIStreamEvent } }
  | { type: "APPLY_AI_STREAM_EVENT_FOR_KEY"; payload: { key: AISidebarConversationKey; id: number; event: AIStreamEvent } }
  | { type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY"; payload: { key: AISidebarConversationKey; streaming: boolean } }
  | { type: "SET_AI_SIDEBAR_INPUT_FOR_KEY"; payload: { key: AISidebarConversationKey; input: string } }
  | { type: "SET_AI_SIDEBAR_ERROR_FOR_KEY"; payload: { key: AISidebarConversationKey; error: string | null } }
  | { type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY"; payload: { key: AISidebarConversationKey; history: AISidebarHistoryState } }
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
  // Navigation
  | { type: "RESET_TO_BLOG_HOME" }
  // Auth
  | { type: "LOGOUT" };

function updateMessageWithPayload(
  message: Message,
  payload: { content?: string; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number; trustChoicePrompt?: string | null; trustChoiceOptions?: TrustChoiceOption[] },
): Message {
  return {
    ...message,
    ...(payload.content !== undefined ? { content: payload.content } : {}),
    ...(payload.thinkingContent !== undefined ? { thinkingContent: payload.thinkingContent } : {}),
    ...(payload.streamingRound !== undefined ? { streamingRound: payload.streamingRound } : {}),
    ...(payload.streamFinalized !== undefined ? { streamFinalized: payload.streamFinalized } : {}),
    ...(payload.streamError !== undefined ? { streamError: payload.streamError } : {}),
    ...(payload.toolEvents !== undefined ? { toolEvents: payload.toolEvents } : {}),
    ...(payload.reasoningContent !== undefined ? { reasoningContent: payload.reasoningContent } : {}),
    ...(payload.loopSteps !== undefined ? { loopSteps: payload.loopSteps } : {}),
    ...(payload.thinkingMode !== undefined ? { thinkingMode: payload.thinkingMode } : {}),
    ...(payload.thinkingDurationMs !== undefined ? { thinkingDurationMs: payload.thinkingDurationMs } : {}),
    ...(payload.trustChoicePrompt !== undefined ? { trustChoicePrompt: payload.trustChoicePrompt } : {}),
    ...(payload.trustChoiceOptions !== undefined ? { trustChoiceOptions: payload.trustChoiceOptions } : {}),
  };
}

function applyStreamEvent(message: Message, event: AIStreamEvent): Message {
  switch (event.type) {
    case "delta":
      return { ...message, streamingRound: (message.streamingRound ?? "") + event.delta };
    case "loop":
      return {
        ...message,
        streamingRound: "",
        loopSteps: [...(message.loopSteps ?? []), event.content],
      };
    case "final":
      return {
        ...message,
        content: event.content,
        streamingRound: "",
        streamFinalized: true,
        streamError: undefined,
      };
    case "discard":
      return { ...message, streamingRound: "" };
    case "error":
      return { ...message, streamingRound: "", streamError: event.message };
  }
}

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
    case "APPLY_MESSAGE_STREAM_EVENT":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.id ? applyStreamEvent(m, action.payload.event) : m
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
    case "SET_FILE_DOCUMENTS":
      return { ...state, fileDocuments: action.payload };
    case "REMOVE_FILE_DOCUMENT":
      return {
        ...state,
        fileDocuments: state.fileDocuments.filter((d) => d.id !== action.payload),
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
    case "SET_AI_SIDEBAR_SELECTED_KEY":
      return {
        ...state,
        aiSidebarSelectedKey: action.payload,
        aiSidebarConversationId: action.payload?.startsWith("server:") ? Number(action.payload.slice(7)) : null,
        aiSidebarMessages: action.payload ? state.aiSidebarMessagesByKey[action.payload] ?? [] : [],
      };
    case "SET_AI_SIDEBAR_MSGS":
      return { ...state, aiSidebarMessages: action.payload.filter(isDisplayableMessage) };
    case "SET_AI_SIDEBAR_MSGS_FOR_KEY": {
      const messages = action.payload.messages.filter(isDisplayableMessage);
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [action.payload.key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === action.payload.key ? messages : state.aiSidebarMessages,
      };
    }
    case "ADD_AI_SIDEBAR_MSG":
      if (!isDisplayableMessage(action.payload)) return state;
      return { ...state, aiSidebarMessages: [...state.aiSidebarMessages, action.payload] };
    case "ADD_AI_SIDEBAR_MSG_FOR_KEY": {
      if (!isDisplayableMessage(action.payload.message)) return state;
      const current = state.aiSidebarMessagesByKey[action.payload.key] ?? [];
      const messages = [...current, action.payload.message];
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [action.payload.key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === action.payload.key ? messages : state.aiSidebarMessages,
      };
    }
    case "UPDATE_AI_SIDEBAR_MSG":
      return {
        ...state,
        aiSidebarMessages: state.aiSidebarMessages.map((m) =>
          m.id === action.payload.id ? updateMessageWithPayload(m, action.payload) : m
        ),
      };
    case "UPDATE_AI_SIDEBAR_MSG_FOR_KEY": {
      const current = state.aiSidebarMessagesByKey[action.payload.key] ?? [];
      const messages = current.map((m) =>
        m.id === action.payload.id ? updateMessageWithPayload(m, action.payload) : m
      );
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [action.payload.key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === action.payload.key ? messages : state.aiSidebarMessages,
      };
    }
    case "APPLY_AI_STREAM_EVENT":
      return {
        ...state,
        aiSidebarMessages: state.aiSidebarMessages.map((m) =>
          m.id === action.payload.id ? applyStreamEvent(m, action.payload.event) : m
        ),
      };
    case "APPLY_AI_STREAM_EVENT_FOR_KEY": {
      const { key, id, event } = action.payload;
      const current = state.aiSidebarMessagesByKey[key] ?? [];
      const messages = current.map((m) => (m.id === id ? applyStreamEvent(m, event) : m));
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === key ? messages : state.aiSidebarMessages,
      };
    }
    case "SET_AI_SIDEBAR_STREAMING_FOR_KEY":
      return {
        ...state,
        aiSidebarStreamingByKey: { ...state.aiSidebarStreamingByKey, [action.payload.key]: action.payload.streaming },
      };
    case "SET_AI_SIDEBAR_INPUT_FOR_KEY":
      return {
        ...state,
        aiSidebarInputsByKey: { ...state.aiSidebarInputsByKey, [action.payload.key]: action.payload.input },
      };
    case "SET_AI_SIDEBAR_ERROR_FOR_KEY":
      return {
        ...state,
        aiSidebarErrorsByKey: { ...state.aiSidebarErrorsByKey, [action.payload.key]: action.payload.error },
      };
    case "SET_AI_SIDEBAR_HISTORY_FOR_KEY":
      return {
        ...state,
        aiSidebarHistoryByKey: { ...state.aiSidebarHistoryByKey, [action.payload.key]: action.payload.history },
      };
    case "MIGRATE_AI_SIDEBAR_TEMP_KEY": {
      const { fromKey, toKey, conversationId } = action.payload;
      const fromMessages = state.aiSidebarMessagesByKey[fromKey] ?? [];
      const toMessages = fromMessages.map((m) => ({ ...m, conversation_id: conversationId }));
      const {
        [fromKey]: _removedMessages,
        ...messagesByKey
      } = state.aiSidebarMessagesByKey;
      const { [fromKey]: removedStreaming, ...streamingByKey } = state.aiSidebarStreamingByKey;
      const { [fromKey]: removedInput, ...inputsByKey } = state.aiSidebarInputsByKey;
      const { [fromKey]: removedError, ...errorsByKey } = state.aiSidebarErrorsByKey;
      const { [fromKey]: removedHistory, ...historyByKey } = state.aiSidebarHistoryByKey;
      void _removedMessages;
      return {
        ...state,
        aiSidebarSelectedKey: state.aiSidebarSelectedKey === fromKey ? toKey : state.aiSidebarSelectedKey,
        aiSidebarConversationId: state.aiSidebarSelectedKey === fromKey ? conversationId : state.aiSidebarConversationId,
        aiSidebarMessages: state.aiSidebarSelectedKey === fromKey ? toMessages : state.aiSidebarMessages,
        aiSidebarMessagesByKey: { ...messagesByKey, [toKey]: toMessages },
        aiSidebarStreamingByKey: { ...streamingByKey, [toKey]: removedStreaming ?? false },
        aiSidebarInputsByKey: { ...inputsByKey, [toKey]: removedInput ?? "" },
        aiSidebarErrorsByKey: { ...errorsByKey, [toKey]: removedError ?? null },
        aiSidebarHistoryByKey: { ...historyByKey, [toKey]: removedHistory ?? { loading: false, error: null } },
      };
    }
    case "REMOVE_AI_SIDEBAR_THREAD": {
      const { key } = action.payload;
      const { [key]: removedMessages, ...messagesByKey } = state.aiSidebarMessagesByKey;
      const { [key]: removedStreaming, ...streamingByKey } = state.aiSidebarStreamingByKey;
      const { [key]: removedInput, ...inputsByKey } = state.aiSidebarInputsByKey;
      const { [key]: removedError, ...errorsByKey } = state.aiSidebarErrorsByKey;
      const { [key]: removedHistory, ...historyByKey } = state.aiSidebarHistoryByKey;
      void removedMessages;
      void removedStreaming;
      void removedInput;
      void removedError;
      void removedHistory;
      return {
        ...state,
        aiSidebarSelectedKey: state.aiSidebarSelectedKey === key ? null : state.aiSidebarSelectedKey,
        aiSidebarConversationId: state.aiSidebarSelectedKey === key ? null : state.aiSidebarConversationId,
        aiSidebarMessages: state.aiSidebarSelectedKey === key ? [] : state.aiSidebarMessages,
        aiSidebarMessagesByKey: messagesByKey,
        aiSidebarStreamingByKey: streamingByKey,
        aiSidebarInputsByKey: inputsByKey,
        aiSidebarErrorsByKey: errorsByKey,
        aiSidebarHistoryByKey: historyByKey,
      };
    }
    case "SET_AI_SIDEBAR_THINKING_MODE":
      return { ...state, aiSidebarThinkingMode: action.payload };
    case "SET_LLM_SUPPORTS_THINKING":
      return { ...state, llmSupportsThinking: action.payload };
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
      };
    case "APPEND_BLOG_PATCH_STREAMING":
      if (!state.blogPatchStreaming) return state;
      return {
        ...state,
        blogPatchStreaming: {
          targetText: state.blogPatchStreaming.targetText,
          replacementDelta: state.blogPatchStreaming.replacementDelta + action.payload.replacementDelta,
        },
      };
    case "CLEAR_BLOG_PATCH_STREAMING":
      return { ...state, blogPatchStreaming: null };
    // File Library
    case "SET_FILE_CATEGORIES":
      return { ...state, fileCategories: action.payload };
    case "SET_FILE_SELECTED_CATEGORY_ID":
      return { ...state, fileSelectedCategoryId: action.payload };
    case "SET_FILE_SELECTED_FILE":
      return { ...state, fileSelectedFile: action.payload };
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
    // File processing / Trash
    case "INCREMENT_FILE_LIBRARY_REVISION":
      return { ...state, fileLibraryRevision: state.fileLibraryRevision + 1 };
    case "INCREMENT_FILE_RESTORE_REVISIONS":
      return {
        ...state,
        fileLibraryRevision: state.fileLibraryRevision + 1,
        trashRevision: state.trashRevision + 1,
      };
    case "INCREMENT_TRASH_REVISION":
      return { ...state, trashRevision: state.trashRevision + 1 };
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
        aiSidebarSelectedKey: null,
        aiSidebarMessages: [],
        aiSidebarMessagesByKey: {},
        aiSidebarStreamingByKey: {},
        aiSidebarInputsByKey: {},
        aiSidebarErrorsByKey: {},
        aiSidebarHistoryByKey: {},
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

export type { Message, Conversation, FileDocument, BlogPost, FileCategory, ChatState, ChatAction, Theme, Panel, Page, BlogView, ThinkingMode, AISidebarConversationKey, AISidebarHistoryState, AIStreamEvent, ToolEvent, Reference, ResearchTopicDetail, ResearchTopicSummary };
