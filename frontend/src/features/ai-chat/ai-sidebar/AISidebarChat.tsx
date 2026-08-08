import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../../stores/authStore";
import { isDisplayableMessage, useChat } from "../../../stores/chatStore";
import type { AISidebarConversationKey, Message, Reference } from "../../../stores/chatStore";
import { sendChat, sendSharedLandingChat, sendSharedUserChat } from "@/api/chat";
import { getMessages } from "@/api/conversations";
import { listSitePosts, getBlogPost } from "@/api/blog";
import type { BlogToolMeta, StreamReference } from "@/api/chat";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, AlertCircle } from "lucide-react";
import { LoginDialog } from "../../auth/LoginDialog";
import { ChatInputBar } from "./ChatInputBar";
import { MessageList } from "./MessageList";
import { createPatchDeltaPlayer, type PatchDeltaPlayer } from "./patchDeltaPlayer";
import {
  blogToolOperations,
  saveAISidebarSession,
  type AISidebarProps,
} from "./constants";
import { useChatAttachments } from "../hooks/useChatAttachments";
import { useAISidebarRuntime } from "./AISidebarRuntimeContext";
import type { RunState } from "../AISidebar";

function makeServerKey(conversationId: number): AISidebarConversationKey {
  return `server:${conversationId}`;
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

export interface AISidebarChatProps {
  isPrivate: boolean;
  contextText: string;
  siteUsername?: string;
  postSlug?: string;
  pageType: AISidebarProps["pageType"];
  postTitle?: string;
  msgsEndRef: React.RefObject<HTMLDivElement | null>;
  messagesViewportRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToLatest: (behavior?: ScrollBehavior) => void;
}

// chat 子组件：消费运行时 Context + 自取 store；持有 chat 全部 state/ref/handler/effect。
// 从 AISidebar 抽出，行为不变；runChatStream/handleSend deps 数组逐字复制。
export function AISidebarChat({
  isPrivate,
  contextText,
  siteUsername,
  postSlug,
  pageType,
  postTitle,
  msgsEndRef,
  messagesViewportRef,
  isAtBottom,
  scrollToLatest,
}: AISidebarChatProps) {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated } = useAuth();
  const {
    selectedKey,
    getActiveKey,
    setInputForKey,
    loadConvs,
    abortControllersRef,
    runRefs,
    scrollToLatestAfterRender,
    historyReloadKey,
    setHistoryReloadKey,
  } = useAISidebarRuntime();

  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRequestSeqRef = useRef(new Map<AISidebarConversationKey, number>());
  const streamingByKeyRef = useRef(state.aiSidebarStreamingByKey);
  const skipNextHistoryLoadRef = useRef(new Set<number>());

  const selectedMessages = useMemo(
    () => (selectedKey ? state.aiSidebarMessagesByKey[selectedKey] ?? [] : []),
    [selectedKey, state.aiSidebarMessagesByKey],
  );
  const selectedStreaming = selectedKey ? !!state.aiSidebarStreamingByKey[selectedKey] : false;
  const selectedInput = selectedKey ? state.aiSidebarInputsByKey[selectedKey] ?? "" : "";
  const selectedError = selectedKey ? state.aiSidebarErrorsByKey[selectedKey] ?? null : null;
  const selectedHistory = selectedKey ? state.aiSidebarHistoryByKey[selectedKey] ?? { loading: false, error: null } : { loading: false, error: null };
  const aiSidebarMessageGroups = useMemo(() => buildMessageGroups(selectedMessages), [selectedMessages]);
  const attachments = useChatAttachments(selectedKey, isPrivate && isAuthenticated && !selectedStreaming);

  useEffect(() => {
    streamingByKeyRef.current = state.aiSidebarStreamingByKey;
  }, [state.aiSidebarStreamingByKey]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 88) + "px";
    }
  }, [selectedInput]);

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

  const refreshOwnPosts = useCallback(async (blogMeta?: BlogToolMeta): Promise<boolean> => {
    if (!user?.username || !blogMeta?.operation || !blogToolOperations.has(blogMeta.operation)) return false;
    if (siteUsername && siteUsername !== user.username) return false;
    const updatedPostId = blogMeta.post_id;
    if (updatedPostId && (blogMeta.operation === "write_post" || blogMeta.operation === "edit_post")) {
      try {
        const fullPost = await getBlogPost(updatedPostId);
        dispatch({ type: "UPDATE_BLOG_POST", payload: fullPost });
        return true;
      } catch (e) {
        console.warn("Failed to refresh target post after blog tool, falling back to list:", e);
      }
    }
    try {
      const data = await listSitePosts(user.username, { include_drafts: true });
      dispatch({ type: "SET_BLOG_POSTS", payload: data.posts });
      return true;
    } catch (e) {
      console.warn("Failed to refresh posts after blog tool:", e);
      return false;
    }
  }, [dispatch, siteUsername, user]);

  // 流式运行：controller → sendChat callbacks → catch/finally。调用级变量（convKey/text/assistantId/...）参数传入，
  // 组件级 state/ref/handler 闭包。从 handleSend 抽出以让前置逻辑可读；deps 列全则无 stale closure（与原 handleSend 同等）。
  const runChatStream = useCallback(async (params: {
    convKey: AISidebarConversationKey;
    text: string;
    assistantId: number;
    assistantStartedAt: number;
    initialConversationId: number | null;
    attachments: Array<{ id: string }>;
    attachmentLocalIds: string[];
    optimisticUserMessageId: number;
  }) => {
    const {
      convKey,
      text,
      assistantId,
      assistantStartedAt,
      initialConversationId,
      attachments: sentAttachments,
      attachmentLocalIds,
      optimisticUserMessageId,
    } = params;
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
    let persistenceConfirmed = false;

    const updateAssistant = (payload: Partial<Message>) => {
      dispatch({ type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY", payload: { key: activeKey, id: assistantId, ...payload } });
    };
    let patchPlayer: PatchDeltaPlayer | null = null;
    let blogPlayer: PatchDeltaPlayer | null = null;
    let activePatchStream: { postId: number; runId: string } | null = null;
    let activeBlogStream: { postId: number; runId: string } | null = null;
    const cancelPlayer = (player: PatchDeltaPlayer | null) => {
      player?.cancel();
    };

    try {
      const appendChunk = (chunk: string) => {
        runState.finalContent += chunk;
        updateAssistant({ content: runState.finalContent });
      };

      let uiChain: Promise<void> = Promise.resolve();
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
      };
      const finishBlog = async () => {
        const player = blogPlayer;
        if (player) await player.finish();
        blogPlayer = null;
      };
      if (isPrivate) {
        const pageContext: Record<string, unknown> = { page_type: pageType };
        if (state.blogCurrentPostId) {
          pageContext.post_id = state.blogCurrentPostId;
          if (postTitle) pageContext.post_title = postTitle;
        }
        if (state.aiSelectionContext) {
          pageContext.post_id = state.aiSelectionContext.postId;
          pageContext.selected_text = state.aiSelectionContext.selectedText;
          if (state.aiSelectionContext.sectionIndex > 0) {
            pageContext.section_index = state.aiSelectionContext.sectionIndex;
          }
          dispatch({ type: "CLEAR_AI_SELECTION_CONTEXT" });
        }
        if (state.aiLeftbarEditContext) {
          pageContext.current_leftbar_html = state.aiLeftbarEditContext.html;
          if (state.aiLeftbarEditContext.heightPx != null) {
            pageContext.current_leftbar_height_px = state.aiLeftbarEditContext.heightPx;
          }
          dispatch({ type: "CLEAR_AI_LEFTBAR_EDIT_CONTEXT" });
        }

        await sendChat(text, initialConversationId, {
          attachments: sentAttachments,
          thinkingMode: state.aiSidebarThinkingMode,
          context: pageContext,
          signal: controller.signal,
          callbacks: {
            onDone: (metadata) => {
              const validPersistence = [
                metadata.conversation_id,
                metadata.message_id,
                metadata.user_message_id,
              ].every((value) => Number.isInteger(value) && Number(value) > 0);
              if (!validPersistence) {
                runState.streamError = "回复已生成，但消息保存失败，请重试。";
                return;
              }
              persistenceConfirmed = true;
              attachments.clear(activeKey);
              runState.conversationId = metadata.conversation_id;
              runState.userMessageId = metadata.user_message_id;
              runState.assistantPersistedMessageId = metadata.message_id;
              dispatch({
                type: "UPDATE_AI_SIDEBAR_MSG_FOR_KEY",
                payload: {
                  key: activeKey,
                  id: optimisticUserMessageId,
                  ...(metadata.attachments ? { attachments: metadata.attachments } : {}),
                  conversation_id: metadata.conversation_id,
                },
              });
              const serverKey = makeServerKey(metadata.conversation_id);
              if (activeKey !== serverKey) {
                abortControllersRef.current.delete(activeKey);
                abortControllersRef.current.set(serverKey, controller);
                runRefs.current.delete(activeKey);
                runRefs.current.set(serverKey, runState);
                dispatch({ type: "MIGRATE_AI_SIDEBAR_TEMP_KEY", payload: { fromKey: activeKey, toKey: serverKey, conversationId: metadata.conversation_id } });
                if (user) {
                  saveAISidebarSession(user.id, {
                    version: 1,
                    view: "chat",
                    target: { kind: "server", conversationId: metadata.conversation_id },
                  });
                }
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
            onToolPrep: ({ tool_name: toolName, stream_id: streamId }) => {
              if (runState.toolEvents.some((e) => e.streamId === streamId && e.type === "start")) return;
              const parsedRound = Number.parseInt(streamId.split(":")[0], 10);
              runState.toolEvents = [...runState.toolEvents, {
                type: "start" as const,
                toolName,
                streamId,
                roundId: Number.isNaN(parsedRound) ? undefined : parsedRound,
                status: "preparing" as const,
              }];
              updateAssistant({ toolEvents: runState.toolEvents });
            },
            onToolCall: (toolName, meta) => {
              const streamId = meta?.stream_id;
              const existingIdx = streamId
                ? runState.toolEvents.findIndex((e) => e.streamId === streamId && e.type === "start")
                : -1;
              if (existingIdx !== -1) {
                const next = [...runState.toolEvents];
                next[existingIdx] = {
                  ...next[existingIdx],
                  toolName,
                  callId: meta?.call_id,
                  roundId: meta?.round_id,
                  loopStepIndex: meta?.loop_step_index,
                  status: "running" as const,
                };
                runState.toolEvents = next;
              } else {
                runState.toolEvents = [...runState.toolEvents, {
                  type: "start" as const,
                  toolName,
                  callId: meta?.call_id,
                  roundId: meta?.round_id,
                  loopStepIndex: meta?.loop_step_index,
                  streamId,
                  status: "running" as const,
                }];
              }
              updateAssistant({ toolEvents: runState.toolEvents });
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
                streamId: meta?.stream_id,
              }];
              updateAssistant({ toolEvents: runState.toolEvents });
              if (toolName === "update_blog_sidebar") {
                const html = (blogMeta as { html?: string } | undefined)?.html;
                if (html) dispatch({ type: "SET_LEFTBAR_HTML", payload: html });
              }
              const targetPostId = blogMeta?.post_id;
              if (toolName === "blog_edit_post" && activePatchStream && targetPostId === activePatchStream.postId) {
                const completed = activePatchStream;
                enqueueUi(async () => {
                  await finishPatch();
                  const refreshed = await refreshOwnPosts(blogMeta);
                  if (refreshed) dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING", payload: completed });
                  if (activePatchStream?.runId === completed.runId) activePatchStream = null;
                });
              } else if (toolName === "blog_write_post" && activeBlogStream && targetPostId === activeBlogStream.postId) {
                const completed = activeBlogStream;
                enqueueUi(async () => {
                  await finishBlog();
                  const refreshed = await refreshOwnPosts(blogMeta);
                  if (refreshed) dispatch({ type: "CLEAR_BLOG_STREAMING", payload: completed });
                  if (activeBlogStream?.runId === completed.runId) activeBlogStream = null;
                });
              } else {
                enqueueUi(async () => { await refreshOwnPosts(blogMeta); });
              }
            },
            onPatchStart: ({ post_id: postId, stream_id: streamId, target_text: targetText }) => {
              const runId = `${activeKey}:${streamId}`;
              cancelPlayer(patchPlayer);
              activePatchStream = { postId, runId };
              patchPlayer = createPatchDeltaPlayer((replacementDelta) => {
                dispatch({
                  type: "APPEND_BLOG_PATCH_STREAMING",
                  payload: { postId, runId, replacementDelta },
                });
              });
              dispatch({
                type: "START_BLOG_PATCH_STREAMING",
                payload: { postId, runId, targetText },
              });
              patchPlayer.open();
            },
            onPatchDelta: ({ post_id: postId, stream_id: streamId, replacement_delta: replacementDelta }) => {
              const runId = `${activeKey}:${streamId}`;
              if (activePatchStream?.postId === postId && activePatchStream.runId === runId) {
                patchPlayer?.push(replacementDelta);
              }
            },
            onBlogStart: ({ post_id: postId, stream_id: streamId }) => {
              const runId = `${activeKey}:${streamId}`;
              cancelPlayer(blogPlayer);
              activeBlogStream = { postId, runId };
              blogPlayer = createPatchDeltaPlayer((contentDelta) => {
                dispatch({
                  type: "APPEND_BLOG_STREAMING",
                  payload: { postId, runId, contentDelta },
                });
              });
              dispatch({ type: "START_BLOG_STREAMING", payload: { postId, runId } });
              blogPlayer.open();
            },
            onBlogDelta: ({ post_id: postId, stream_id: streamId, content_delta: contentDelta }) => {
              const runId = `${activeKey}:${streamId}`;
              if (activeBlogStream?.postId === postId && activeBlogStream.runId === runId) {
                blogPlayer?.push(contentDelta);
              }
            },
            onReasoning: (reasoningDelta) => {
              runState.reasoningContent += reasoningDelta;
              updateAssistant({ reasoningContent: runState.reasoningContent });
            },
          },
        });
        await drainUiChain();
        if (
          persistenceConfirmed
          && runState.userMessageId
          && runState.assistantPersistedMessageId
        ) {
          dispatch({
            type: "RECONCILE_AI_SIDEBAR_MESSAGE_IDS",
            payload: {
              key: activeKey,
              optimisticUserId: optimisticUserMessageId,
              userMessageId: runState.userMessageId,
              optimisticAssistantId: assistantId,
              assistantMessageId: runState.assistantPersistedMessageId,
            },
          });
        }
        if (runState.streamError) throw new Error(runState.streamError);
        if (!persistenceConfirmed) throw new Error("消息保存状态未确认，请重试。");
        await loadConvs();
      } else if (siteUsername) {
        await sendSharedUserChat(siteUsername, text, postSlug, appendChunk, controller.signal);
      } else {
        await sendSharedLandingChat(text, appendChunk, controller.signal);
      }
    } catch (err) {
      cancelPlayer(patchPlayer);
      cancelPlayer(blogPlayer);
      if (activePatchStream) {
        dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING", payload: activePatchStream });
      }
      if (activeBlogStream) {
        dispatch({ type: "CLEAR_BLOG_STREAMING", payload: activeBlogStream });
      }
      if (!persistenceConfirmed) attachments.restoreUploaded(attachmentLocalIds, activeKey);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, dispatch, isPrivate, pageType, postSlug, postTitle, siteUsername, loadConvs, refreshOwnPosts, state.aiSidebarThinkingMode, state.blogCurrentPostId, state.aiSelectionContext, state.aiLeftbarEditContext]);

  const handleSend = useCallback(async (textOverride?: string) => {
    const convKey = getActiveKey();
    const text = (textOverride ?? state.aiSidebarInputsByKey[convKey] ?? "").trim();
    const includeDraftAttachments = textOverride === undefined && isPrivate;
    const readyDrafts = includeDraftAttachments ? attachments.uploaded : [];
    if ((!text && readyDrafts.length === 0) || state.aiSidebarStreamingByKey[convKey]) return;
    if (includeDraftAttachments && (attachments.hasUploading || attachments.hasFailed)) return;

    const attachmentLocalIds = readyDrafts.map((draft) => draft.localId);
    const sentAttachments = readyDrafts.flatMap((draft) => draft.attachment ? [{ id: draft.attachment.id }] : []);
    attachments.markSending(attachmentLocalIds);
    setInputForKey(convKey, "");
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: convKey, error: null } });
    dispatch({ type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY", payload: { key: convKey, streaming: true } });

    const initialConversationId = isPrivate ? getConversationIdFromKey(convKey) : null;
    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: text,
      conversation_id: initialConversationId ?? 0,
      attachments: readyDrafts.flatMap((draft) => draft.attachment ? [draft.attachment] : []),
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

    await runChatStream({
      convKey,
      text,
      assistantId,
      assistantStartedAt,
      initialConversationId,
      attachments: sentAttachments,
      attachmentLocalIds,
      optimisticUserMessageId: userMsg.id,
    });
  }, [attachments, dispatch, getActiveKey, isPrivate, runChatStream, scrollToLatestAfterRender, setInputForKey, state.aiSidebarInputsByKey, state.aiSidebarStreamingByKey, state.aiSidebarThinkingMode]);

  const handleStop = useCallback(() => {
    if (!selectedKey) return;
    abortControllersRef.current.get(selectedKey)?.abort();
    abortControllersRef.current.delete(selectedKey);
    dispatch({ type: "SET_AI_SIDEBAR_STREAMING_FOR_KEY", payload: { key: selectedKey, streaming: false } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, selectedKey]);

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
  }, [handleSend]);

  const handleReloadHistory = useCallback(() => {
    setHistoryReloadKey((key) => key + 1);
  }, [setHistoryReloadKey]);

  const handleOpenPlugins = useCallback(() => {
    if (!isAuthenticated) {
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "TOGGLE_PLUGIN_CENTER", payload: true });
  }, [dispatch, isAuthenticated]);

  const handleLoginSuccess = useCallback(() => {
    setLoginDialogOpen(false);
    dispatch({ type: "TOGGLE_PLUGIN_CENTER", payload: true });
  }, [dispatch]);

  const handleJumpToLatest = useCallback(() => {
    scrollToLatest("smooth");
  }, [scrollToLatest]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <AnimatePresence>
        {(contextText || state.aiSelectionContext || state.aiLeftbarEditContext) && (
          <motion.div
            initial={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
            animate={{ maxHeight: 120, opacity: 1, paddingTop: 8, paddingBottom: 8 }}
            exit={{ maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }}
            className="pointer-events-auto absolute left-0 right-0 top-0 z-30 flex flex-col gap-1 overflow-hidden border-b border-primary/15 bg-context-bar/85 px-3 text-fine font-medium text-primary shadow-sm backdrop-blur-sm"
          >
            {contextText && (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]" />
                <span className="truncate">{contextText}</span>
              </div>
            )}
            {state.aiSelectionContext && (
              <div className="flex items-center gap-2">
                <Sparkles className="h-3 w-3 flex-shrink-0 text-primary" />
                <span className="flex-1 truncate">
                  选中内容：{state.aiSelectionContext.selectedText.slice(0, 60)}
                  {state.aiSelectionContext.selectedText.length > 60 ? "..." : ""}
                </span>
                <button
                  className="flex-shrink-0 rounded px-1.5 text-caption hover:bg-primary/20"
                  onClick={() => dispatch({ type: "CLEAR_AI_SELECTION_CONTEXT" })}
                >
                  取消
                </button>
              </div>
            )}
            {state.aiLeftbarEditContext && (
              <div className="flex items-center gap-2">
                <Sparkles className="h-3 w-3 flex-shrink-0 text-primary" />
                <span className="flex-1 truncate">正在编辑主页侧栏</span>
                <button
                  className="flex-shrink-0 rounded px-1.5 text-caption hover:bg-primary/20"
                  onClick={() => dispatch({ type: "CLEAR_AI_LEFTBAR_EDIT_CONTEXT" })}
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
            className="relative z-20 flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-destructive/15 bg-destructive/10 px-3 py-2 text-meta text-destructive"
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
      />

      <ChatInputBar
        streaming={selectedStreaming}
        input={selectedInput}
        attachments={attachments.drafts}
        attachmentsEnabled={isPrivate && isAuthenticated && !selectedStreaming}
        sendDisabled={attachments.hasUploading || attachments.hasFailed || (!selectedInput.trim() && attachments.uploaded.length === 0)}
        getAttachmentPreviewUrl={attachments.getPreviewUrl}
        onSelectAttachments={attachments.addFiles}
        onRetryAttachment={attachments.retry}
        onRemoveAttachment={(localId) => { void attachments.remove(localId); }}
        textareaRef={textareaRef}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={handleSendClick}
        onStop={handleStop}
        onOpenPlugins={handleOpenPlugins}
      />

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />
    </div>
  );
}
