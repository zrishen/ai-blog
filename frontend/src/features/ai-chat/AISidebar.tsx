import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MessageSquare } from "lucide-react";

import { useChat } from "../../stores/chatStore";
import { useAuth } from "../../stores/authStore";

import { AISidebarHeader } from "./ai-sidebar/AISidebarHeader";
import {
  loadAISidebarSession,
  saveAISidebarSession,
  type AISidebarProps,
} from "./ai-sidebar/constants";
import { useAISidebarThinkingMode } from "./hooks/useAISidebarThinkingMode";
import { useAISidebarScroll } from "./hooks/useAISidebarScroll";
import { AISidebarRuntimeContext, type AISidebarRuntime } from "./ai-sidebar/AISidebarRuntimeContext";
import { AISidebarList } from "./ai-sidebar/AISidebarList";
import { AISidebarChat } from "./ai-sidebar/AISidebarChat";

import type { AISidebarConversationKey, Conversation, ToolEvent } from "../../stores/chatStore";

import { fetchConversations } from "@/api/conversations";
import { Button } from "@/components/ui/button";
import { WorkspacePanel } from "@/components/ui/workspace-panel";

const SHARED_CONVERSATION_KEY: AISidebarConversationKey = "temp:shared";

export interface RunState {
  finalContent: string;
  reasoningContent: string;
  toolEvents: ToolEvent[];
  streamFinalized: boolean;
  streamError: string | null;
  assistantStartedAt: number;
  assistantMessageId: number;
  assistantPersistedMessageId?: number;
  userMessageId?: number;
  conversationId: number | null;
}

function makeTempKey(): AISidebarConversationKey {
  return `temp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AISidebar({ mode, contextText = "", siteUsername, postSlug, pageType = "other", postTitle, onRequestClose, forceExpanded = false }: AISidebarProps) {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated, isInitializing } = useAuth();
  const userId = user?.id;
  const [sidebarView, setSidebarView] = useState<"list" | "chat">("list");
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const abortControllersRef = useRef(new Map<AISidebarConversationKey, AbortController>());
  const runRefs = useRef(new Map<AISidebarConversationKey, RunState>());
  const loadConvsSeqRef = useRef(0);
  const initializedScopeRef = useRef<string | null>(null);

  const isPrivate = mode === "private";
  const currentScope = mode === "pending" ? "pending" : isPrivate && userId ? `private:${userId}` : mode;
  const selectedKey = mode === "shared" ? SHARED_CONVERSATION_KEY : isPrivate ? state.aiSidebarSelectedKey : null;

  const handleThinkingModeChange = useAISidebarThinkingMode(userId);

  useEffect(() => {
    if (mode === "pending" || initializedScopeRef.current === currentScope) return;
    initializedScopeRef.current = currentScope;
    queueMicrotask(() => {
      if (mode === "shared") {
        setSidebarView("chat");
        setConversations([]);
        setReadyScope(currentScope);
        return;
      }
      if (!userId) return;

      const session = loadAISidebarSession(userId);
      if (session.view === "list") {
        setSidebarView("list");
        dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: null });
        dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: null });
      } else if (session.target.kind === "server") {
        setSidebarView("chat");
        dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: `server:${session.target.conversationId}` });
      } else {
        const currentKey = state.aiSidebarSelectedKey;
        const key = currentKey?.startsWith("temp:") && currentKey !== SHARED_CONVERSATION_KEY
          ? currentKey
          : makeTempKey();
        setSidebarView("chat");
        dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: key });
        if (!state.aiSidebarMessagesByKey[key]) {
          dispatch({ type: "SET_AI_SIDEBAR_MSGS_FOR_KEY", payload: { key, messages: [] } });
          dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key, history: { loading: false, error: null } } });
        }
      }
      setReadyScope(currentScope);
    });
  }, [currentScope, dispatch, mode, state.aiSidebarMessagesByKey, state.aiSidebarSelectedKey, userId]);

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

  const loadConvs = useCallback(async () => {
    if (!isPrivate || isInitializing || !isAuthenticated || !userId) return;
    const seq = ++loadConvsSeqRef.current;
    try {
      const data = await fetchConversations();
      if (seq === loadConvsSeqRef.current) setConversations(data.conversations || []);
    } catch { /* 加载会话列表失败静默；UI 显示空列表即可 */ }
  }, [isAuthenticated, isInitializing, isPrivate, userId]);

  useEffect(() => {
    if (!isPrivate || isInitializing || !isAuthenticated || !userId) return;
    queueMicrotask(() => void loadConvs());
  }, [isAuthenticated, isInitializing, isPrivate, loadConvs, state.trashRevision, userId]);

  // 有选中上下文(AI 修改)时,自动切到 chat 视图(避免 list 视图下选中上下文丢失)
  useEffect(() => {
    if ((state.aiSelectionContext || state.aiLeftbarEditContext) && sidebarView !== "chat") {
      // 选中上下文来自编辑器外部事件，需要在这里同步侧栏视图
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarView("chat");
    }
  }, [state.aiSelectionContext, state.aiLeftbarEditContext, sidebarView]);

  const handleNewChat = useCallback(async () => {
    const key = makeTempKey();
    if (userId) saveAISidebarSession(userId, { version: 1, view: "chat", target: { kind: "new" } });
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: key });
    dispatch({ type: "SET_AI_SIDEBAR_MSGS_FOR_KEY", payload: { key, messages: [] } });
    dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key, history: { loading: false, error: null } } });
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key, error: null } });
    setSidebarView("chat");
    if (isPrivate) await loadConvs();
  }, [dispatch, isPrivate, loadConvs, userId]);

  const handleBackToList = useCallback(() => {
    if (!isPrivate || !userId) return;
    saveAISidebarSession(userId, { version: 1, view: "list" });
    setSidebarView("list");
  }, [isPrivate, userId]);

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

  if (mode === "pending" || readyScope !== currentScope) {
    return (
      <WorkspacePanel side="right" className="relative" />
    );
  }

  if (!state.aiSidebarOpen && !forceExpanded) {
    return (
      <WorkspacePanel side="right" className="relative items-center pt-3">
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 rounded-panel border border-border/70 bg-background/70 text-primary shadow-sm hover:bg-primary/10"
          onClick={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true })}
          title={isPrivate ? "展开私人 AI" : "展开共享 AI"}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      </WorkspacePanel>
    );
  }

  return (
    <WorkspacePanel side="right" className="relative">
      <AISidebarRuntimeContext.Provider value={runtime}>
      <AISidebarHeader
        isPrivate={isPrivate}
        sidebarView={sidebarView}
        onCollapse={() => {
          if (onRequestClose) {
            onRequestClose();
            return;
          }
          dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: false });
        }}
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
    </WorkspacePanel>
  );
}
