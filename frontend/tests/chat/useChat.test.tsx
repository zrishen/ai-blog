import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ChatProvider, useChat } from "../../src/stores/chatStore";

type RoundDelta = { round_id: number; delta: string };
type RoundEnd = {
  round_id: number;
  classification: "loop" | "final" | "discard";
  text: string;
  loop_step_index?: number | null;
};
type DoneMeta = { conversation_id: number; message_id: number };
type StreamErrorPayload = { message: string; round_id?: number };

let lastStreamCallbacks: {
  onRoundDelta: (r: RoundDelta) => void;
  onRoundEnd: (r: RoundEnd) => void;
  onDone: (m: DoneMeta) => void;
  onStreamError?: (e: StreamErrorPayload) => void;
  resolve: () => void;
} | null = null;

vi.mock("../../src/api/client", () => ({
  sendChat: vi.fn(
    (
      _content: string,
      _conversationId: number | null,
      options: {
        callbacks: {
          onRoundDelta?: (r: RoundDelta) => void;
          onRoundEnd?: (r: RoundEnd) => void;
          onDone?: (m: DoneMeta) => void;
          onStreamError?: (e: StreamErrorPayload) => void;
        };
      },
    ) =>
      new Promise<void>((resolve) => {
        lastStreamCallbacks = {
          onRoundDelta: options.callbacks.onRoundDelta!,
          onRoundEnd: options.callbacks.onRoundEnd!,
          onDone: options.callbacks.onDone!,
          onStreamError: options.callbacks.onStreamError,
          resolve: () => resolve(),
        };
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
      lastStreamCallbacks?.onRoundEnd({ round_id: 1, classification: "final", text: "hello" });
      lastStreamCallbacks?.onDone({ conversation_id: 1, message_id: 100 });
      lastStreamCallbacks?.resolve();
      await pending;
    });
  });

  it("ROUNDDELTA 累积到临时轮，ROUNDEND(final) 原子迁移为正文", async () => {
    const { result } = renderChatHook();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.hook.sendMessage("ping");
    });
    await waitFor(() => expect(result.current.state.messages.length).toBe(2));
    const assistantId = result.current.state.messages[1].id;

    act(() => lastStreamCallbacks?.onRoundDelta({ round_id: 1, delta: "Hello" }));
    act(() => lastStreamCallbacks?.onRoundDelta({ round_id: 1, delta: " world" }));

    await waitFor(() => {
      const m = result.current.state.messages.find((x) => x.id === assistantId);
      expect(m?.streamingRound).toBe("Hello world");
      expect(m?.content).toBe("");
    });

    act(() =>
      lastStreamCallbacks?.onRoundEnd({ round_id: 1, classification: "final", text: "Hello world" }),
    );
    await waitFor(() => {
      const m = result.current.state.messages.find((x) => x.id === assistantId);
      expect(m?.content).toBe("Hello world");
      expect(m?.streamingRound).toBe("");
      expect(m?.streamFinalized).toBe(true);
    });

    await act(async () => {
      lastStreamCallbacks?.onDone({ conversation_id: 1, message_id: 100 });
      lastStreamCallbacks?.resolve();
      await pending;
    });
  });

  it("ROUNDEND(loop) 固化为 loop step，不写入正文", async () => {
    const { result } = renderChatHook();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.hook.sendMessage("q");
    });
    await waitFor(() => expect(result.current.state.messages.length).toBe(2));
    const assistantId = result.current.state.messages[1].id;

    act(() => lastStreamCallbacks?.onRoundDelta({ round_id: 1, delta: "调用工具" }));
    act(() =>
      lastStreamCallbacks?.onRoundEnd({ round_id: 1, classification: "loop", text: "调用工具", loop_step_index: 0 }),
    );

    await waitFor(() => {
      const m = result.current.state.messages.find((x) => x.id === assistantId);
      expect(m?.loopSteps).toEqual(["调用工具"]);
      expect(m?.streamingRound).toBe("");
      expect(m?.content).toBe("");
    });

    await act(async () => {
      lastStreamCallbacks?.onRoundEnd({ round_id: 2, classification: "final", text: "完成" });
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
      lastStreamCallbacks?.onRoundEnd({ round_id: 1, classification: "final", text: "ok" });
      lastStreamCallbacks?.onDone({ conversation_id: 42, message_id: 100 });
      lastStreamCallbacks?.resolve();
      await pending;
    });
    await waitFor(() => {
      expect(result.current.state.currentConversationId).toBe(42);
      expect(result.current.state.isStreaming).toBe(false);
    });
  });

  it("STREAMERROR 写入错误状态且不提升为 final", async () => {
    const { result } = renderChatHook();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.hook.sendMessage("boom");
    });
    await waitFor(() => expect(result.current.state.messages.length).toBe(2));
    const assistantId = result.current.state.messages[1].id;

    await act(async () => {
      lastStreamCallbacks?.onRoundDelta({ round_id: 1, delta: "半轮" });
      lastStreamCallbacks?.onStreamError?.({ message: "服务异常" });
    });

    await waitFor(() => {
      const m = result.current.state.messages.find((x) => x.id === assistantId);
      expect(m?.streamError).toBe("服务异常");
      expect(m?.content).toBe("");
      expect(m?.streamFinalized).toBeUndefined();
    });

    await act(async () => {
      lastStreamCallbacks?.resolve();
      await pending;
    });
  });
});
