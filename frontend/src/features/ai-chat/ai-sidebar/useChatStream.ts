import { useCallback } from "react";


import { useChatAttachments } from "../hooks/useChatAttachments";
import { useChatDispatch } from "../../../stores/chatStore";

import { createPatchDeltaPlayer, type PatchDeltaPlayer } from "./patchDeltaPlayer";
import { saveAISidebarSession, type AISidebarProps } from "./constants";

import type { RefObject } from "react";
import type { BlogToolMeta, StreamReference } from "@/api/chat";
import type { AISidebarConversationKey, Message, Reference, ThinkingMode } from "@/types/chat";
import type { AuthUser } from "../../../stores/authStore";
import type { RunState } from "../AISidebar";

import { sendChat, sendSharedLandingChat, sendSharedUserChat } from "@/api/chat";
import { errorMessage } from "@/lib/errors";
import { logWarn } from "@/utils/logger";

function makeServerKey(conversationId: number): AISidebarConversationKey {
  return `server:${conversationId}`;
}

export interface RunChatStreamParams {
  convKey: AISidebarConversationKey;
  text: string;
  assistantId: number;
  assistantStartedAt: number;
  initialConversationId: number | null;
  attachments: Array<{ id: string }>;
  attachmentLocalIds: string[];
  optimisticUserMessageId: number;
}

export interface UseChatStreamOptions {
  isPrivate: boolean;
  pageType: AISidebarProps["pageType"];
  postSlug?: string;
  postTitle?: string;
  siteUsername?: string;
  dispatch: ReturnType<typeof useChatDispatch>;
  aiSidebarThinkingMode: ThinkingMode;
  blogCurrentPostId: number | null;
  aiSelectionContext: { postId: number; selectedText: string; sectionIndex: number } | null;
  aiLeftbarEditContext: { html: string | null; heightPx?: number | null } | null;
  user: AuthUser | null;
  loadConvs: () => Promise<void>;
  abortControllersRef: RefObject<Map<AISidebarConversationKey, AbortController>>;
  runRefs: RefObject<Map<AISidebarConversationKey, RunState>>;
  skipNextHistoryLoadRef: RefObject<Set<number>>;
  attachments: ReturnType<typeof useChatAttachments>;
  refreshOwnPosts: (blogMeta?: BlogToolMeta) => Promise<boolean>;
}

// 流式运行：controller → sendChat callbacks → catch/finally。从 AISidebarChat 抽出，行为不变。
export function useChatStream(options: UseChatStreamOptions) {
  const {
    isPrivate,
    pageType,
    postSlug,
    postTitle,
    siteUsername,
    dispatch,
    aiSidebarThinkingMode,
    blogCurrentPostId,
    aiSelectionContext,
    aiLeftbarEditContext,
    user,
    loadConvs,
    abortControllersRef,
    runRefs,
    skipNextHistoryLoadRef,
    attachments,
    refreshOwnPosts,
  } = options;

  const runChatStream = useCallback(async (params: RunChatStreamParams): Promise<void> => {
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
          if (err instanceof Error && err.name !== "AbortError") {
            logWarn("UI queue step failed", { error: err });
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
        if (blogCurrentPostId) {
          pageContext.post_id = blogCurrentPostId;
          if (postTitle) pageContext.post_title = postTitle;
        }
        if (aiSelectionContext) {
          pageContext.post_id = aiSelectionContext.postId;
          pageContext.selected_text = aiSelectionContext.selectedText;
          if (aiSelectionContext.sectionIndex > 0) {
            pageContext.section_index = aiSelectionContext.sectionIndex;
          }
          dispatch({ type: "CLEAR_AI_SELECTION_CONTEXT" });
        }
        if (aiLeftbarEditContext) {
          pageContext.current_leftbar_html = aiLeftbarEditContext.html;
          if (aiLeftbarEditContext.heightPx != null) {
            pageContext.current_leftbar_height_px = aiLeftbarEditContext.heightPx;
          }
          dispatch({ type: "CLEAR_AI_LEFTBAR_EDIT_CONTEXT" });
        }

        await sendChat(text, initialConversationId, {
          attachments: sentAttachments,
          thinkingMode: aiSidebarThinkingMode,
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
              controller.abort();
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
      if (err instanceof Error && err.name === "AbortError" && !runState.streamError) {
        dispatch({ type: "APPLY_AI_STREAM_EVENT_FOR_KEY", payload: { key: activeKey, id: assistantId, event: { type: "discard" } } });
        if (!runState.streamFinalized) updateAssistant({ content: "已停止" });
      } else {
        const message = runState.streamError ?? errorMessage(err, "无法获取回复，请稍后重试");
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
  }, [
    abortControllersRef,
    runRefs,
    skipNextHistoryLoadRef,
    attachments,
    dispatch,
    isPrivate,
    pageType,
    postSlug,
    postTitle,
    siteUsername,
    loadConvs,
    refreshOwnPosts,
    aiSidebarThinkingMode,
    blogCurrentPostId,
    aiSelectionContext,
    aiLeftbarEditContext,
    user,
  ]);

  return { runChatStream };
}
