import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ChatProvider, useChat } from "../../src/stores/chatStore";

// 捕获 sendChat 调用时的回调；resolve 推迟到测试驱动 onDone
let lastStreamCallbacks: {
  onChunk: (c: string) => void;
  onDone: (m: { conversation_id: number; message_id: number }) => void;
  resolve: () => void;
} | null = null;

vi.mock("../../src/api/client", () => ({
  sendChat: vi.fn(
    (
      _content: string,
      _conversationId: number | null,
      _imageUrl: string | undefined,
      _fileUrl: string | undefined,
      onChunk: (c: string) => void,
      onDone: (m: { conversation_id: number; message_id: number }) => void,
    ) =>
      new Promise<void>((resolve) => {
        lastStreamCallbacks = { onChunk, onDone, resolve: () => resolve() };
      }),
  ),
  fetchConversations: vi.fn(async () => ({ conversations: [] })),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchMessages: vi.fn(async () => ({ messages: [] })),
}));

import { useChatHooks } from "../../src/hooks/useChat";

beforeEach(() => {
  lastStreamCallbacks = null;
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

describe("useChatHooks.sendMessage SSE 行为", () => {
  it("发送消息后插入用户消息 + 占位助手消息，并标记 streaming", async () => {
    const { result } = renderChatHook();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.hook.sendMessage("hello");
    });
    await waitFor(() => {
      expect(result.current.state.messages.length).toBe(2);
      expect(result.current.state.isStreaming).toBe(true);
    });
    const msgs = result.current.state.messages;
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("");

    await act(async () => {
      lastStreamCallbacks?.onDone({ conversation_id: 1, message_id: 100 });
      lastStreamCallbacks?.resolve();
      await pending;
    });
  });

  it("流式 chunk 累积更新助手消息内容", async () => {
    const { result } = renderChatHook();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.hook.sendMessage("ping");
    });
    await waitFor(() => expect(result.current.state.messages.length).toBe(2));
    const assistantId = result.current.state.messages[1].id;

    act(() => lastStreamCallbacks?.onChunk("Hello"));
    act(() => lastStreamCallbacks?.onChunk(" world"));
    await waitFor(() => {
      const m = result.current.state.messages.find((x) => x.id === assistantId);
      expect(m?.content).toBe("Hello world");
    });

    await act(async () => {
      lastStreamCallbacks?.onDone({ conversation_id: 1, message_id: 100 });
      lastStreamCallbacks?.resolve();
      await pending;
    });
  });

  it("onDone 设置 conversation id 并结束 streaming", async () => {
    const { result } = renderChatHook();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.hook.sendMessage("q");
    });
    await waitFor(() => expect(result.current.state.isStreaming).toBe(true));

    await act(async () => {
      lastStreamCallbacks?.onDone({ conversation_id: 42, message_id: 100 });
      lastStreamCallbacks?.resolve();
      await pending;
    });
    await waitFor(() => {
      expect(result.current.state.currentConversationId).toBe(42);
      expect(result.current.state.isStreaming).toBe(false);
    });
  });
});
