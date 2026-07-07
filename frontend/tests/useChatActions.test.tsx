import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ChatProvider, useChat } from "../src/stores/chatStore";

// 让 mock 暴露可控的 fetch 结果
let conversationsResult: { conversations: any[] } = { conversations: [] };
let messagesResult: any[] = [];
let createdConversation: any = null;

vi.mock("../src/api/client", () => ({
  fetchConversations: vi.fn(async () => conversationsResult),
  createConversation: vi.fn(async () => createdConversation),
  deleteConversation: vi.fn(async () => {}),
  getMessages: vi.fn(async () => messagesResult),
  sendChat: vi.fn(),
}));

import { useChatHooks } from "../src/hooks/useChat";

beforeEach(() => {
  conversationsResult = { conversations: [] };
  messagesResult = [];
  createdConversation = { id: 100, title: "New Chat", created_at: "", updated_at: "" };
  vi.clearAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>{children}</ChatProvider>
);

function renderChatHook() {
  return renderHook(
    () => {
      const hook = useChatHooks();
      const { state } = useChat();
      return { hook, state };
    },
    { wrapper },
  );
}

describe("useChatHooks 其他动作", () => {
  it("loadConversations 写入 state.conversations 并切换 isLoading", async () => {
    conversationsResult = {
      conversations: [
        { id: 1, title: "A", created_at: "", updated_at: "" },
        { id: 2, title: "B", created_at: "", updated_at: "" },
      ],
    };
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.hook.loadConversations();
    });

    expect(result.current.state.conversations.length).toBe(2);
    expect(result.current.state.conversations[0].title).toBe("A");
    expect(result.current.state.isLoading).toBe(false);
  });

  it("loadConversations 失败时不抛错，仅切回 isLoading=false", async () => {
    const { fetchConversations } = await import("../src/api/client");
    (fetchConversations as any).mockRejectedValueOnce(new Error("net"));
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.hook.loadConversations();
    });

    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.conversations).toEqual([]);
  });

  it("createNewChat 调用 API 并把新会话插到列表顶部", async () => {
    const { result } = renderChatHook();
    // 先放一个已有会话
    await act(async () => {
      await result.current.hook.loadConversations();
    });
    conversationsResult = {
      conversations: [{ id: 5, title: "old", created_at: "", updated_at: "" }],
    };
    await act(async () => {
      await result.current.hook.loadConversations();
    });
    expect(result.current.state.conversations.length).toBe(1);

    createdConversation = { id: 200, title: "New Chat", created_at: "", updated_at: "" };
    let newId: number | undefined;
    await act(async () => {
      newId = await result.current.hook.createNewChat();
    });

    expect(newId).toBe(200);
    expect(result.current.state.currentConversationId).toBe(200);
    expect(result.current.state.conversations[0].id).toBe(200);
    expect(result.current.state.messages).toEqual([]);
  });

  it("removeConversation 删除当前会话后清空 currentConversationId 与 messages", async () => {
    const { result } = renderChatHook();
    conversationsResult = {
      conversations: [
        { id: 1, title: "A", created_at: "", updated_at: "" },
        { id: 2, title: "B", created_at: "", updated_at: "" },
      ],
    };
    await act(async () => {
      await result.current.hook.loadConversations();
    });

    act(() => {
      result.current.hook.selectConversation(1);
    });
    await waitFor(() => {
      expect(result.current.state.currentConversationId).toBe(1);
    });

    await act(async () => {
      await result.current.hook.removeConversation(1);
    });

    expect(result.current.state.conversations.length).toBe(1);
    expect(result.current.state.conversations[0].id).toBe(2);
    expect(result.current.state.currentConversationId).toBeNull();
    expect(result.current.state.messages).toEqual([]);
  });

  it("removeConversation 删除非当前会话不影响 currentConversationId", async () => {
    const { result } = renderChatHook();
    conversationsResult = {
      conversations: [
        { id: 1, title: "A", created_at: "", updated_at: "" },
        { id: 2, title: "B", created_at: "", updated_at: "" },
      ],
    };
    await act(async () => {
      await result.current.hook.loadConversations();
    });
    act(() => {
      result.current.hook.selectConversation(1);
    });
    await waitFor(() => {
      expect(result.current.state.currentConversationId).toBe(1);
    });

    await act(async () => {
      await result.current.hook.removeConversation(2);
    });

    expect(result.current.state.conversations.length).toBe(1);
    expect(result.current.state.conversations[0].id).toBe(1);
    expect(result.current.state.currentConversationId).toBe(1);
  });

  it("loadMessages 把后端返回写入 state.messages", async () => {
    messagesResult = [
      { id: 10, role: "user", content: "hi", conversation_id: 5, token_count: 0, created_at: "" },
      { id: 11, role: "assistant", content: "yo", conversation_id: 5, token_count: 0, created_at: "" },
    ];
    const { result } = renderChatHook();

    await act(async () => {
      await result.current.hook.loadMessages(5);
    });

    expect(result.current.state.messages.length).toBe(2);
    expect(result.current.state.messages[0].content).toBe("hi");
    expect(result.current.state.messages[1].content).toBe("yo");
  });
});
