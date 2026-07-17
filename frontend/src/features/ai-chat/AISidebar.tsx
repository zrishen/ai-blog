import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../stores/authStore";
import type { AuthUser } from "../../stores/authStore";
import { isDisplayableMessage, useChat } from "../../stores/chatStore";
import type { AISidebarConversationKey, Conversation, Message, Reference, ToolEvent } from "../../stores/chatStore";
import {
  sendChat,
  sendSharedLandingChat,
  sendSharedUserChat,
  getMessages,
  fetchConversations,
  deleteConversation,
  listSitePosts,
  getBlogPost,
  getResearchTopic,
  runResearchTopic,
  listResearchTopics,
  createResearchTopic,
} from "../../api/client";
import type { BlogToolMeta, StreamReference } from "../../api/client";
import type { ThinkingMode } from "../../api/chat";
import { TrustContextIndicator } from "./TrustContextIndicator";
import {
  buildDraftChoices,
  buildExplainConflictsPrompt,
  buildOpenResearchChoices,
  buildResearchRunPrompt,
  buildTrustedDraftPrompt,
  buildTopicSelectChoices,
  parseTrustChoicePayload,
  stripTrustChoicePayload,
} from "./trustPrompts";
import type { TrustChoiceOption, TrustChoicePayload } from "./trustPrompts";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LoginDialog } from "@/features/auth/LoginDialog";
import { AISidebarHeader } from "./ai-sidebar/AISidebarHeader";
import { ConversationListView, type ConversationListItem } from "./ai-sidebar/ConversationListView";
import { ChatInputBar } from "./ai-sidebar/ChatInputBar";
import { MessageList } from "./ai-sidebar/MessageList";
import { createPatchDeltaPlayer, type PatchDeltaPlayer } from "./ai-sidebar/patchDeltaPlayer";
import {
  blogToolOperations,
  DEFAULT_AI_SIDEBAR_THINKING_MODE,
  loadAISidebarThinkingMode,
  RESEARCH_TOOL_NAMES,
  saveAISidebarThinkingMode,
  type AISidebarProps,
} from "./ai-sidebar/constants";

const SHARED_CONVERSATION_KEY: AISidebarConversationKey = "temp:shared";
const AI_SIDEBAR_VIEW_STORAGE_KEY = "ai-sidebar-view";
const AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY = "ai-sidebar-selected-key";

interface RunState {
  finalContent: string;
  reasoningContent: string;
  toolEvents: ToolEvent[];
  streamFinalized: boolean;
  streamError: string | null;
  assistantStartedAt: number;
  assistantMessageId: number;
  conversationId: number | null;
}

function makeServerKey(conversationId: number): AISidebarConversationKey {
  return `server:${conversationId}`;
}

