import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../stores/authStore";
import { useChat } from "../../stores/chatStore";
import type { AISidebarConversationKey, Conversation, ToolEvent } from "../../stores/chatStore";
import { fetchConversations } from "../../api/client";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AISidebarHeader } from "./ai-sidebar/AISidebarHeader";
import {
  type AISidebarProps,
} from "./ai-sidebar/constants";
import { useAISidebarThinkingMode } from "./hooks/useAISidebarThinkingMode";
import { useAISidebarScroll } from "./hooks/useAISidebarScroll";
import { AISidebarRuntimeContext, type AISidebarRuntime } from "./ai-sidebar/AISidebarRuntimeContext";
import { AISidebarList } from "./ai-sidebar/AISidebarList";
import { AISidebarChat } from "./ai-sidebar/AISidebarChat";

const SHARED_CONVERSATION_KEY: AISidebarConversationKey = "temp:shared";
const AI_SIDEBAR_VIEW_STORAGE_KEY = "ai-sidebar-view";
const AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY = "ai-sidebar-selected-key";

export interface RunState {
  finalContent: string;
  reasoningContent: string;
  toolEvents: ToolEvent[];
  streamFinalized: boolean;
  streamError: string | null;
  assistantStartedAt: number;
  assistantMessageId: number;
  conversationId: number | null;
}

