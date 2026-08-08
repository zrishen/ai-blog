import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setAccessToken, getAccessToken } from "../../src/api/client";
import { sendChat, type StreamToolMeta, type StreamRoundEnd } from "../../src/api/chat";
import { fetchConversations, createConversation, deleteConversation, getMessages } from "../../src/api/conversations";

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
  it("纯文本 chunk 经 onChunk 输出（无 round/error 回调时启用裸文本通道）", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(makeChunkedStream(["Hello", " ", "world"])),
    );

    const chunks: string[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
      },
    });

    expect(chunks.join("")).toBe("Hello world");
  });

  it("TOOLDONE marker 触发 onToolCall / onToolResult 并透传 call_id meta", async () => {
    const stream = makeChunkedStream([
      "before ",
      "\x00TOOLDONE\x00",
      '{"status":"start","tool_name":"blog_create","call_id":"call-x","round_id":1,"loop_step_index":0}',
      "\x00TOOLDONE\x00",
      '{"status":"end","tool_name":"blog_create","result":"ok","call_id":"call-x"}',
      " after",
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    const toolCalls: { name: string; meta?: StreamToolMeta }[] = [];
    const toolResults: { name: string; result: string; meta?: StreamToolMeta }[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onToolCall: (name, meta) => toolCalls.push({ name, meta }),
        onToolResult: (name, result, _blogMeta, _refs, meta) =>
          toolResults.push({ name, result, meta }),
      },
    });

    expect(toolCalls).toEqual([
      { name: "blog_create", meta: { call_id: "call-x", round_id: 1, loop_step_index: 0 } },
    ]);
    expect(toolResults).toEqual([
      { name: "blog_create", result: "ok", meta: { call_id: "call-x", round_id: undefined, loop_step_index: undefined } },
    ]);
    expect(chunks.join("")).toBe("before  after");
  });

  it("DONE marker 触发 onDone 并解析 JSON", async () => {
    const stream = makeChunkedStream([
      "answer",
      '{"conversation_id":7,"message_id":42}\x00DONE\x00',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    let doneMeta: { conversation_id: number; message_id: number } | null = null;
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: (m) => {
          doneMeta = m;
        },
      },
    });

    expect(chunks.join("")).toBe("answer");
    expect(doneMeta).toEqual({ conversation_id: 7, message_id: 42 });
  });

  it("DONE marker 与 JSON 分片时等待完整元数据", async () => {
    const stream = makeChunkedStream([
      "answer\x00DONE\x00",
      '{"conversation_id":7,"message_id":42,',
      '"user_message_id":41,"attachments":[]}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    let doneMeta: { conversation_id: number; message_id: number; user_message_id?: number } | null = null;
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: (m) => { doneMeta = m; },
      },
    });

    expect(chunks.join("")).toBe("answer");
    expect(doneMeta).toMatchObject({ conversation_id: 7, message_id: 42, user_message_id: 41 });
  });

  it("BLOGSTART/BLOGDELTA marker 透传文章与流归属", async () => {
    const stream = makeChunkedStream([
      "\x00BLOGSTART\x00",
      '{"post_id":42,"stream_id":"1:0"}',
      "\x00BLOGDELTA\x00",
      '{"post_id":42,"stream_id":"1:0","content_delta":"# Title"}',
      "\x00BLOGDELTA\x00",
      '{"post_id":42,"stream_id":"1:0","content_delta":"\\n\\nbody"}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const starts: Array<{ post_id: number; stream_id: string }> = [];
    const deltas: Array<{ post_id: number; stream_id: string; content_delta: string }> = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onBlogStart: (event) => starts.push(event),
        onBlogDelta: (event) => deltas.push(event),
      },
    });

    expect(starts).toEqual([{ post_id: 42, stream_id: "1:0" }]);
    expect(deltas.map((event) => event.content_delta).join("")).toBe("# Title\n\nbody");
    expect(deltas.every((event) => event.post_id === 42 && event.stream_id === "1:0")).toBe(true);
  });

  it("TOOLPREP 提前触发 onToolPrep，TOOLDONE 透传 stream_id 到 onToolCall/onToolResult meta", async () => {
    const stream = makeChunkedStream([
      "\x00TOOLPREP\x00",
      '{"tool_name":"blog_write_post","stream_id":"1:0"}',
      "\x00TOOLDONE\x00",
      '{"status":"start","tool_name":"blog_write_post","call_id":"call-1","stream_id":"1:0"}',
      "\x00TOOLDONE\x00",
      '{"status":"end","tool_name":"blog_write_post","result":"ok","call_id":"call-1","stream_id":"1:0"}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    const preps: Array<{ tool_name: string; stream_id: string }> = [];
    const toolCalls: { name: string; meta?: StreamToolMeta }[] = [];
    const toolResults: { name: string; result: string; meta?: StreamToolMeta }[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onToolPrep: (event) => preps.push(event),
        onToolCall: (name, meta) => toolCalls.push({ name, meta }),
        onToolResult: (name, result, _blogMeta, _refs, meta) =>
          toolResults.push({ name, result, meta }),
      },
    });

    expect(preps).toEqual([{ tool_name: "blog_write_post", stream_id: "1:0" }]);
    expect(toolCalls).toEqual([
      { name: "blog_write_post", meta: { call_id: "call-1", round_id: undefined, loop_step_index: undefined, stream_id: "1:0" } },
    ]);
    expect(toolResults).toEqual([
      { name: "blog_write_post", result: "ok", meta: { call_id: "call-1", round_id: undefined, loop_step_index: undefined, stream_id: "1:0" } },
    ]);
    expect(chunks.join("")).toBe("");
  });

  it("PATCHSTART/PATCHDELTA marker 驱动归属明确的补丁预览且不泄漏正文", async () => {
    const stream = makeChunkedStream([
      "\x00PATCHSTART\x00",
      '{"post_id":42,"stream_id":"1:0","target_text":"旧文本"}',
      "\x00PATCHDELTA\x00",
      '{"post_id":42,"stream_id":"1:0","replacement_delta":"新"}',
      "\x00PATCHDELTA\x00",
      '{"post_id":42,"stream_id":"1:0","replacement_delta":"文本"}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    const patchStarts: Array<{ post_id: number; stream_id: string; target_text: string }> = [];
    const patchDeltas: Array<{ post_id: number; stream_id: string; replacement_delta: string }> = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onPatchStart: (event) => patchStarts.push(event),
        onPatchDelta: (event) => patchDeltas.push(event),
      },
    });

    expect(patchStarts).toEqual([{ post_id: 42, stream_id: "1:0", target_text: "旧文本" }]);
    expect(patchDeltas.map((event) => event.replacement_delta).join("")).toBe("新文本");
    expect(patchDeltas.every((event) => event.post_id === 42 && event.stream_id === "1:0")).toBe(true);
    expect(chunks.join("")).toBe("");
  });

  it("marker 跨 chunk 分片也能正确拼接", async () => {
    const stream = makeChunkedStream([
      "text",
      '{"conversation_id":1,"message_id":2}\x00',
      "DONE\x00",
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    let doneMeta: { conversation_id: number; message_id: number } | null = null;
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: (m) => {
          doneMeta = m;
        },
      },
    });

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
    await sendChat("hi", null, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onReasoning: (t) => reasoning.push(t),
      },
    });

    expect(reasoning.join("")).toBe("thinking...");
  });

  it("ROUNDDELTA + ROUNDEND(final) 经 onRoundDelta/onRoundEnd 流式，不泄漏到 onChunk", async () => {
    const stream = makeChunkedStream([
      '\x00ROUNDDELTA\x00{"round_id":1,"delta":"最终"}',
      '\x00ROUNDDELTA\x00{"round_id":1,"delta":"答案"}',
      '\x00ROUNDEND\x00{"round_id":1,"classification":"final","text":"最终答案","loop_step_index":null}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    const roundDeltas: { id: number; delta: string }[] = [];
    let roundEnd: StreamRoundEnd | null = null;
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onRoundDelta: (r) => roundDeltas.push({ id: r.round_id, delta: r.delta }),
        onRoundEnd: (r) => {
          roundEnd = r;
        },
      },
    });

    expect(roundDeltas).toEqual([
      { id: 1, delta: "最终" },
      { id: 1, delta: "答案" },
    ]);
    expect(roundEnd).toEqual({
      round_id: 1,
      classification: "final",
      text: "最终答案",
      loop_step_index: null,
    });
    expect(chunks.join("")).toBe("");
  });

  it("ROUNDEND(loop/final/discard) 跨 chunk 解析且不泄漏到正文", async () => {
    const stream = makeChunkedStream([
      '\x00ROUND',
      'DELTA\x00{"round_id":1,"delta":"先检索"}',
      '\x00ROUND',
      'END\x00{"round_id":1,"classification":"loop","text":"先检索","loop_step_index":0}',
      '\n\n\x00TOOLDONE\x00{"status":"start","tool_name":"blog_edit_post","call_id":"call-a","round_id":1,"loop_step_index":0}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    const roundDeltas: string[] = [];
    const roundEnds: { classification: string; text: string; loop_step_index?: number | null }[] = [];
    const tools: string[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onToolCall: (name) => tools.push(name),
        onRoundDelta: (r) => roundDeltas.push(r.delta),
        onRoundEnd: (r) => roundEnds.push({
          classification: r.classification,
          text: r.text,
          loop_step_index: r.loop_step_index,
        }),
      },
    });

    expect(roundDeltas).toEqual(["先检索"]);
    expect(roundEnds).toEqual([
      { classification: "loop", text: "先检索", loop_step_index: 0 },
    ]);
    expect(tools).toEqual(["blog_edit_post"]);
    expect(chunks.join("").trim()).toBe("");
  });

  it("STREAMERROR 经 onStreamError，不作为 final 泄漏", async () => {
    const stream = makeChunkedStream([
      '\x00ROUNDDELTA\x00{"round_id":1,"delta":"未完成"}',
      '\x00ROUNDEND\x00{"round_id":1,"classification":"discard","text":"","loop_step_index":null}',
      '\x00STREAMERROR\x00{"message":"服务异常","round_id":1}',
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    const chunks: string[] = [];
    let streamError: { message: string; round_id?: number } | null = null;
    const roundEnds: { classification: string }[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onRoundEnd: (r) => roundEnds.push({ classification: r.classification }),
        onStreamError: (e) => {
          streamError = e;
        },
      },
    });

    expect(roundEnds).toEqual([{ classification: "discard" }]);
    expect(streamError).toEqual({ message: "服务异常", round_id: 1 });
    expect(chunks.join("")).toBe("");
  });

  it("工具结束回调的异步工作不阻塞后续正文", async () => {
    const stream = makeChunkedStream([
      '\x00TOOLDONE\x00{"status":"end","tool_name":"blog_edit_post","result":"完成"}',
      "最终回复",
    ]);
    fetchMock.mockResolvedValueOnce(makeResponse(stream));

    let releaseRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const chunks: string[] = [];
    const chatPromise = sendChat("hi", null, {
      callbacks: {
        onChunk: (c) => chunks.push(c),
        onDone: () => {},
        onToolResult: () => refreshPromise,
      },
    });

    const outcome = await Promise.race([
      chatPromise.then(() => "complete"),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 50)),
    ]);
    releaseRefresh();
    await chatPromise;

    expect(outcome).toBe("complete");
    expect(chunks.join("")).toBe("最终回复");
  });

  it("HTTP 非 2xx 抛错", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(makeChunkedStream(["err"]), false));
    await expect(
      sendChat("hi", null, {
        callbacks: {
          onChunk: () => {},
          onDone: () => {},
        },
      }),
    ).rejects.toThrow("Chat request failed");
  });
});

