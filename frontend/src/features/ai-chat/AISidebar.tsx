import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../stores/authStore";
import type { AuthUser } from "../../stores/authStore";
import { isDisplayableMessage, useChat } from "../../stores/chatStore";
import type { Conversation, Message, Reference, ToolEvent } from "../../stores/chatStore";
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
import { ConversationListView } from "./ai-sidebar/ConversationListView";
import { ChatInputBar } from "./ai-sidebar/ChatInputBar";
import { MessageList } from "./ai-sidebar/MessageList";
import {
  aiModeLabels,
  blogToolOperations,
  RESEARCH_TOOL_NAMES,
  type AISidebarProps,
} from "./ai-sidebar/constants";

export function AISidebar({ mode, contextText = "", siteUsername, postSlug, pageType = "other", postTitle }: AISidebarProps) {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicCreateMode, setTopicCreateMode] = useState(false);
  const [topicCreateMessageId, setTopicCreateMessageId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [sidebarView, setSidebarView] = useState<"list" | "chat">(mode === "private" ? "list" : "chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const lastToolEndPosRef = useRef(0);
  const latestConversationIdRef = useRef<number | null>(null);
  const skipNextInitialMessagesLoadRef = useRef<number | null>(null);
  const nextMessagesScrollBehaviorRef = useRef<ScrollBehavior>("smooth");
  const abortControllerRef = useRef<AbortController | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginRedirectTarget, setLoginRedirectTarget] = useState<"knowledge" | "research" | null>(null);

  const isPrivate = mode === "private";
  const currentModeLabel = aiModeLabels[state.aiSidebarMode];
  const visibleAiSidebarMessages = state.aiSidebarMessages.filter(isDisplayableMessage);
  const aiSidebarMessageGroups = useMemo(
    () => visibleAiSidebarMessages.reduce<Array<{ role: Message["role"]; messages: Message[] }>>((groups, msg) => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.role === "assistant" && msg.role === "assistant") {
        lastGroup.messages.push(msg);
        return groups;
      }
      groups.push({ role: msg.role, messages: [msg] });
      return groups;
    }, []),
    [visibleAiSidebarMessages],
  );

  useEffect(() => {
    latestConversationIdRef.current = state.aiSidebarConversationId;
  }, [state.aiSidebarConversationId]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isPrivate) {
      // 切到非私有模式时整体重置侧栏状态
      setSidebarView("chat");
      setConversations([]);
      dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: null });
    }
  }, [dispatch, isPrivate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useLayoutEffect(() => {
    if (historyLoading) return;
    const behavior = nextMessagesScrollBehaviorRef.current;
    msgsEndRef.current?.scrollIntoView({ behavior, block: "end" });
    nextMessagesScrollBehaviorRef.current = "smooth";
  }, [state.aiSidebarMessages, historyLoading]);

  useLayoutEffect(() => {
    if (!state.aiSidebarOpen || sidebarView !== "chat") return;
    msgsEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [state.aiSidebarOpen, sidebarView, state.aiSidebarConversationId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 88) + "px";
    }
  }, [input]);

  const showTrustChoicePayload = useCallback((payload: TrustChoicePayload) => {
    const assistantId = Date.now();
    dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: true });
    dispatch({
      type: "ADD_AI_SIDEBAR_MSG",
      payload: {
        id: assistantId,
        role: "assistant",
        content: payload.message,
        conversation_id: isPrivate ? state.aiSidebarConversationId ?? 0 : 0,
        trustChoicePrompt: payload.message,
        trustChoiceOptions: payload.choices,
        token_count: 0,
        created_at: new Date().toISOString(),
      },
    });
    setSidebarView("chat");
  }, [dispatch, isPrivate, state.aiSidebarConversationId]);

  useEffect(() => {
    const prompt = state.pendingResearchPrompt;
    if (!prompt) return;
    const payload = prompt === "draft_research_choices"
      ? buildDraftChoices(state.researchCurrentTopic?.title)
      : buildOpenResearchChoices(state.researchCurrentTopic?.title);
    // 触发信任选择 UI；rule 把 showTrustChoicePayload 内的 dispatch 视为同步 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    showTrustChoicePayload(payload);
    dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: null });
  }, [dispatch, showTrustChoicePayload, state.pendingResearchPrompt, state.researchCurrentTopic?.title]);

  const loadConvs = useCallback(async () => {
    if (!isPrivate) return;
    try {
      const data = await fetchConversations();
      setConversations(data.conversations || []);
    } catch { /* 加载会话列表失败静默；UI 显示空列表即可 */ }
  }, [isPrivate]);

  useEffect(() => {
    if (isPrivate) {
      // 异步加载会话；loadConvs 内部 setState 同步入口被 rule 拦截
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadConvs();
    }
  }, [isPrivate, loadConvs]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isPrivate || !state.aiSidebarConversationId) {
      // 无选中会话时清空历史加载状态
      setHistoryLoading(false);
      setHistoryLoadError(null);
      return;
    }

    const conversationId = state.aiSidebarConversationId;

    if (skipNextInitialMessagesLoadRef.current === conversationId) {
      skipNextInitialMessagesLoadRef.current = null;
      setHistoryLoading(false);
      setHistoryLoadError(null);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryLoadError(null);

    getMessages(conversationId)
      .then((msgs) => {
        if (cancelled || latestConversationIdRef.current !== conversationId) return;
        nextMessagesScrollBehaviorRef.current = "auto";
        dispatch({ type: "SET_AI_SIDEBAR_MSGS", payload: msgs });
        setHistoryLoadError(null);
      })
      .catch(() => {
        if (cancelled || latestConversationIdRef.current !== conversationId) return;
        setHistoryLoadError("历史对话加载失败，请检查网络后重试");
      })
      .finally(() => {
        if (cancelled || latestConversationIdRef.current !== conversationId) return;
        setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPrivate, state.aiSidebarConversationId, historyReloadKey, dispatch]);

  useEffect(() => {
    if (!state.trustWritingEnabled || !isPrivate) return;
    if (state.researchCurrentTopicId) return;
    if (historyLoading) return;
    const hasTrustChoice = state.aiSidebarMessages.some(
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
  }, [state.trustWritingEnabled, isPrivate, state.researchCurrentTopicId, historyLoading, state.aiSidebarMessages, state.researchTopics, showTrustChoicePayload, state.researchCurrentTopic?.title]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleNewChat = useCallback(async () => {
    dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: null });
    dispatch({ type: "SET_AI_SIDEBAR_MSGS", payload: [] });
    setHistoryLoading(false);
    setHistoryLoadError(null);
    setSidebarView("chat");
    setError(null);
    if (isPrivate) await loadConvs();
  }, [dispatch, isPrivate, loadConvs]);

  const handleSelectConversation = useCallback((conv: Conversation) => {
    if (!isPrivate) return;
    dispatch({ type: "SET_AI_SIDEBAR_MSGS", payload: [] });
    setHistoryLoading(true);
    setHistoryLoadError(null);
    if (state.aiSidebarConversationId === conv.id) {
      setHistoryReloadKey((key) => key + 1);
    } else {
      dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: conv.id });
    }
    setSidebarView("chat");
    setError(null);
  }, [dispatch, isPrivate, state.aiSidebarConversationId]);

  const handleBackToList = useCallback(() => {
    if (isPrivate) setSidebarView("list");
  }, [isPrivate]);

  const handleGoResearchReview = useCallback(() => {
    dispatch({ type: "SET_PAGE", payload: "research" });
    const topicId = state.researchCurrentTopicId;
    navigate(topicId ? `/research/${topicId}` : "/research");
  }, [dispatch, navigate, state.researchCurrentTopicId]);

  const handleKnowledge = () => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("knowledge");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "knowledge" });
    navigate("/knowledge");
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
    if (loginRedirectTarget === "knowledge") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "knowledge" });
      navigate("/knowledge");
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

  const handleDeleteConversation = useCallback((convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPrivate) return;
    setDeleteTarget(convId);
  }, [isPrivate]);

  const confirmDeleteConversation = useCallback(async () => {
    const convId = deleteTarget;
    if (convId == null) return;
    setDeleteTarget(null);
    setError(null);
    try {
      await deleteConversation(convId);
      if (state.aiSidebarConversationId === convId) {
        dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: null });
        dispatch({ type: "SET_AI_SIDEBAR_MSGS", payload: [] });
        setHistoryLoading(false);
        setHistoryLoadError(null);
        setSidebarView("list");
      }
      await loadConvs();
    } catch {
      setError("删除对话失败，请稍后重试");
    }
  }, [deleteTarget, dispatch, loadConvs, state.aiSidebarConversationId]);

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
    const text = (textOverride ?? input).trim();
    if (!text || streaming) return;

    if (state.trustWritingEnabled && !state.researchCurrentTopicId && isPrivate) {
      const hasTrustChoice = state.aiSidebarMessages.some(
        (m) => Boolean(m.trustChoiceOptions && m.trustChoiceOptions.length > 0)
      );
      if (!hasTrustChoice) {
        const topics = state.researchTopics.length > 0
          ? state.researchTopics
          : await listResearchTopics().catch(() => []);
        if (topics.length > 0) {
          showTrustChoicePayload(buildTopicSelectChoices(topics));
        } else {
          showTrustChoicePayload(buildOpenResearchChoices(state.researchCurrentTopic?.title));
        }
        return;
      }
    }

    if (topicCreateMode) {
      setTopicCreateMode(false);
      setInput("");
      setError(null);
      try {
        const created = await createResearchTopic({ title: text });
        const detail = await getResearchTopic(created.id);
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: created.id });
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
        dispatch({ type: "SET_RESEARCH_TOPICS", payload: [created, ...state.researchTopics] });
        const payload = buildOpenResearchChoices(detail.title);
        if (topicCreateMessageId) {
          dispatch({
            type: "UPDATE_AI_SIDEBAR_MSG",
            payload: { id: topicCreateMessageId, content: payload.message, trustChoicePrompt: payload.message, trustChoiceOptions: payload.choices },
          });
          setTopicCreateMessageId(null);
        } else {
          showTrustChoicePayload(payload);
        }
      } catch {
        setError("创建主题失败，请稍后重试");
      }
      return;
    }

    setInput("");
    setError(null);

    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: text,
      conversation_id: isPrivate ? state.aiSidebarConversationId ?? 0 : 0,
      token_count: 0,
      created_at: new Date().toISOString(),
    };
    dispatch({ type: "ADD_AI_SIDEBAR_MSG", payload: userMsg });

    const assistantId = Date.now() + 1;
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      conversation_id: isPrivate ? state.aiSidebarConversationId ?? 0 : 0,
      thinkingMode: state.aiSidebarThinkingMode,
      token_count: 0,
      created_at: new Date().toISOString(),
    };
    dispatch({ type: "ADD_AI_SIDEBAR_MSG", payload: assistantMsg });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStreaming(true);
    let convId = state.aiSidebarConversationId;
    let content = "";
    let reasoningContent = "";
    let toolEvents: ToolEvent[] = [];
    lastToolEndPosRef.current = 0;

    try {
      const appendChunk = (chunk: string) => {
        content += chunk;
        dispatch({ type: "UPDATE_AI_SIDEBAR_MSG", payload: { id: assistantId, content } });
      };

      if (isPrivate) {
        // Build page context for every request.
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
        // Add selected text context when available.
        if (state.aiSelectionContext) {
          pageContext.post_id = state.aiSelectionContext.postId;
          pageContext.selected_text = state.aiSelectionContext.selectedText;
        }
        // Clear selected context after sending.
        if (state.aiSelectionContext) {
          dispatch({ type: "CLEAR_AI_SELECTION_CONTEXT" });
        }

        await sendChat(
          text,
          convId,
          undefined,
          undefined,
          appendChunk,
          (metadata) => {
            convId = metadata.conversation_id;
            if (!latestConversationIdRef.current) {
              skipNextInitialMessagesLoadRef.current = metadata.conversation_id;
              dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: metadata.conversation_id });
            }
            if (lastToolEndPosRef.current > 0) {
              dispatch({ type: "REORGANIZE_AI_MSG", payload: { id: assistantId, splitPosition: lastToolEndPosRef.current } });
            }
          },
          (toolName) => {
            toolEvents = [...toolEvents, { type: "start" as const, toolName }];
            dispatch({ type: "UPDATE_AI_SIDEBAR_MSG", payload: { id: assistantId, toolEvents } });
          },
          (toolName, result, blogMeta, references) => {
            const refs: Reference[] = (references || []).map((r: StreamReference) => ({
              type: r.type,
              source: r.source,
              collection: r.collection,
              distance: r.distance,
              server: r.server,
              tool: r.tool,
            }));
            toolEvents = [...toolEvents, { type: "end" as const, toolName, result: typeof result === "string" ? result : "", references: refs }];
            dispatch({ type: "UPDATE_AI_SIDEBAR_MSG", payload: { id: assistantId, toolEvents } });
            refreshOwnPosts(blogMeta);
            if (toolName && RESEARCH_TOOL_NAMES.has(toolName)) hadResearchToolsRef.current = true;
            if (toolName === "blog_patch_post") {
              dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
            }
            lastToolEndPosRef.current = content.length;
          },
          (contentDelta) => {
            dispatch({ type: "APPEND_BLOG_STREAMING", payload: contentDelta });
          },
          state.aiSidebarMode,
          state.aiSidebarThinkingMode,
          (reasoningDelta) => {
            reasoningContent += reasoningDelta;
            dispatch({ type: "UPDATE_AI_SIDEBAR_MSG", payload: { id: assistantId, reasoningContent } });
          },
          (targetText) => {
            dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText } });
          },
          (delta) => {
            dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: delta });
          },
          pageContext,
          controller.signal,
        );
        await loadConvs();
        await refreshResearchTopicIfNeeded();
      } else if (siteUsername) {
        await sendSharedUserChat(siteUsername, text, postSlug, appendChunk, controller.signal);
      } else {
        await sendSharedLandingChat(text, appendChunk, controller.signal);
      }

      if (isPrivate && state.trustWritingEnabled) {
        const trustChoicePayload = parseTrustChoicePayload(content);
        if (trustChoicePayload) {
          const visibleContent = stripTrustChoicePayload(content, trustChoicePayload.message);
          dispatch({
            type: "UPDATE_AI_SIDEBAR_MSG",
            payload: {
              id: assistantId,
              content: visibleContent,
              trustChoicePrompt: visibleContent,
              trustChoiceOptions: trustChoicePayload.choices,
            },
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (!content.trim() && !reasoningContent.trim() && toolEvents.length === 0) {
          dispatch({
            type: "UPDATE_AI_SIDEBAR_MSG",
            payload: { id: assistantId, content: "已停止" },
          });
        }
      } else {
        setError("无法获取回复，请稍后重试");
        dispatch({
          type: "UPDATE_AI_SIDEBAR_MSG",
          payload: { id: assistantId, content: "**错误：无法获取回复**" },
        });
      }
    } finally {
      abortControllerRef.current = null;
      setStreaming(false);
    }
  }, [dispatch, input, isPrivate, loadConvs, postSlug, refreshOwnPosts, refreshResearchTopicIfNeeded, siteUsername, state.aiSidebarConversationId, state.aiSidebarMode, state.aiSidebarThinkingMode, streaming, pageType, postTitle, state.aiSelectionContext, state.blogCurrentPostId, state.researchCurrentTopicId, state.researchCurrentTopic, state.trustWritingEnabled, topicCreateMode, topicCreateMessageId, setTopicCreateMode, showTrustChoicePayload, state.researchTopics, state.aiSidebarMessages]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
  }, []);

  const handleTrustChoiceSelect = useCallback(async (messageId: number, option: TrustChoiceOption) => {
    const isInlineUpdate = option.kind === "action" && option.action === "select_topic";
    if (!isInlineUpdate) {
      dispatch({
        type: "UPDATE_AI_SIDEBAR_MSG",
        payload: { id: messageId, trustChoicePrompt: null, trustChoiceOptions: [] },
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
          setError(null);
          try {
            await runResearchTopic(topicId, `sidebar-${topicId}-${Date.now()}`);
            const detail = await getResearchTopic(topicId);
            dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
          } catch {
            setError("启动研究任务失败，请稍后重试");
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
        setError(null);
        try {
          const detail = await getResearchTopic(tid);
          dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: tid });
          dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
          const payload = buildOpenResearchChoices(detail.title);
          dispatch({
            type: "UPDATE_AI_SIDEBAR_MSG",
            payload: { id: messageId, content: payload.message, trustChoicePrompt: payload.message, trustChoiceOptions: payload.choices },
          });
        } catch {
          setError("加载主题失败，请稍后重试");
        }
        return;
      }
      case "create_topic":
        setTopicCreateMessageId(messageId);
        setTopicCreateMode(true);
        setInput("");
        dispatch({
          type: "UPDATE_AI_SIDEBAR_MSG",
          payload: { id: messageId, content: "请在下方输入框中输入新研究主题名称，按 Enter 创建，Esc 取消。", trustChoicePrompt: "请在下方输入框中输入新研究主题名称，按 Enter 创建，Esc 取消。" },
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
    }
  }, [dispatch, handleGoResearchReview, handleSend, state.researchCurrentTopicId, state.researchCurrentTopic, setTopicCreateMode, setTopicCreateMessageId, textareaRef]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape" && topicCreateMode) {
      setTopicCreateMode(false);
      setTopicCreateMessageId(null);
      setInput("");
    }
  };

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
        currentModeLabel={currentModeLabel}
        onCollapse={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: false })}
        onBackToList={handleBackToList}
        onNewChat={handleNewChat}
      />

      {isPrivate && sidebarView === "list" ? (
        <ConversationListView
          conversations={conversations}
          error={error}
          onSelect={handleSelectConversation}
          onDeleteRequest={handleDeleteConversation}
          onDismissError={() => setError(null)}
        />
      ) : (
        <>
          <AnimatePresence>
            {(contextText || state.aiSelectionContext || state.trustWritingEnabled) && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                animate={{ maxHeight: 120, opacity: 1, paddingTop: 8, paddingBottom: 8 }}
                exit={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                className="relative flex flex-col flex-shrink-0 gap-1 overflow-hidden border-b border-primary/15 bg-primary/10 px-3 text-xs font-medium text-primary"
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
            {error && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0 }}
                animate={{ maxHeight: 80, opacity: 1 }}
                exit={{ maxHeight: 0, opacity: 0 }}
                className="relative flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-destructive/15 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
              >
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <MessageList
            groups={aiSidebarMessageGroups}
            streaming={streaming}
            msgsEndRef={msgsEndRef}
            historyLoading={historyLoading}
            historyLoadError={historyLoadError}
            emptyHint={isPrivate ? "可以帮你写文章、总结知识库、润色段落或拆解思路。" : "可以围绕当前公开页面进行普通聊天和内容讨论。"}
            onReloadHistory={() => setHistoryReloadKey((key) => key + 1)}
            onTrustChoiceSelect={handleTrustChoiceSelect}
          />

          <ChatInputBar
            streaming={streaming}
            input={input}
            topicCreateMode={topicCreateMode}
            textareaRef={textareaRef}
            onInputChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={() => handleSend()}
            onStop={handleStop}
            onPickKnowledge={handleKnowledge}
            onPickResearch={handleResearch}
            onOpenMcp={() => dispatch({ type: "TOGGLE_MCP_MODAL", payload: true })}
          />
        </>
      )}

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[340px] p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-[14px]">确认删除</DialogTitle>
            <DialogDescription className="text-[12px]">删除后对话记录将无法恢复。</DialogDescription>
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