function makeTempKey(): AISidebarConversationKey {
  return `temp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AISidebar({ mode, contextText = "", siteUsername, postSlug, pageType = "other", postTitle }: AISidebarProps) {
  const { state, dispatch } = useChat();
  const { user } = useAuth();
  const userId = user?.id;
  const [sidebarView, setSidebarView] = useState<"list" | "chat">(() => {
    if (mode !== "private") return "chat";
    const storedView = localStorage.getItem(AI_SIDEBAR_VIEW_STORAGE_KEY);
    const storedKey = localStorage.getItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
    return storedView === "chat" && storedKey?.startsWith("server:") ? "chat" : "list";
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const abortControllersRef = useRef(new Map<AISidebarConversationKey, AbortController>());
  const runRefs = useRef(new Map<AISidebarConversationKey, RunState>());
  const loadConvsSeqRef = useRef(0);

  const isPrivate = mode === "private";
  const selectedKey = isPrivate ? state.aiSidebarSelectedKey : SHARED_CONVERSATION_KEY;

  const handleThinkingModeChange = useAISidebarThinkingMode(userId);

  useEffect(() => {
    if (!isPrivate || state.aiSidebarSelectedKey) return;
    const storedView = localStorage.getItem(AI_SIDEBAR_VIEW_STORAGE_KEY);
    const storedKey = localStorage.getItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY) as AISidebarConversationKey | null;
    if (storedView === "chat" && storedKey?.startsWith("server:")) {
      queueMicrotask(() => {
        dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: storedKey });
        setSidebarView("chat");
      });
    }
  }, [dispatch, isPrivate, state.aiSidebarSelectedKey]);

  const getActiveKey = useCallback((): AISidebarConversationKey => {
    if (!isPrivate) return SHARED_CONVERSATION_KEY;
    if (state.aiSidebarSelectedKey) return state.aiSidebarSelectedKey;
    const key = makeTempKey();
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: key });
    dispatch({ type: "SET_AI_SIDEBAR_MSGS_FOR_KEY", payload: { key, messages: [] } });
    dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key, history: { loading: false, error: null } } });
    return key;
  }, [dispatch, isPrivate, state.aiSidebarSelectedKey]);

  const setInputForKey = useCallback((key: AISidebarConversationKey, input: string) => {
    dispatch({ type: "SET_AI_SIDEBAR_INPUT_FOR_KEY", payload: { key, input } });
  }, [dispatch]);

  const {
    msgsEndRef,
    messagesViewportRef,
    isAtBottom,
    scrollToLatest,
    scrollToLatestAfterRender,
  } = useAISidebarScroll(selectedKey);

  useEffect(() => {
    if (!isPrivate) {
      queueMicrotask(() => {
        setSidebarView("chat");
        setConversations([]);
        dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: SHARED_CONVERSATION_KEY });
        dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: null });
      });
    }
  }, [dispatch, isPrivate]);

  const loadConvs = useCallback(async () => {
    if (!isPrivate) return;
    const seq = ++loadConvsSeqRef.current;
    try {
      const data = await fetchConversations();
      if (seq === loadConvsSeqRef.current) setConversations(data.conversations || []);
    } catch { /* 加载会话列表失败静默；UI 显示空列表即可 */ }
  }, [isPrivate]);

  useEffect(() => {
    if (isPrivate) queueMicrotask(() => void loadConvs());
  }, [isPrivate, loadConvs, state.trashRevision]);

  // 有选中上下文(AI 修改)时,自动切到 chat 视图(避免 list 视图下选中上下文丢失)
  useEffect(() => {
    if (state.aiSelectionContext && sidebarView !== "chat") {
      // 选中上下文来自编辑器外部事件，需要在这里同步侧栏视图
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarView("chat");
    }
  }, [state.aiSelectionContext, sidebarView]);

  const handleNewChat = useCallback(async () => {
    const key = makeTempKey();
    localStorage.setItem(AI_SIDEBAR_VIEW_STORAGE_KEY, "chat");
    localStorage.removeItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: key });
    dispatch({ type: "SET_AI_SIDEBAR_MSGS_FOR_KEY", payload: { key, messages: [] } });
    dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key, history: { loading: false, error: null } } });
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key, error: null } });
    setSidebarView("chat");
    if (isPrivate) await loadConvs();
  }, [dispatch, isPrivate, loadConvs]);

  const handleBackToList = useCallback(() => {
    if (!isPrivate) return;
    localStorage.setItem(AI_SIDEBAR_VIEW_STORAGE_KEY, "list");
    setSidebarView("list");
  }, [isPrivate]);

  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  // 运行时 Context value：跨 list/chat/runChatStream 共享。useMemo 稳定身份，避免消费端 effect 无谓重跑。
  const runtime: AISidebarRuntime = useMemo(() => ({
    isPrivate,
    selectedKey,
    sidebarView,
    setSidebarView,
    getActiveKey,
    setInputForKey,
    loadConvs,
    conversations,
    abortControllersRef,
    runRefs,
    scrollToLatestAfterRender,
    handleNewChat,
    handleBackToList,
    historyReloadKey,
    setHistoryReloadKey,
  }), [isPrivate, selectedKey, sidebarView, conversations, setSidebarView, getActiveKey, setInputForKey, loadConvs, abortControllersRef, runRefs, scrollToLatestAfterRender, handleNewChat, handleBackToList, historyReloadKey, setHistoryReloadKey]);

  if (!state.aiSidebarOpen) {
    return (
      <aside className="relative flex h-full w-full flex-col items-center border-l border-border/80 bg-card/82 pt-3 shadow-[-12px_0_35px_hsl(var(--foreground)/0.03)] backdrop-blur-xl">
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 rounded-2xl border border-border/70 bg-background/70 text-primary shadow-sm hover:bg-primary/10"
          onClick={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true })}
          title={isPrivate ? "展开私人 AI" : "展开共享 AI"}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full w-full flex-col border-l border-border/80 bg-card/82 shadow-[-12px_0_35px_hsl(var(--foreground)/0.04)] backdrop-blur-xl">
      <AISidebarRuntimeContext.Provider value={runtime}>
      <AISidebarHeader
        isPrivate={isPrivate}
        sidebarView={sidebarView}
        onCollapse={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: false })}
        onBackToList={handleBackToList}
        onNewChat={handleNewChat}
        onThinkingModeChange={handleThinkingModeChange}
      />

      {isPrivate && sidebarView === "list" ? (
        <AISidebarList />
      ) : (
        <AISidebarChat
          isPrivate={isPrivate}
          contextText={contextText}
          siteUsername={siteUsername}
          postSlug={postSlug}
          pageType={pageType}
          postTitle={postTitle}
          msgsEndRef={msgsEndRef}
          messagesViewportRef={messagesViewportRef}
          isAtBottom={isAtBottom}
          scrollToLatest={scrollToLatest}
        />
      )}
      </AISidebarRuntimeContext.Provider>
    </aside>
  );
}
