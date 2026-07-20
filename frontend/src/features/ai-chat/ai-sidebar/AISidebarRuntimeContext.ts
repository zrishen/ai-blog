import { createContext, useContext } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AISidebarConversationKey, Conversation } from "../../../stores/chatStore";
import type { RunState } from "../AISidebar";

// AISidebar 运行时 Context：跨 list/chat/runChatStream 共享的 state/ref/handler。
// Provider 用 inline 方式写在 AISidebar.tsx 的 return 里（不建独立 Provider 组件），
// 这样 loadConvs effect + trashRevision marker 留在 AISidebar.tsx，revisionListeners 零改动。
// state.* 与 dispatch 不进 Context——子组件自己 useChat() 取（契合 useResearchRuns 范式）。
export interface AISidebarRuntime {
  isPrivate: boolean;
  selectedKey: AISidebarConversationKey | null;
  sidebarView: "list" | "chat";
  setSidebarView: (view: "list" | "chat") => void;
  getActiveKey: () => AISidebarConversationKey;
  setInputForKey: (key: AISidebarConversationKey, input: string) => void;
  loadConvs: () => Promise<void>;
  conversations: Conversation[];
  abortControllersRef: RefObject<Map<AISidebarConversationKey, AbortController>>;
  runRefs: RefObject<Map<AISidebarConversationKey, RunState>>;
  scrollToLatestAfterRender: (key: AISidebarConversationKey, behavior?: ScrollBehavior) => void;
  handleNewChat: () => Promise<void>;
  handleBackToList: () => void;
  historyReloadKey: number;
  setHistoryReloadKey: Dispatch<SetStateAction<number>>;
}

export const AISidebarRuntimeContext = createContext<AISidebarRuntime | null>(null);

export function useAISidebarRuntime(): AISidebarRuntime {
  const ctx = useContext(AISidebarRuntimeContext);
  if (!ctx) {
    throw new Error("useAISidebarRuntime must be used within AISidebarRuntimeContext.Provider");
  }
  return ctx;
}