function makeTempKey(): AISidebarConversationKey {
  return `temp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getConversationIdFromKey(key: AISidebarConversationKey | null): number | null {
  return key?.startsWith("server:") ? Number(key.slice(7)) : null;
}

function buildMessageGroups(messages: Message[]) {
  return messages.filter(isDisplayableMessage).reduce<Array<{ role: Message["role"]; messages: Message[] }>>((groups, msg) => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.role === "assistant" && msg.role === "assistant") {
      lastGroup.messages.push(msg);
      return groups;
    }
    groups.push({ role: msg.role, messages: [msg] });
    return groups;
  }, []);
}

export function AISidebar({ mode, contextText = "", siteUsername, postSlug, pageType = "other", postTitle }: AISidebarProps) {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [topicCreateMode, setTopicCreateMode] = useState(false);
  const [topicCreateMessageId, setTopicCreateMessageId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ key: AISidebarConversationKey; id: number | null } | null>(null);
  const [sidebarView, setSidebarView] = useState<"list" | "chat">(() => {
    if (mode !== "private") return "chat";
    const storedView = localStorage.getItem(AI_SIDEBAR_VIEW_STORAGE_KEY);
    const storedKey = localStorage.getItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
    return storedView === "chat" && storedKey?.startsWith("server:") ? "chat" : "list";
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const abortControllersRef = useRef(new Map<AISidebarConversationKey, AbortController>());
  const runRefs = useRef(new Map<AISidebarConversationKey, RunState>());
  const historyRequestSeqRef = useRef(new Map<AISidebarConversationKey, number>());
  const streamingByKeyRef = useRef(state.aiSidebarStreamingByKey);
  const skipNextHistoryLoadRef = useRef(new Set<number>());
  const loadConvsSeqRef = useRef(0);
  const blogStreamOwnerRef = useRef<AISidebarConversationKey | null>(null);
  const selectedKeyRef = useRef<AISidebarConversationKey | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginRedirectTarget, setLoginRedirectTarget] = useState<"files" | "research" | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const isPrivate = mode === "private";
  const selectedKey = isPrivate ? state.aiSidebarSelectedKey : SHARED_CONVERSATION_KEY;
  const selectedMessages = useMemo(
    () => (selectedKey ? state.aiSidebarMessagesByKey[selectedKey] ?? [] : []),
    [selectedKey, state.aiSidebarMessagesByKey],
  );
  const selectedStreaming = selectedKey ? !!state.aiSidebarStreamingByKey[selectedKey] : false;
  const selectedInput = selectedKey ? state.aiSidebarInputsByKey[selectedKey] ?? "" : "";
  const selectedError = selectedKey ? state.aiSidebarErrorsByKey[selectedKey] ?? null : null;
  const selectedHistory = selectedKey ? state.aiSidebarHistoryByKey[selectedKey] ?? { loading: false, error: null } : { loading: false, error: null };
  const aiSidebarMessageGroups = useMemo(() => buildMessageGroups(selectedMessages), [selectedMessages]);

  useEffect(() => {
    dispatch({
      type: "SET_AI_SIDEBAR_THINKING_MODE",
      payload: userId
        ? loadAISidebarThinkingMode(userId)
        : DEFAULT_AI_SIDEBAR_THINKING_MODE,
    });
  }, [dispatch, userId]);

  const handleThinkingModeChange = useCallback((mode: ThinkingMode) => {
    dispatch({ type: "SET_AI_SIDEBAR_THINKING_MODE", payload: mode });
    if (userId) saveAISidebarThinkingMode(userId, mode);
  }, [dispatch, userId]);

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

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = messagesViewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      return;
    }
    msgsEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const scrollToLatestAfterRender = useCallback((key: AISidebarConversationKey, behavior: ScrollBehavior = "auto") => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (selectedKeyRef.current === key) scrollToLatest(behavior);
      });
    });
  }, [scrollToLatest]);

  // 跟踪 viewport 是否贴底:不贴底时才显示"跳到最新回复"按钮
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const update = () => {
      const threshold = 32;
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setIsAtBottom(distance < threshold);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    return () => viewport.removeEventListener("scroll", update);
  }, [selectedKey]);

  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => {
    streamingByKeyRef.current = state.aiSidebarStreamingByKey;
  }, [state.aiSidebarStreamingByKey]);

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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 88) + "px";
    }
  }, [selectedInput]);

  const showTrustChoicePayload = useCallback((payload: TrustChoicePayload) => {
    const key = getActiveKey();
    const assistantId = Date.now();
    dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: true });
    dispatch({
      type: "ADD_AI_SIDEBAR_MSG_FOR_KEY",
      payload: {
        key,
        message: {
          id: assistantId,
          role: "assistant",
          content: payload.message,
          conversation_id: getConversationIdFromKey(key) ?? 0,
          trustChoicePrompt: payload.message,
          trustChoiceOptions: payload.choices,
          token_count: 0,
          created_at: new Date().toISOString(),
        },
      },
    });
    setSidebarView("chat");
  }, [dispatch, getActiveKey]);

  useEffect(() => {
    const prompt = state.pendingResearchPrompt;
    if (!prompt) return;
    const payload = prompt === "draft_research_choices"
      ? buildDraftChoices(state.researchCurrentTopic?.title)
      : buildOpenResearchChoices(state.researchCurrentTopic?.title);
    queueMicrotask(() => {
      showTrustChoicePayload(payload);
      dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: null });
    });
  }, [dispatch, showTrustChoicePayload, state.pendingResearchPrompt, state.researchCurrentTopic?.title]);

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

  useEffect(() => {
    if (!isPrivate || !selectedKey) return;
    const conversationId = getConversationIdFromKey(selectedKey);
    if (!conversationId) {
      dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key: selectedKey, history: { loading: false, error: null } } });
      return;
    }
    if (skipNextHistoryLoadRef.current.has(conversationId)) {
      skipNextHistoryLoadRef.current.delete(conversationId);
      dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key: selectedKey, history: { loading: false, error: null } } });
      return;
    }

    const seq = (historyRequestSeqRef.current.get(selectedKey) ?? 0) + 1;
    historyRequestSeqRef.current.set(selectedKey, seq);
    dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key: selectedKey, history: { loading: true, error: null } } });

    getMessages(conversationId)
      .then((msgs) => {
        if (historyRequestSeqRef.current.get(selectedKey) !== seq) return;
        if (!streamingByKeyRef.current[selectedKey]) {
          dispatch({ type: "SET_AI_SIDEBAR_MSGS_FOR_KEY", payload: { key: selectedKey, messages: msgs } });
          scrollToLatestAfterRender(selectedKey);
        }
        dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key: selectedKey, history: { loading: false, error: null } } });
      })
      .catch(() => {
        if (historyRequestSeqRef.current.get(selectedKey) !== seq) return;
        dispatch({ type: "SET_AI_SIDEBAR_HISTORY_FOR_KEY", payload: { key: selectedKey, history: { loading: false, error: "历史对话加载失败，请检查网络后重试" } } });
      });
  }, [dispatch, historyReloadKey, isPrivate, scrollToLatestAfterRender, selectedKey]);

  useEffect(() => {
    if (!state.trustWritingEnabled || !isPrivate) return;
    if (state.researchCurrentTopicId) return;
    if (selectedHistory.loading) return;
    const hasTrustChoice = selectedMessages.some(
      (m) => Boolean(m.trustChoiceOptions && m.trustChoiceOptions.length > 0)
    );
    if (hasTrustChoice) return;
    (async () => {
      const topics = state.researchTopics.length > 0
        ? state.researchTopics
        : await listResearchTopics().catch(() => []);
      if (topics.length > 0) {
        showTrustChoicePayload(buildTopicSelectChoices(topics));
      } else {
        showTrustChoicePayload(buildOpenResearchChoices(state.researchCurrentTopic?.title));
      }
    })();
  }, [state.trustWritingEnabled, isPrivate, state.researchCurrentTopicId, selectedHistory.loading, selectedMessages, state.researchTopics, showTrustChoicePayload, state.researchCurrentTopic?.title]);

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

  const handleSelectConversation = useCallback((item: ConversationListItem) => {
    if (!isPrivate) return;
    localStorage.setItem(AI_SIDEBAR_VIEW_STORAGE_KEY, "chat");
    if (item.key.startsWith("server:")) {
      localStorage.setItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY, item.key);
    } else {
      localStorage.removeItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
    }
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: item.key });
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: item.key, error: null } });
    if (item.id && state.aiSidebarSelectedKey === item.key) setHistoryReloadKey((key) => key + 1);
    scrollToLatestAfterRender(item.key);
    setSidebarView("chat");
  }, [dispatch, isPrivate, scrollToLatestAfterRender, state.aiSidebarSelectedKey]);

  const handleBackToList = useCallback(() => {
    if (!isPrivate) return;
    localStorage.setItem(AI_SIDEBAR_VIEW_STORAGE_KEY, "list");
    setSidebarView("list");
  }, [isPrivate]);

  const handleGoResearchReview = useCallback(() => {
    dispatch({ type: "SET_PAGE", payload: "research" });
    const topicId = state.researchCurrentTopicId;
    navigate(topicId ? `/research/${topicId}` : "/research");
  }, [dispatch, navigate, state.researchCurrentTopicId]);

  const handleFiles = () => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("files");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "files" });
    navigate("/files");
  };

  const handleResearch = () => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("research");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "research" });
    navigate("/research");
  };

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    if (loginRedirectTarget === "files") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "files" });
      navigate("/files");
      return;
    }
    if (loginRedirectTarget === "research") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "research" });
      navigate("/research");
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(loggedInUser.username)}`);
  };

  const handleDeleteConversation = useCallback((item: ConversationListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPrivate) return;
    setDeleteTarget({ key: item.key, id: item.id ?? null });
  }, [isPrivate]);

  const confirmDeleteConversation = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    abortControllersRef.current.get(target.key)?.abort();
    abortControllersRef.current.delete(target.key);
    runRefs.current.delete(target.key);
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: target.key, error: null } });
    try {
      if (target.id != null) await deleteConversation(target.id);
      dispatch({ type: "REMOVE_AI_SIDEBAR_THREAD", payload: { key: target.key } });
      if (state.aiSidebarSelectedKey === target.key) {
        localStorage.setItem(AI_SIDEBAR_VIEW_STORAGE_KEY, "list");
        localStorage.removeItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY);
        setSidebarView("list");
      }
      await loadConvs();
    } catch {
      dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: target.key, error: "删除对话失败，请稍后重试" } });
    }
  }, [deleteTarget, dispatch, loadConvs, state.aiSidebarSelectedKey]);

  const refreshOwnPosts = useCallback(async (blogMeta?: BlogToolMeta) => {
    if (!user?.username || !blogMeta?.operation || !blogToolOperations.has(blogMeta.operation)) return;
    if (siteUsername && siteUsername !== user.username) return;
    try {
      const currentPostId = state.blogCurrentPostId;
      const updatedPostId = blogMeta.post_id;
      if (currentPostId && updatedPostId && currentPostId === updatedPostId) {
        const fullPost = await getBlogPost(updatedPostId);
        dispatch({ type: "UPDATE_BLOG_POST", payload: fullPost });
        dispatch({ type: "CLEAR_BLOG_STREAMING" });
      } else {
        const data = await listSitePosts(user.username, { include_drafts: true, per_page: 50 });
        dispatch({ type: "SET_BLOG_POSTS", payload: data.posts });
        dispatch({ type: "CLEAR_BLOG_STREAMING" });
      }
    } catch (e) { console.warn("Failed to refresh posts after blog tool:", e); }
  }, [dispatch, siteUsername, user, state.blogCurrentPostId]);

  const hadResearchToolsRef = useRef(false);

  const refreshResearchTopicIfNeeded = useCallback(async () => {
    if (!hadResearchToolsRef.current) return;
    hadResearchToolsRef.current = false;
    const topicId = state.researchCurrentTopicId;
    if (!topicId) return;
    try {
      const detail = await getResearchTopic(topicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch (e) { console.warn("Failed to refresh research topic after stream:", e); }
  }, [dispatch, state.researchCurrentTopicId]);

  const handleSend = useCallback(async (textOverride?: string) => {
    const convKey = getActiveKey();
    const text = (textOverride ?? state.aiSidebarInputsByKey[convKey] ?? "").trim();
    if (!text || state.aiSidebarStreamingByKey[convKey]) return;

    const currentMessages = state.aiSidebarMessagesByKey[convKey] ?? [];
    if (state.trustWritingEnabled && !state.researchCurrentTopicId && isPrivate) {
      const hasTrustChoice = currentMessages.some(
        (m) => Boolean(m.trustChoiceOptions && m.trustChoiceOptions.length > 0)
      );
      if (!hasTrustChoice) {
        const topics = state.researchTopics.length > 0
          ? state.researchTopics
          : await listResearchTopics().catch(() => []);
        showTrustChoicePayload(topics.length > 0
          ? buildTopicSelectChoices(topics)
          : buildOpenResearchChoices(state.researchCurrentTopic?.title)
        );
        return;
      }
    }

    if (topicCreateMode) {
      setTopicCreateMode(false);
      setInputForKey(convKey, "");
      dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: convKey, error: null } });
      try {
        const created = await createResearchTopic({ title: text });
        const detail = await getResearchTopic(created.id);
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: created.id });
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
        dispatch({ type: "SET_RESEARCH_TOPICS", payload: [created, ...state.researchTopics] });
        const payload = buildOpenResearchChoices(detail.title);
        if (topicCreateMessageId) {
          dispatch({
            type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY",
            payload: { key: convKey, id: topicCreateMessageId, content: payload.message, trustChoicePrompt: payload.message, trustChoiceOptions: payload.choices },
          });
          setTopicCreateMessageId(null);
        } else {
          showTrustChoicePayload(payload);
        }
      } catch {
        dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: convKey, error: "创建主题失败，请稍后重试" } });
      }
      return;
    }

    setInputForKey(convKey, "");
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: convKey, error: null } });
    dispatch({ type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY", payload: { key: convKey, streaming: true } });

    const initialConversationId = isPrivate ? getConversationIdFromKey(convKey) : null;
    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: text,
      conversation_id: initialConversationId ?? 0,
      token_count: 0,
      created_at: new Date().toISOString(),
    };
    dispatch({ type: "ADD_AI_SIDEBAR_MSG_FOR_KEY", payload: { key: convKey, message: userMsg } });

    const assistantStartedAt = Date.now();
    const assistantId = assistantStartedAt + 1;
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      conversation_id: initialConversationId ?? 0,
      thinkingMode: state.aiSidebarThinkingMode,
      token_count: 0,
      created_at: new Date(assistantStartedAt).toISOString(),
    };
    dispatch({ type: "ADD_AI_SIDEBAR_MSG_FOR_KEY", payload: { key: convKey, message: assistantMsg } });
    scrollToLatestAfterRender(convKey);

    const controller = new AbortController();
    abortControllersRef.current.set(convKey, controller);
    const runState: RunState = {
      finalContent: "",
      reasoningContent: "",
      toolEvents: [],
      streamFinalized: false,
      streamError: null,
      assistantStartedAt,
      assistantMessageId: assistantId,
      conversationId: initialConversationId,
    };
    runRefs.current.set(convKey, runState);
    let activeKey = convKey;

    const updateAssistant = (payload: Partial<Message>) => {
      dispatch({ type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY", payload: { key: activeKey, id: assistantId, ...payload } });
    };
    let patchPlayer: PatchDeltaPlayer | null = null;
    let blogPlayer: PatchDeltaPlayer | null = null;
    let blogStarted = false;
    const cancelPlayer = (player: PatchDeltaPlayer | null) => {
      player?.cancel();
    };

    try {
      const appendChunk = (chunk: string) => {
        runState.finalContent += chunk;
        updateAssistant({ content: runState.finalContent });
      };

      let uiChain: Promise<void> = Promise.resolve();
      let patchStarted = false;
      const enqueueUi = (fn: () => Promise<void> | void) => {
        uiChain = uiChain.then(fn).catch((err) => {
          if (err && err.name !== "AbortError") {
            console.warn("UI queue step failed:", err);
          }
        });
      };
      const drainUiChain = () => uiChain;
      const finishPatch = async () => {
        const player = patchPlayer;
        if (player) await player.finish();
        patchPlayer = null;
        patchStarted = false;
      };
      const finishBlog = async () => {
        const player = blogPlayer;
        if (player) await player.finish();
        blogPlayer = null;
        blogStarted = false;
      };
      if (isPrivate) {
        const pageContext: Record<string, unknown> = { page_type: pageType };
        if (state.blogCurrentPostId) {
          pageContext.post_id = state.blogCurrentPostId;
          if (postTitle) pageContext.post_title = postTitle;
        }
        if (state.researchCurrentTopicId) {
          pageContext.research_topic_id = state.researchCurrentTopicId;
          if (state.researchCurrentTopic?.title) pageContext.research_topic_title = state.researchCurrentTopic.title;
        }
        pageContext.trust_writing_enabled = state.trustWritingEnabled;
        if (state.aiSelectionContext) {
          pageContext.post_id = state.aiSelectionContext.postId;
          pageContext.selected_text = state.aiSelectionContext.selectedText;
          if (state.aiSelectionContext.sectionIndex > 0) {
            pageContext.section_index = state.aiSelectionContext.sectionIndex;
          }
          dispatch({ type: "CLEAR_AI_SELECTION_CONTEXT" });
        }

        await sendChat(text, initialConversationId, {
          thinkingMode: state.aiSidebarThinkingMode,
          context: pageContext,
          signal: controller.signal,
          callbacks: {
            onDone: (metadata) => {
              runState.conversationId = metadata.conversation_id;
              const serverKey = makeServerKey(metadata.conversation_id);
              if (activeKey !== serverKey) {
                abortControllersRef.current.delete(activeKey);
                abortControllersRef.current.set(serverKey, controller);
                runRefs.current.delete(activeKey);
                runRefs.current.set(serverKey, runState);
                dispatch({ type: "MIGRATE_AI_SIDEBAR_TEMP_KEY", payload: { fromKey: activeKey, toKey: serverKey, conversationId: metadata.conversation_id } });
                localStorage.setItem(AI_SIDEBAR_VIEW_STORAGE_KEY, "chat");
                localStorage.setItem(AI_SIDEBAR_SELECTED_KEY_STORAGE_KEY, serverKey);
                activeKey = serverKey;
              }
              skipNextHistoryLoadRef.current.add(metadata.conversation_id);
            },
            onRoundDelta: ({ delta }) => {
              enqueueUi(() => {
                dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "delta", delta } } });
              });
            },
            onRoundEnd: (round) => {
              enqueueUi(() => {
                if (round.classification === "loop") {
                  dispatch({
                    type: "APPLY_AI_STREAM_EVENT_FOR_KEY",
                    payload: {
                      key: activeKey,
                      id: assistantId,
                      event: {
                        type: "loop",
                        content: round.text,
                        roundId: round.round_id,
                        loopStepIndex: round.loop_step_index ?? undefined,
                      },
                    },
                  });
                  return;
                }
                if (round.classification === "discard") {
                  dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "discard" } } });
                  return;
                }
                runState.finalContent = round.text;
                runState.streamFinalized = true;
                dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "final", content: round.text } } });
              });
            },
            onStreamError: ({ message }) => {
              runState.streamError = message;
              enqueueUi(() => {
                dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "error", message } } });
              });
            },
            onToolCall: (toolName, meta) => {
              runState.toolEvents = [...runState.toolEvents, {
                type: "start" as const,
                toolName,
                callId: meta?.call_id,
                roundId: meta?.round_id,
                loopStepIndex: meta?.loop_step_index,
              }];
              updateAssistant({ toolEvents: runState.toolEvents });
              if (toolName === "blog_edit_post" || toolName === "blog_create_post" || toolName === "blog_write_post") {
                if (!blogStreamOwnerRef.current) blogStreamOwnerRef.current = activeKey;
              }
            },
            onToolResult: (toolName, result, blogMeta, references, meta) => {
              const refs: Reference[] = (references || []).map((r: StreamReference) => ({
                type: r.type,
                source: r.source,
                collection: r.collection,
                distance: r.distance,
                server: r.server,
                tool: r.tool,
              }));
              runState.toolEvents = [...runState.toolEvents, {
                type: "end" as const,
                toolName,
                result: typeof result === "string" ? result : "",
                references: refs,
                callId: meta?.call_id,
                roundId: meta?.round_id,
                loopStepIndex: meta?.loop_step_index,
              }];
              updateAssistant({ toolEvents: runState.toolEvents });
              const isPatchTool = toolName === "blog_edit_post";
              const isBlogWriteTool = toolName === "blog_create_post" || toolName === "blog_write_post";
              const ownsBlogStream = blogStreamOwnerRef.current === activeKey;
              if (isPatchTool && ownsBlogStream) {
                enqueueUi(async () => {
                  await finishPatch();
                  dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
                  if (blogMeta?.operation === "edit_post") void refreshOwnPosts(blogMeta);
                  blogStreamOwnerRef.current = null;
                });
              } else if (isBlogWriteTool && ownsBlogStream) {
                enqueueUi(async () => {
                  await finishBlog();
                  dispatch({ type: "CLEAR_BLOG_STREAMING" });
                  void refreshOwnPosts(blogMeta);
                  blogStreamOwnerRef.current = null;
                });
              } else {
                void refreshOwnPosts(blogMeta);
              }
              if (toolName && RESEARCH_TOOL_NAMES.has(toolName)) hadResearchToolsRef.current = true;
            },
            onPatchStart: (targetText) => {
              if (!blogStreamOwnerRef.current) blogStreamOwnerRef.current = activeKey;
              if (blogStreamOwnerRef.current !== activeKey || patchStarted) return;
              patchStarted = true;
              patchPlayer = createPatchDeltaPlayer((replacementDelta) => {
                dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta } });
              });
              dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText } });
              patchPlayer.open();
            },
            onPatchDelta: (replacementDelta) => {
              if (blogStreamOwnerRef.current === activeKey) {
                patchPlayer?.push(replacementDelta);
              }
            },
            onBlogDelta: (contentDelta) => {
              if (!blogStreamOwnerRef.current) blogStreamOwnerRef.current = activeKey;
              if (blogStreamOwnerRef.current !== activeKey) return;
              if (!blogStarted) {
                blogStarted = true;
                blogPlayer = createPatchDeltaPlayer((delta) => {
                  dispatch({ type: "APPEND_BLOG_STREAMING", payload: delta });
                });
                blogPlayer.open();
              }
              blogPlayer?.push(contentDelta);
            },
            onReasoning: (reasoningDelta) => {
              runState.reasoningContent += reasoningDelta;
              updateAssistant({ reasoningContent: runState.reasoningContent });
            },
          },
        });
        await drainUiChain();
        if (blogStreamOwnerRef.current === activeKey) blogStreamOwnerRef.current = null;
        if (runState.streamError) throw new Error(runState.streamError);
        await loadConvs();
        await refreshResearchTopicIfNeeded();
      } else if (siteUsername) {
        await sendSharedUserChat(siteUsername, text, postSlug, appendChunk, controller.signal);
      } else {
        await sendSharedLandingChat(text, appendChunk, controller.signal);
      }

      if (isPrivate && state.trustWritingEnabled && runState.streamFinalized) {
        const trustChoicePayload = parseTrustChoicePayload(runState.finalContent);
        if (trustChoicePayload) {
          const visibleContent = stripTrustChoicePayload(runState.finalContent, trustChoicePayload.message);
          updateAssistant({
            content: visibleContent,
            trustChoicePrompt: visibleContent,
            trustChoiceOptions: trustChoicePayload.choices,
          });
        }
      }
    } catch (err) {
      cancelPlayer(patchPlayer);
      cancelPlayer(blogPlayer);
      dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
      dispatch({ type: "CLEAR_BLOG_STREAMING" });
      if (err instanceof Error && err.name === "AbortError") {
        dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "discard" } } });
        if (!runState.streamFinalized) updateAssistant({ content: "已停止" });
      } else {
        const message = runState.streamError ?? "无法获取回复，请稍后重试";
        dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: activeKey, error: message } });
        if (!runState.streamError) {
          dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "error", message } } });
        }
      }
    } finally {
      updateAssistant({ thinkingDurationMs: Math.max(0, Date.now() - assistantStartedAt) });
      abortControllersRef.current.delete(activeKey);
      runRefs.current.delete(activeKey);
      dispatch({ type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY", payload: { key: activeKey, streaming: false } });
    }
  }, [dispatch, getActiveKey, isPrivate, loadConvs, pageType, postSlug, postTitle, refreshOwnPosts, refreshResearchTopicIfNeeded, scrollToLatestAfterRender, setInputForKey, showTrustChoicePayload, siteUsername, state.aiSelectionContext, state.aiSidebarInputsByKey, state.aiSidebarMessagesByKey, state.aiSidebarStreamingByKey, state.aiSidebarThinkingMode, state.blogCurrentPostId, state.researchCurrentTopic, state.researchCurrentTopicId, state.researchTopics, state.trustWritingEnabled, topicCreateMessageId, topicCreateMode]);

  const handleStop = useCallback(() => {
    if (!selectedKey) return;
    abortControllersRef.current.get(selectedKey)?.abort();
    abortControllersRef.current.delete(selectedKey);
    dispatch({ type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY", payload: { key: selectedKey, streaming: false } });
  }, [dispatch, selectedKey]);

  const handleTrustChoiceSelect = useCallback(async (messageId: number, option: TrustChoiceOption) => {
    const key = getActiveKey();
    const isInlineUpdate = option.kind === "action" && option.action === "select_topic";
    if (!isInlineUpdate) {
      dispatch({
        type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY",
        payload: { key, id: messageId, trustChoicePrompt: null, trustChoiceOptions: [] },
      });
    }

    if (option.kind === "action" && option.action === "dismiss") return;

    if (option.kind === "reply") {
      await handleSend(option.prompt);
      return;
    }

    const topicId = state.researchCurrentTopicId;
    const topicTitle = state.researchCurrentTopic?.title;

    switch (option.action) {
      case "open_research_graph":
        handleGoResearchReview();
        return;
      case "open_conflicts": {
        const conflict = state.researchCurrentTopic?.relations.find((item) => item.relation_type === "conflicts_with");
        if (conflict) dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: conflict.id });
        handleGoResearchReview();
        return;
      }
      case "start_research":
      case "continue_research":
        if (topicId) {
          dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key, error: null } });
          try {
            await runResearchTopic(topicId, `sidebar-${topicId}-${Date.now()}`);
            const detail = await getResearchTopic(topicId);
            dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
          } catch {
            dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key, error: "启动研究任务失败，请稍后重试" } });
            return;
          }
        }
        await handleSend(buildResearchRunPrompt(topicTitle));
        return;
      case "explain_conflicts":
        await handleSend(buildExplainConflictsPrompt(topicTitle));
        return;
      case "write_from_confirmed_facts":
        await handleSend(buildTrustedDraftPrompt(topicTitle));
        return;
      case "select_topic": {
        const tid = Number(option.id.replace("topic-select-", ""));
        if (!tid || isNaN(tid)) return;
        dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key, error: null } });
        try {
          const detail = await getResearchTopic(tid);
          dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: tid });
          dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
          const payload = buildOpenResearchChoices(detail.title);
          dispatch({
            type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY",
            payload: { key, id: messageId, content: payload.message, trustChoicePrompt: payload.message, trustChoiceOptions: payload.choices },
          });
        } catch {
          dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key, error: "加载主题失败，请稍后重试" } });
        }
        return;
      }
      case "create_topic":
        setTopicCreateMessageId(messageId);
        setTopicCreateMode(true);
        setInputForKey(key, "");
        dispatch({
          type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY",
          payload: { key, id: messageId, content: "请在下方输入框中输入新研究主题名称，按 Enter 创建，Esc 取消。", trustChoicePrompt: "请在下方输入框中输入新研究主题名称，按 Enter 创建，Esc 取消。" },
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
    }
  }, [dispatch, getActiveKey, handleGoResearchReview, handleSend, setInputForKey, state.researchCurrentTopicId, state.researchCurrentTopic]);

  const handleInputChange = useCallback((value: string) => {
    const key = getActiveKey();
    setInputForKey(key, value);
  }, [getActiveKey, setInputForKey]);

  const handleSendClick = useCallback(() => {
    void handleSend();
  }, [handleSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
    if (e.key === "Escape" && topicCreateMode) {
      const key = getActiveKey();
      setTopicCreateMode(false);
      setTopicCreateMessageId(null);
      setInputForKey(key, "");
    }
  }, [getActiveKey, handleSend, setInputForKey, topicCreateMode]);

  const handleReloadHistory = useCallback(() => {
    setHistoryReloadKey((key) => key + 1);
  }, []);

  const handleOpenMcp = useCallback(() => {
    dispatch({ type: "TOGGLE_MCP_MODAL", payload: true });
  }, [dispatch]);

  const handleJumpToLatest = useCallback(() => {
    scrollToLatest("smooth");
  }, [scrollToLatest]);

  const conversationItems = useMemo<ConversationListItem[]>(() => {
    const remoteItems = conversations.map((conv) => {
      const key = makeServerKey(conv.id);
      return {
        key,
        id: conv.id,
        title: conv.title,
        created_at: conv.created_at,
        selected: state.aiSidebarSelectedKey === key,
        streaming: !!state.aiSidebarStreamingByKey[key],
        error: state.aiSidebarErrorsByKey[key] ?? null,
        isTemp: false,
      };
    });
    const remoteKeys = new Set(remoteItems.map((item) => item.key));
    const tempItems = Object.entries(state.aiSidebarMessagesByKey)
      .filter(([key]) => key.startsWith("temp:") && key !== SHARED_CONVERSATION_KEY && !remoteKeys.has(key as AISidebarConversationKey))
      .map(([key, messages]) => {
        const typedKey = key as AISidebarConversationKey;
        const firstUser = messages.find((m) => m.role === "user");
        return {
          key: typedKey,
          id: null,
          title: firstUser?.content?.slice(0, 50) || "新对话",
          created_at: messages[0]?.created_at ?? new Date().toISOString(),
          selected: state.aiSidebarSelectedKey === typedKey,
          streaming: !!state.aiSidebarStreamingByKey[typedKey],
          error: state.aiSidebarErrorsByKey[typedKey] ?? null,
          isTemp: true,
        };
      })
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return [...tempItems, ...remoteItems];
  }, [conversations, state.aiSidebarErrorsByKey, state.aiSidebarMessagesByKey, state.aiSidebarSelectedKey, state.aiSidebarStreamingByKey]);

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
      <AISidebarHeader
        isPrivate={isPrivate}
        sidebarView={sidebarView}
        onCollapse={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: false })}
        onBackToList={handleBackToList}
        onNewChat={handleNewChat}
        onThinkingModeChange={handleThinkingModeChange}
      />

      {isPrivate && sidebarView === "list" ? (
        <ConversationListView
          conversations={conversationItems}
          error={conversationItems.find((item) => item.error)?.error ?? null}
          onSelect={handleSelectConversation}
          onDeleteRequest={handleDeleteConversation}
          onDismissError={() => {
            conversationItems.forEach((item) => {
              if (item.error) dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: item.key, error: null } });
            });
          }}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <AnimatePresence>
            {(contextText || state.aiSelectionContext || state.trustWritingEnabled) && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                animate={{ maxHeight: 120, opacity: 1, paddingTop: 8, paddingBottom: 8 }}
                exit={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                className="pointer-events-auto absolute left-0 right-0 top-0 z-30 flex flex-col gap-1 overflow-hidden border-b border-primary/15 bg-[rgb(232_240_253)]/85 px-3 text-xs font-medium text-primary shadow-sm backdrop-blur-sm dark:bg-[rgb(34_42_60)]/85"
              >
                {contextText && (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]" />
                    <span className="truncate">{contextText}</span>
                  </div>
                )}
                <TrustContextIndicator enabled={state.trustWritingEnabled} topic={state.researchCurrentTopic} />
                {state.aiSelectionContext && (
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3 w-3 flex-shrink-0 text-primary" />
                    <span className="flex-1 truncate">
                      选中内容：{state.aiSelectionContext.selectedText.slice(0, 60)}
                      {state.aiSelectionContext.selectedText.length > 60 ? "..." : ""}
                    </span>
                    <button
                      className="flex-shrink-0 rounded px-1.5 text-[11px] hover:bg-primary/20"
                      onClick={() => dispatch({ type: "CLEAR_AI_SELECTION_CONTEXT" })}
                    >
                      取消
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {selectedError && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0 }}
                animate={{ maxHeight: 80, opacity: 1 }}
                exit={{ maxHeight: 0, opacity: 0 }}
                className="relative z-20 flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-destructive/15 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
              >
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{selectedError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <MessageList
            groups={aiSidebarMessageGroups}
            streaming={selectedStreaming}
            msgsEndRef={msgsEndRef}
            viewportRef={messagesViewportRef}
            showJumpButton={selectedStreaming && selectedMessages.length > 0 && !isAtBottom}
            onJumpToLatest={handleJumpToLatest}
            historyLoading={selectedHistory.loading}
            historyLoadError={selectedHistory.error}
            emptyHint={isPrivate ? "可以帮你写文章、总结文件库、润色段落或拆解思路。" : "可以围绕当前公开页面进行普通聊天和内容讨论。"}
            onReloadHistory={handleReloadHistory}
            onTrustChoiceSelect={handleTrustChoiceSelect}
          />

          <ChatInputBar
            streaming={selectedStreaming}
            input={selectedInput}
            topicCreateMode={topicCreateMode}
            textareaRef={textareaRef}
            onInputChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onSend={handleSendClick}
            onStop={handleStop}
            onPickFiles={handleFiles}
            onPickResearch={handleResearch}
            onOpenMcp={handleOpenMcp}
          />
        </div>
      )}

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[340px] p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-[14px]">确认删除</DialogTitle>
            <DialogDescription className="text-[12px]">删除后可在回收站恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-4 py-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button size="sm" variant="destructive" onClick={confirmDeleteConversation}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
