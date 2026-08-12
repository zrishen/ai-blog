import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatProvider, useChat } from "../../src/stores/chatStore";

import type { DraftAttachment } from "../../src/features/ai-chat/types";

const TEMP_KEY = "temp:attachments" as const;

function makeDraft(localId: string): DraftAttachment {
  return {
    localId,
    file: new File([localId], `${localId}.txt`, { type: "text/plain" }),
    status: "uploaded",
    progress: 100,
    position: 0,
  };
}

describe("chatStore AI sidebar attachments", () => {
  it("迁移 temp key 并在 remove thread 清理附件", () => {
    const { result } = renderHook(() => useChat(), { wrapper: ChatProvider });
    act(() => {
      result.current.dispatch({
        type: "ADD_AI_SIDEBAR_ATTACHMENTS_FOR_KEY",
        payload: { key: TEMP_KEY, attachments: [makeDraft("a")] },
      });
      result.current.dispatch({
        type: "MIGRATE_AI_SIDEBAR_TEMP_KEY",
        payload: { fromKey: TEMP_KEY, toKey: "server:8", conversationId: 8 },
      });
    });

    expect(result.current.state.aiSidebarAttachmentsByKey[TEMP_KEY]).toBeUndefined();
    expect(result.current.state.aiSidebarAttachmentsByKey["server:8"]?.[0].localId).toBe("a");

    act(() => {
      result.current.dispatch({ type: "REMOVE_AI_SIDEBAR_THREAD", payload: { key: "server:8" } });
    });
    expect(result.current.state.aiSidebarAttachmentsByKey["server:8"]).toBeUndefined();
  });

  it("将乐观消息 ID 原子替换为服务端 ID", () => {
    const { result } = renderHook(() => useChat(), { wrapper: ChatProvider });
    act(() => {
      result.current.dispatch({
        type: "ADD_AI_SIDEBAR_MSG_FOR_KEY",
        payload: {
          key: TEMP_KEY,
          message: {
            id: 10,
            conversation_id: 0,
            role: "user",
            content: "问题",
            token_count: 0,
            created_at: new Date().toISOString(),
          },
        },
      });
      result.current.dispatch({
        type: "ADD_AI_SIDEBAR_MSG_FOR_KEY",
        payload: {
          key: TEMP_KEY,
          message: {
            id: 11,
            conversation_id: 0,
            role: "assistant",
            content: "回答",
            token_count: 0,
            created_at: new Date().toISOString(),
          },
        },
      });
      result.current.dispatch({
        type: "RECONCILE_AI_SIDEBAR_MESSAGE_IDS",
        payload: {
          key: TEMP_KEY,
          optimisticUserId: 10,
          userMessageId: 99,
          optimisticAssistantId: 11,
          assistantMessageId: 100,
        },
      });
    });

    expect(result.current.state.aiSidebarMessagesByKey[TEMP_KEY]?.map((message) => message.id)).toEqual([99, 100]);
  });

  it("LOGOUT 清空所有会话附件", () => {
    const { result } = renderHook(() => useChat(), { wrapper: ChatProvider });
    act(() => {
      result.current.dispatch({
        type: "ADD_AI_SIDEBAR_ATTACHMENTS_FOR_KEY",
        payload: { key: TEMP_KEY, attachments: [makeDraft("a"), makeDraft("b")] },
      });
      result.current.dispatch({ type: "LOGOUT" });
    });
    expect(result.current.state.aiSidebarAttachmentsByKey).toEqual({});
  });
});
