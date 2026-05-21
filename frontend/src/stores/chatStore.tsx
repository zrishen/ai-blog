import { createContext, useContext, useReducer } from "react";
import type { MCPServerConfig } from "../api/client";

interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  image_url?: string;
  file_url?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_results?: string[];
  token_count: number;
  created_at: string;
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
  created_at: string;
}

type Theme = "dark" | "light";
type Panel = "conversations" | "knowledge" | "mcp";

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
  | { type: "SET_ACTIVE_PANEL"; payload: Panel };

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
    default:
      return state;
  }
}

const savedTheme = (localStorage.getItem("theme") as Theme) || "dark";

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
};

document.documentElement.setAttribute("data-theme", savedTheme);

const ChatContext = createContext<{
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
}>({ state: initialState, dispatch: () => {} });

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
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
  const current = localStorage.getItem("theme") as Theme || "dark";
  const next: Theme = current === "dark" ? "light" : "dark";
  dispatch({ type: "SET_THEME", payload: next });
}
