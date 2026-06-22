import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../stores/authStore";
import { isDisplayableMessage, useChat } from "../../stores/chatStore";
import type { AISidebarMode, Conversation, Reference, ToolEvent } from "../../stores/chatStore";
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
import { TrustChoiceGroup } from "./TrustChoiceGroup";
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
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Plus,
  MessageSquare,
  Sparkles,
  ArrowUp,
  Trash2,
  AlertCircle,
  Bot,
  UserRound,
  Database,
  WandSparkles,
  Brain,
  Search,
  CheckCircle2,
  BookOpen,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AISidebarProps {
  mode: "shared" | "private";
  contextText?: string;
  siteUsername?: string;
  postSlug?: string;
  pageType?: "post" | "home" | "kb" | "research" | "about" | "other";
  postTitle?: string;
}

const blogToolOperations = new Set(["create_post", "update_post", "patch_post", "delete_post"]);
const aiModeLabels: Record<AISidebarMode, string> = {
  normal: "知识库：关闭",
  knowledge: "知识库：打开",
  auto: "知识库：自动",
};

const nextAiSidebarMode: Record<AISidebarMode, AISidebarMode> = {
  auto: "knowledge",
  knowledge: "normal",
  normal: "auto",
};

export function AISidebar({ mode, contextText = "", siteUsername, postSlug, pageType = "other", postTitle }: AISidebarProps) {
  const { state, dispatch } = useChat();
  const { user } = useAuth();
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

  const isPrivate = mode === "private";
  const title = isPrivate ? "私人AI" : "共享AI";
  const currentModeLabel = aiModeLabels[state.aiSidebarMode];
  const visibleAiSidebarMessages = state.aiSidebarMessages.filter(isDisplayableMessage);
  latestConversationIdRef.current = state.aiSidebarConversationId;

  useEffect(() => {
    if (!isPrivate) {
      setSidebarView("chat");
      setConversations([]);
      dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: null });
    }
  }, [dispatch, isPrivate]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.aiSidebarMessages]);

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
    showTrustChoicePayload(payload);
    dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: null });
  }, [dispatch, showTrustChoicePayload, state.pendingResearchPrompt, state.researchCurrentTopic?.title]);

  const loadConvs = useCallback(async () => {
    if (!isPrivate) return;
    try {
      const data = await fetchConversations();
      setConversations(data.conversations || []);
    } catch {}
  }, [isPrivate]);

  useEffect(() => {
    if (isPrivate) loadConvs();
  }, [isPrivate, loadConvs]);

  useEffect(() => {
    if (!isPrivate || !state.aiSidebarConversationId) {
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
      (m: any) => m.trustChoiceOptions && m.trustChoiceOptions.length > 0
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
  }, [state.trustWritingEnabled, isPrivate, state.researchCurrentTopicId, historyLoading, state.aiSidebarMessages, state.researchTopics, showTrustChoicePayload, listResearchTopics, buildTopicSelectChoices, buildOpenResearchChoices, state.researchCurrentTopic?.title]);

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
  }, [deleteTarget, dispatch, isPrivate, loadConvs, state.aiSidebarConversationId]);

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
  }, [dispatch, siteUsername, user?.username, state.blogCurrentPostId]);

  const researchToolNames = new Set(["research_add_source", "research_add_evidence", "research_add_claim", "research_add_relation", "research_add_proposal"]);
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
        (m: any) => m.trustChoiceOptions && m.trustChoiceOptions.length > 0
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

    const userMsg: any = {
      id: Date.now(),
      role: "user",
      content: text,
      conversation_id: isPrivate ? state.aiSidebarConversationId ?? 0 : 0,
      token_count: 0,
      created_at: new Date().toISOString(),
    };
    dispatch({ type: "ADD_AI_SIDEBAR_MSG", payload: userMsg });

    const assistantId = Date.now() + 1;
    const assistantMsg: any = {
      id: assistantId,
      role: "assistant",
      content: "",
      conversation_id: isPrivate ? state.aiSidebarConversationId ?? 0 : 0,
      thinkingMode: state.aiSidebarThinkingMode,
      token_count: 0,
      created_at: new Date().toISOString(),
    };
    dispatch({ type: "ADD_AI_SIDEBAR_MSG", payload: assistantMsg });

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
        // 构建页面上下文（始终发送）
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
        // 追加选中上下文（如果存在）
        if (state.aiSelectionContext) {
          pageContext.post_id = state.aiSelectionContext.postId;
          pageContext.selected_text = state.aiSelectionContext.selectedText;
        }
        // 发送后清除选中上下文
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
            if (toolName && researchToolNames.has(toolName)) hadResearchToolsRef.current = true;
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
        );
        await loadConvs();
        await refreshResearchTopicIfNeeded();
      } else if (siteUsername) {
        await sendSharedUserChat(siteUsername, text, postSlug, appendChunk);
      } else {
        await sendSharedLandingChat(text, appendChunk);
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
    } catch {
      setError("无法获取回复，请稍后重试");
      dispatch({
        type: "UPDATE_AI_SIDEBAR_MSG",
        payload: { id: assistantId, content: "**错误：无法获取回复**" },
      });
    } finally {
      setStreaming(false);
    }
  }, [dispatch, input, isPrivate, loadConvs, postSlug, refreshOwnPosts, refreshResearchTopicIfNeeded, siteUsername, state.aiSidebarConversationId, state.aiSidebarMode, state.aiSidebarThinkingMode, streaming, pageType, postTitle, state.aiSelectionContext, state.blogCurrentPostId, state.researchCurrentTopicId, state.researchCurrentTopic?.title, state.trustWritingEnabled, topicCreateMode, topicCreateMessageId, setTopicCreateMode, showTrustChoicePayload, state.researchTopics, state.aiSidebarMessages, listResearchTopics, buildTopicSelectChoices, buildOpenResearchChoices]);

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
  }, [dispatch, handleGoResearchReview, handleSend, state.researchCurrentTopicId, state.researchCurrentTopic, getResearchTopic, buildOpenResearchChoices, setTopicCreateMode, setTopicCreateMessageId, textareaRef]);

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

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return "今天";
    if (diff < 172800000) return "昨天";
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  if (!state.aiSidebarOpen) {
    return (
      <aside className="relative flex h-full w-full flex-col items-center border-l border-border/80 bg-card/82 pt-3 shadow-[-12px_0_35px_hsl(var(--foreground)/0.03)] backdrop-blur-xl">
        <div className="absolute inset-x-0 top-0 h-24 bg-primary/5" />
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 rounded-2xl border border-border/70 bg-background/70 text-primary shadow-sm hover:bg-primary/10"
          onClick={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true })}
          title={`展开 ${title}`}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full w-full flex-col border-l border-border/80 bg-card/82 shadow-[-12px_0_35px_hsl(var(--foreground)/0.04)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-primary/5" />

      <div className="relative flex flex-shrink-0 items-center gap-2 border-b border-border/70 bg-card/78 px-3 py-3 backdrop-blur-xl">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: false })}
          title="收起"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 text-sm font-black tracking-[-0.035em] text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            {title}
          </div>
          <div className="mt-0.5 truncate pl-9 text-[11px] text-muted-foreground">
            {isPrivate ? "写作、知识检索与工具任务" : "公开上下文普通聊天"}
          </div>
        </div>

        {isPrivate && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-medium border-primary/25 bg-primary/8 text-primary hover:bg-primary/15 hover:border-primary/40 shadow-sm">
                  {state.aiSidebarMode === "normal" ? <MessageSquare className="h-3 w-3" />
                    : state.aiSidebarMode === "knowledge" ? <Database className="h-3 w-3" />
                    : <WandSparkles className="h-3 w-3" />}
                  {currentModeLabel}
                  {state.aiSidebarThinkingMode === "deep" && (
                    <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-48">
                <DropdownMenuItem onClick={() => dispatch({ type: "SET_AI_SIDEBAR_MODE", payload: nextAiSidebarMode[state.aiSidebarMode] })}>
                  {state.aiSidebarMode === "normal" ? <MessageSquare className="mr-2 h-4 w-4" />
                    : state.aiSidebarMode === "knowledge" ? <Database className="mr-2 h-4 w-4" />
                    : <WandSparkles className="mr-2 h-4 w-4" />}
                  {currentModeLabel}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => dispatch({ type: "SET_AI_SIDEBAR_THINKING_MODE", payload: state.aiSidebarThinkingMode === "deep" ? "normal" : "deep" })}>
                  <Brain className="mr-2 h-4 w-4" />
                  深度思考
                  {state.aiSidebarThinkingMode === "deep" && <span className="ml-auto text-primary">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  const next = !state.trustWritingEnabled;
                  dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: next });
                  if (next) {
                    try {
                      const topics = await listResearchTopics();
                      dispatch({ type: "SET_RESEARCH_TOPICS", payload: topics });
                    } catch { /* topics will be fetched on demand later */ }
                  }
                }}>
                  <Search className="mr-2 h-4 w-4" />
                  研究写作
                  {state.trustWritingEnabled && <span className="ml-auto text-primary">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {isPrivate && sidebarView === "chat" ? (
          <Button variant="outline" size="sm" className="h-8 rounded-full bg-background/70 px-3 text-[11px]" onClick={handleBackToList}>
            <ChevronLeft className="h-3.5 w-3.5" />
            返回
          </Button>
        ) : (
          <Button size="sm" className="h-8 rounded-full px-3 text-[11px] shadow-md shadow-primary/15" onClick={handleNewChat}>
            <Plus className="h-3.5 w-3.5" />
            新对话
          </Button>
        )}
      </div>

      {isPrivate && sidebarView === "list" ? (
        <ScrollArea className="relative min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3">
            <div className="overflow-hidden rounded-3xl border border-border/70 bg-primary/8 p-4 shadow-sm">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/15">
                <Bot className="h-5 w-5" />
              </div>
              <div className="text-base font-black tracking-[-0.04em] text-foreground">灵感助手</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                选择历史会话，或开启一段新的写作与知识库问答。
              </p>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, maxHeight: 0 }}
                  animate={{ opacity: 1, maxHeight: 80 }}
                  exit={{ opacity: 0, maxHeight: 0 }}
                  className="flex items-center gap-2 bg-destructive/10 text-destructive py-2 px-3 rounded-xl text-[12px] overflow-hidden"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1">{error}</span>
                  <button className="flex-shrink-0 text-destructive/70 hover:text-destructive" onClick={() => setError(null)}>
                    <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {conversations.length === 0 ? (
              <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-border bg-background/55 p-5 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-bold text-foreground">还没有对话</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">点击「新对话」开始让 AI 帮你整理想法。</p>
                </div>
              </div>
            ) : (
              conversations.map((conv) => {
                const selected = conv.id === state.aiSidebarConversationId;
                return (
                  <motion.div
                    key={conv.id}
                    className={`group flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 transition-all duration-150 ${
                      selected
                        ? "border-primary/25 bg-primary/10 shadow-md shadow-primary/8"
                        : "border-border/60 bg-background/58 hover:border-primary/18 hover:bg-accent/70"
                    }`}
                    onClick={() => handleSelectConversation(conv)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") handleSelectConversation(conv);
                    }}
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.15 }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl ${selected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[13px] font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                        {conv.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(conv.created_at)}</div>
                    </div>
                    <button
                      className="flex-shrink-0 rounded-full p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      title="删除对话"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </motion.div>
                );
              })
            )}
          </div>
        </ScrollArea>
      ) : (
        <>
          <AnimatePresence>
            {(contextText || state.aiSelectionContext || state.trustWritingEnabled) && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                animate={{ maxHeight: 120, opacity: 1, paddingTop: 8, paddingBottom: 8 }}
                exit={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
                className="relative flex flex-col flex-shrink-0 gap-1 overflow-hidden border-b border-primary/15 bg-primary/10 px-3 text-[11px] font-medium text-primary"
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
                    <span className="flex-1 truncate">选中内容：{state.aiSelectionContext.selectedText.slice(0, 60)}{state.aiSelectionContext.selectedText.length > 60 ? "..." : ""}</span>
                    <button
                      className="flex-shrink-0 rounded px-1.5 text-[10px] hover:bg-primary/20"
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
                className="relative flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-destructive/15 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <ScrollArea className="relative min-h-0 flex-1">
            <div className="flex w-full flex-col gap-3 p-4">

              {historyLoading ? (
                <div className="flex min-h-[360px] items-center justify-center rounded-[1.6rem] border border-dashed border-primary/20 bg-primary/6 p-5 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
                      <Sparkles className="h-6 w-6 animate-pulse" />
                    </div>
                    <p className="text-base font-black tracking-[-0.04em] text-foreground">正在加载历史对话</p>
                    <p className="mt-2 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
                      请稍候，正在读取这段对话的历史消息。
                    </p>
                  </div>
                </div>
              ) : historyLoadError ? (
                <div className="flex min-h-[360px] items-center justify-center rounded-[1.6rem] border border-dashed border-destructive/30 bg-destructive/8 p-5 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-destructive/10 text-destructive ring-1 ring-destructive/15">
                      <AlertCircle className="h-6 w-6" />
                    </div>
                    <p className="text-base font-black tracking-[-0.04em] text-foreground">历史对话加载失败</p>
                    <p className="mt-2 max-w-[240px] text-xs leading-relaxed text-muted-foreground">{historyLoadError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 h-8 rounded-full px-4 text-[11px]"
                      onClick={() => setHistoryReloadKey((key) => key + 1)}
                    >
                      重新加载
                    </Button>
                  </div>
                </div>
              ) : visibleAiSidebarMessages.length === 0 ? (
                <div className="flex min-h-[360px] items-center justify-center rounded-[1.6rem] border border-dashed border-border bg-background/52 p-5 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
                      <Sparkles className="h-6 w-6" />
                    </div>
                    <p className="text-base font-black tracking-[-0.04em] text-foreground">有什么我可以帮你的？</p>
                    <p className="mt-2 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
                      {isPrivate ? "可以帮你写文章、总结知识库、润色段落或拆解思路。" : "可以围绕当前公开页面进行普通聊天和内容讨论。"}
                    </p>
                  </div>
                </div>
              ) : (
                visibleAiSidebarMessages.map((msg, i) => {
                  const isLast = i === visibleAiSidebarMessages.length - 1;
                  const isStreaming = isLast && streaming && msg.role === "assistant";
                  const isAssistant = msg.role === "assistant";
                  const msgThinkingMode = msg.thinkingMode ?? (msg.reasoningContent || msg.thinkingContent ? "deep" : "normal");
                  const isDeepMode = msgThinkingMode === "deep";
                  const messageContent = msg.trustChoicePrompt ?? msg.content;
                  const showTrustChoices = isAssistant && !isStreaming && !!msg.trustChoiceOptions?.length;

                  const meaningfulReasoning = isDeepMode && !!msg.reasoningContent && msg.reasoningContent.trim().length > 3;
                  const hasToolEvents = !!(msg.toolEvents && msg.toolEvents.length > 0);
                  const hasThinkingContent = !!msg.thinkingContent || hasToolEvents || meaningfulReasoning;
                  const showThinkingPanel = isAssistant && (isDeepMode ? hasThinkingContent : hasToolEvents);
                  const allRefs: Reference[] = (msg.toolEvents || [])
                    .filter(e => e.type === "end" && e.references?.length)
                    .flatMap(e => e.references || []);
                  const uniqueRefs = [...new Map(allRefs.map(r => {
                    const key = r.type === "rag" ? `rag:${r.source}` : `mcp:${r.server}/${r.tool}`;
                    return [key, r];
                  })).values()];

                  return (
                    <motion.div
                      key={msg.id}
                      className={`flex min-w-0 gap-2.5 ${isAssistant ? "" : "flex-row-reverse"}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl text-[12px] font-bold ${
                        isAssistant
                          ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                          : "bg-secondary text-foreground ring-1 ring-border/80"
                      }`}>
                        {isAssistant ? <Sparkles className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                      </div>

                      <div className={`min-w-0 max-w-[calc(100%-52px)] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${
                        isAssistant
                          ? "rounded-tl-md border border-border/70 bg-background/76 text-foreground"
                          : "rounded-tr-md bg-primary text-primary-foreground shadow-primary/15"
                      } ${isStreaming ? "border-l-2 border-l-primary" : ""}`}>

                        {/* Thinking panel — streaming with content: expanded above; done: collapsible */}
                        {showThinkingPanel && isStreaming && msg.content && (
                          <div className="mb-2.5 space-y-2 rounded-lg border border-border/40 bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
                            {meaningfulReasoning && (
                              <div className="rounded-md bg-background/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                <div className="mb-1 flex items-center gap-1 text-primary">
                                  <Brain className="h-3 w-3 animate-pulse" />
                                  <span className="font-medium">推理中...</span>
                                </div>
                                {msg.reasoningContent}
                              </div>
                            )}
                            {msg.toolEvents?.map((evt, ei) => (
                              <div key={ei} className="flex items-start gap-1.5">
                                {evt.type === "start" ? (
                                  <Search className="mt-0.5 h-3 w-3 flex-shrink-0 animate-pulse text-muted-foreground/70" />
                                ) : (
                                  <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className={evt.type === "start" ? "text-muted-foreground" : "text-foreground"}>
                                    {evt.toolName}{evt.type === "start" ? "..." : ""}
                                  </span>
                                  {evt.type === "end" && evt.result && (
                                    <div className="mt-0.5 truncate pl-2 text-[10px] text-muted-foreground/80">
                                      {evt.result.replace(/\n/g, " ").slice(0, 120)}
                                    </div>
                                  )}
                                  {evt.type === "end" && evt.references?.map((ref, ri) => (
                                    <div key={ri} className="mt-0.5 flex items-center gap-1 pl-2 text-[10px]">
                                      {ref.type === "rag" ? (
                                        <>
                                          <BookOpen className="h-2.5 w-2.5" />
                                          <span>{ref.source}{ref.collection ? ` · ${ref.collection}` : ""}{ref.distance != null ? ` · 距离: ${ref.distance.toFixed(2)}` : ""}</span>
                                        </>
                                      ) : (
                                        <>
                                          <Link2 className="h-2.5 w-2.5" />
                                          <span>{ref.server}/{ref.tool}</span>
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {showThinkingPanel && !isStreaming && (
                          <Collapsible defaultOpen={false} className="mb-2.5">
                            <CollapsibleTrigger asChild>
                              <button className="flex w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
                                <ChevronDown className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
                                {isDeepMode ? <Brain className="h-3 w-3" /> : <Search className="h-3 w-3" />}
                                {isDeepMode ? "思考过程" : "工具执行过程"}
                                {msg.toolEvents && msg.toolEvents.filter(e => e.type === "end").length > 0 && (
                                  <span className="ml-0.5 text-primary">
                                    ({msg.toolEvents.filter(e => e.type === "end").length} 步)
                                  </span>
                                )}
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-1.5 space-y-2 rounded-lg border border-border/40 bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
                              {/* Reasoning content (DeepSeek internal) */}
                              {meaningfulReasoning && (
                                <div className="rounded-md bg-background/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                  <div className="mb-1 flex items-center gap-1 text-primary">
                                    <Brain className="h-3 w-3" />
                                    <span className="font-medium">推理链</span>
                                  </div>
                                  {msg.reasoningContent}
                                </div>
                              )}

                              {/* Tool events */}
                              {msg.toolEvents?.map((evt, ei) => (
                                <div key={ei} className="flex items-start gap-1.5">
                                  {evt.type === "start" ? (
                                    <Search className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground/70" />
                                  ) : (
                                    <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <span className={evt.type === "start" ? "text-muted-foreground" : "text-foreground"}>
                                      {evt.toolName}
                                    </span>
                                    {evt.type === "end" && evt.result && (
                                      <div className="mt-0.5 truncate pl-2 text-[10px] text-muted-foreground/80">
                                        {evt.result.replace(/\n/g, " ").slice(0, 120)}
                                      </div>
                                    )}
                                    {evt.type === "end" && evt.references?.map((ref, ri) => (
                                      <div key={ri} className="mt-0.5 flex items-center gap-1 pl-2 text-[10px]">
                                        {ref.type === "rag" ? (
                                          <>
                                            <BookOpen className="h-2.5 w-2.5" />
                                            <span>{ref.source}{ref.collection ? ` · ${ref.collection}` : ""}{ref.distance != null ? ` · 距离: ${ref.distance.toFixed(2)}` : ""}</span>
                                          </>
                                        ) : (
                                          <>
                                            <Link2 className="h-2.5 w-2.5" />
                                            <span>{ref.server}/{ref.tool}</span>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}

                              {/* Intermediate thinking text */}
                              {isDeepMode && msg.thinkingContent && (
                                <div className="mt-1 rounded-md bg-background/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                  {msg.thinkingContent.replace(/\\n/g, "\n").replace(/\n{3,}/g, "\n\n")}
                                </div>
                              )}
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {/* Main content — 有实际回复时渲染 markdown；无内容但有思考过程时直接展示 */}
                        {messageContent ? (
                          <div className="prose prose-sm max-w-none break-words text-foreground [&_*]:text-foreground prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:rounded-md prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:my-2 prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:my-2 prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:py-0.5 prose-blockquote:text-foreground dark:prose-invert">
                            <Markdown remarkPlugins={[remarkGfm]}>
                              {messageContent}
                            </Markdown>
                          </div>
                        ) : isStreaming && showThinkingPanel ? (
                          <div className="space-y-2">
                            {meaningfulReasoning && (
                              <div className="rounded-md bg-background/60 p-2.5 text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                                <div className="mb-1.5 flex items-center gap-1.5 text-primary">
                                  <Brain className="h-3.5 w-3.5 animate-pulse" />
                                  <span className="font-medium">推理中...</span>
                                </div>
                                {msg.reasoningContent}
                              </div>
                            )}
                            {msg.toolEvents?.map((evt, ei) => (
                              <div key={ei} className="flex items-start gap-1.5 text-[12px]">
                                {evt.type === "start" ? (
                                  <Search className="mt-0.5 h-3 w-3 flex-shrink-0 animate-pulse text-muted-foreground/70" />
                                ) : (
                                  <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
                                )}
                                <span className={evt.type === "start" ? "text-muted-foreground" : "text-foreground"}>
                                  {evt.toolName}{evt.type === "start" ? "..." : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : isStreaming ? (
                          <div className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:0.2s]" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:0.4s]" />
                          </div>
                        ) : null}

                        {showTrustChoices && (
                          <TrustChoiceGroup
                            options={msg.trustChoiceOptions ?? []}
                            disabled={streaming}
                            onSelect={(option) => handleTrustChoiceSelect(msg.id, option)}
                          />
                        )}

                        {/* Simplified reference tags */}
                        {uniqueRefs.length > 0 && !isStreaming && (
                          <div className="mt-2.5 border-t border-border/40 pt-2">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                              <span className="font-medium text-muted-foreground/70">引用来源</span>
                              {uniqueRefs.map((ref, ri) => (
                                <span key={ri} className="inline-flex items-center gap-0.5">
                                  {ref.type === "rag" ? (
                                    <>
                                      <BookOpen className="h-2.5 w-2.5" />
                                      {ref.source}
                                    </>
                                  ) : (
                                    <>
                                      <Link2 className="h-2.5 w-2.5" />
                                      {ref.server}/{ref.tool}
                                    </>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={msgsEndRef} />
            </div>
          </ScrollArea>

          <div className="relative flex-shrink-0 border-t border-border/70 bg-card/86 p-3 backdrop-blur-xl">
            <div className="rounded-[1.35rem] border border-border/70 bg-background/78 p-1.5 shadow-lg shadow-foreground/5 transition-all duration-200 focus-within:border-primary/55 focus-within:shadow-primary/12">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  className="min-h-[40px] max-h-[88px] flex-1 resize-none border-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder={topicCreateMode ? "输入新研究主题名称，Enter 创建..." : "输入消息，Enter 发送..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <Button
                  size="icon"
                  className="mb-0.5 h-9 w-9 rounded-2xl shadow-md shadow-primary/20"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || streaming}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

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