describe("apiFetch 401 处理", () => {
  it("401 且 refresh 也失败时清空 access holder 并触发 auth:logout 事件", async () => {
    setAccessToken("t");
    // 第一次：原请求 401；第二次：/auth/refresh 也 401 → 触发登出
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    let eventFired = false;
    window.addEventListener("auth:logout", () => {
      eventFired = true;
    });

    await expect(fetchConversations()).rejects.toThrow("Failed to fetch conversations");

    expect(eventFired).toBe(true);
    expect(getAccessToken()).toBeNull();
  });

  it("401 后 refresh 成功则更新 access holder 并重试原请求", async () => {
    setAccessToken("old");
    // 原请求 401 → refresh 200 → 原请求重试 200
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "new", user: { id: 1, username: "a" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    );

    await expect(fetchConversations()).resolves.toEqual({ conversations: [] });
    expect(getAccessToken()).toBe("new");
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
      "/api/v1/conversations",
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
      "/api/v1/conversations/123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("getMessages URL 包含 conversationId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    );
    await getMessages(42);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/conversations/42/messages",
      expect.objectContaining({}),
    );
  });

  it("Authorization 头携带内存中的 access token", async () => {
    setAccessToken("tok-abc");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    );
    await fetchConversations();
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-abc");
  });
});
