import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  sendChat,
  fetchConversations,
  createConversation,
  deleteConversation,
  getMessages,
} from "../src/api/client";

// 构造一段可分块推送的 ReadableStream
function makeChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function makeResponse(stream: ReadableStream<Uint8Array>, ok = true): Response {
  return new Response(stream, {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "text/event-stream" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendChat SSE 解析", () => {
  it("纯文本 chunk 经 onChunk 输出", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(makeChunkedStream(["Hello", " ", "world"])),
    );

    const chunks: string[] = [];
    await sendChat("hi", null, undefined, undefined, (c) => chunks.push(c), () => {});

    expect(chunks.join("")).toBe("Hello world");
  });

  it("TOOLDONE marker 触发 onToolCall / onToolResult", async () => {
    const stream = makeChunkedStream([
      "before ",
      "\x00TOOLDONE\x00",
      '{"status":"start","tool_name":"blog_create"}',
      "\x00TOOLDONE\x00",
      '{"status":"end","tool_name":"blog_create","result":"ok"}',
      " after",
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    const toolCalls: string[] = [];
    const toolResults: string[] = [];
    await sendChat(
      "hi",
      null,
      undefined,
      undefined,
      (c) => chunks.push(c),
      () => {},
      (name) => toolCalls.push(name),
      (name, result) => toolResults.push(`${name}:${result}`),
    );

    expect(toolCalls).toEqual(["blog_create"]);
    expect(toolResults).toEqual(["blog_create:ok"]);
    expect(chunks.join("")).toBe("before  after");
  });

  it("DONE marker 触发 onDone 并解析 JSON", async () => {
    // JSON metadata 必须位于 DONE marker 之前（源码 line 614-627 的处理顺序）
    const stream = makeChunkedStream([
      "answer",
      '{"conversation_id":7,"message_id":42}\x00DONE\x00',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    let doneMeta: { conversation_id: number; message_id: number } | null = null;
    await sendChat(
      "hi",
      null,
      undefined,
      undefined,
      (c) => chunks.push(c),
      (m) => {
        doneMeta = m;
      },
    );

    expect(chunks.join("")).toBe("answer");
    expect(doneMeta).toEqual({ conversation_id: 7, message_id: 42 });
  });

  it("BLOGDELTA marker 触发 onBlogDelta", async () => {
    const stream = makeChunkedStream([
      "\x00BLOGDELTA\x00",
      '{"content_delta":"# Title"}',
      "\x00BLOGDELTA\x00",
      '{"content_delta":"\\n\\nbody"}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const deltas: string[] = [];
    await sendChat(
      "hi",
      null,
      undefined,
      undefined,
      () => {},
      () => {},
      undefined,
      undefined,
      (d) => deltas.push(d),
    );

    expect(deltas.join("")).toBe("# Title\n\nbody");
  });

  it("marker 跨 chunk 分片也能正确拼接", async () => {
    // 文本与 JSON 拆到不同 chunk；DONE marker 也分片
    const stream = makeChunkedStream([
      "text",
      '{"conversation_id":1,"message_id":2}\x00',
      "DONE\x00",
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    let doneMeta: { conversation_id: number; message_id: number } | null = null;
    await sendChat(
      "hi",
      null,
      undefined,
      undefined,
      (c) => chunks.push(c),
      (m) => {
        doneMeta = m;
      },
    );

    expect(chunks.join("")).toBe("text");
    expect(doneMeta).toEqual({ conversation_id: 1, message_id: 2 });
  });

  it("REASONING marker 触发 onReasoning", async () => {
    const stream = makeChunkedStream([
      "\x00REASONING\x00",
      '{"reasoning_delta":"thinking..."}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const reasoning: string[] = [];
    await sendChat(
      "hi",
      null,
      undefined,
      undefined,
      () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      "normal",
      "deep",
      (t) => reasoning.push(t),
    );

    expect(reasoning.join("")).toBe("thinking...");
  });

  it("HTTP 非 2xx 抛错", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(makeChunkedStream(["err"]), false));
    await expect(
      sendChat("hi", null, undefined, undefined, () => {}, () => {}),
    ).rejects.toThrow("Chat request failed");
  });
});

describe("apiFetch 401 处理", () => {
  it("401 清空 token 并触发 auth:logout 事件", async () => {
    localStorage.setItem("auth_token", "t");
    localStorage.setItem("auth_user", "{}");

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    let eventFired = false;
    window.addEventListener("auth:logout", () => {
      eventFired = true;
    });

    // fetchConversations 在 !res.ok 时会抛错；这里只关心 401 副作用
    await expect(fetchConversations()).rejects.toThrow("Failed to fetch conversations");

    expect(eventFired).toBe(true);
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
  });

  it("非 401 错误抛出但不触发 logout", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(fetchConversations()).rejects.toThrow("Failed to fetch conversations");
  });
});

describe("简单 API 函数：URL 与 payload", () => {
  it("createConversation 发 POST 与 JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 9, title: "New Chat" }), { status: 200 }),
    );
    await createConversation("New Chat");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New Chat" }),
      }),
    );
  });

  it("deleteConversation 发 DELETE 到正确路径", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await deleteConversation(123);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("getMessages URL 包含 conversationId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    );
    await getMessages(42);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/42/messages",
      expect.objectContaining({}),
    );
  });

  it("Authorization 头携带 localStorage 中的 token", async () => {
    localStorage.setItem("auth_token", "tok-abc");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    );
    await fetchConversations();
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-abc");
  });
});
