import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _PROTOCOL_MARKERS } from "../../src/api/chatProtocol";

function marker(name: string): string {
  const found = _PROTOCOL_MARKERS.find(([n]) => n === name);
  if (!found) throw new Error(`unknown marker: ${name}`);
  return found[1];
}

function makeStreamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

// 把字符串切成 n 个近似等长的 chunk，模拟 TCP 分包
function sliceInto(input: string, n: number): string[] {
  const size = Math.max(1, Math.ceil(input.length / n));
  const out: string[] = [];
  for (let i = 0; i < input.length; i += size) out.push(input.slice(i, i + size));
  return out;
}

describe("chat protocol primitives", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("_findCompleteJson: 完整对象返回结束位置", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    expect(_findCompleteJson('{"a":1}', 0)).toEqual({ endIndex: 7 });
  });

  it("_findCompleteJson: 嵌套对象按外层闭合计深度", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    expect(_findCompleteJson('{"a":{"b":2}}', 0)).toEqual({ endIndex: 13 });
  });

  it("_findCompleteJson: 字符串内的花括号不计入深度", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    expect(_findCompleteJson('{"a":"}{"}', 0)).toEqual({ endIndex: 10 });
  });

  it("_findCompleteJson: 不完整 JSON 返回 null", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    expect(_findCompleteJson('{"a":1', 0)).toBeNull();
  });

  it("_findCompleteJson: 深度达 MAX_DEPTH+1（201 层未闭合）返回 null", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    // 201 个 { 未闭合：扫描到第 201 个 { 时 depth=201 > MAX_DEPTH(200)，返回 null
    expect(_findCompleteJson("{".repeat(201), 0)).toBeNull();
  });

  it("_findCompleteJson: 200 层正确闭合正常返回", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    // 200 个 { 配 200 个 }：最大 depth=200，未超上限，外层闭合即返回
    const deep = "{".repeat(200) + "}".repeat(200);
    expect(_findCompleteJson(deep, 0)).toEqual({ endIndex: deep.length });
  });

  it("_findCompleteJson: 字符串内的 { 不累加深度，深嵌套字符串不受限", async () => {
    const { _findCompleteJson } = await import("../../src/api/chatProtocol");
    // 字符串内 500 个 { 不进入深度计数，外层单层对象正常闭合
    // 整体长度 = `{"a":"`（6）+ 500 个 `{` + `"}`（2）= 508，闭合 } 后即 endIndex
    const deep = `{"a":"${"{".repeat(500)}"}`;
    expect(_findCompleteJson(deep, 0)).toEqual({ endIndex: deep.length });
  });

  it("_findNextProtocolMarker: 取最早出现的 marker", async () => {
    const { _findNextProtocolMarker } = await import("../../src/api/chatProtocol");
    const text = `abc${marker("DONE")}${marker("REASONING")}`;
    const next = _findNextProtocolMarker(text);
    expect(next?.name).toBe("DONE");
    expect(next?.index).toBe(3);
  });

  it("_findNextProtocolMarker: 无 marker 返回 null", async () => {
    const { _findNextProtocolMarker } = await import("../../src/api/chatProtocol");
    expect(_findNextProtocolMarker("纯文本无协议帧")).toBeNull();
  });

  it("_stripProtocolMarkers: 剥离完整协议帧保留纯文本", async () => {
    const { _stripProtocolMarkers } = await import("../../src/api/chatProtocol");
    const text = `前文${marker("DONE")}${JSON.stringify({ conversation_id: 1 })}后文`;
    expect(_stripProtocolMarkers(text)).toBe("前文后文");
  });

  it("_hasUnresolvedProtocolMarker: 半截帧返回 true", async () => {
    const { _hasUnresolvedProtocolMarker } = await import("../../src/api/chatProtocol");
    const half = `${marker("ROUNDDELTA")}${JSON.stringify({ round_id: 0, delta: "x" }).slice(0, 5)}`;
    expect(_hasUnresolvedProtocolMarker(half)).toBe(true);
  });

  it("_hasUnresolvedProtocolMarker: 完整帧或纯文本返回 false", async () => {
    const { _hasUnresolvedProtocolMarker } = await import("../../src/api/chatProtocol");
    const complete = `${marker("DONE")}${JSON.stringify({ conversation_id: 1 })}`;
    expect(_hasUnresolvedProtocolMarker(complete)).toBe(false);
    expect(_hasUnresolvedProtocolMarker("纯文本")).toBe(false);
  });
});

describe("sendChat streaming contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 一段含多类 marker 的完整流：两轮 delta + final 收尾 + DONE 元数据
  function buildFullStream(): string {
    return (
      marker("ROUNDDELTA") + JSON.stringify({ round_id: 0, delta: "你" }) +
      marker("ROUNDDELTA") + JSON.stringify({ round_id: 0, delta: "好" }) +
      marker("ROUNDEND") + JSON.stringify({ round_id: 0, classification: "final", text: "你好" }) +
      marker("DONE") + JSON.stringify({ conversation_id: 7, message_id: 8, user_message_id: 9 })
    );
  }

  async function runSendChat(chunks: string[]) {
    const { sendChat } = await import("../../src/api/chat");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(chunks)));
    const calls: string[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onRoundDelta: (r) => calls.push(`delta:${r.delta}`),
        onRoundEnd: (r) => calls.push(`end:${r.classification}:${r.text}`),
        onDone: (m) => calls.push(`done:${m.conversation_id}:${m.message_id}`),
      },
    });
    return calls;
  }

  it("单 chunk 完整流：按顺序触发各回调", async () => {
    const calls = await runSendChat([buildFullStream()]);
    expect(calls).toEqual(["delta:你", "delta:好", "end:final:你好", "done:7:8"]);
  });

  it("逐字符分包（极端粘包/拆包）：回调与单 chunk 一致", async () => {
    const full = buildFullStream();
    const perChar = full.split("");
    const calls = await runSendChat(perChar);
    expect(calls).toEqual(["delta:你", "delta:好", "end:final:你好", "done:7:8"]);
  });

  it("随机大小分包：回调一致（协议帧跨 chunk 仍正确拼装）", async () => {
    const full = buildFullStream();
    const expected = await runSendChat([full]);
    vi.resetModules();
    const calls = await runSendChat(sliceInto(full, 7));
    expect(calls).toEqual(expected);
  });

  it("校验失败的帧被跳过，后续好帧仍处理", async () => {
    const { sendChat } = await import("../../src/api/chat");
    const stream =
      marker("ROUNDDELTA") + JSON.stringify({ round_id: "x", delta: 1 }) +
      marker("ROUNDDELTA") + JSON.stringify({ round_id: 0, delta: "好" }) +
      marker("DONE") + JSON.stringify({ conversation_id: 1, message_id: 2 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse([stream])));
    const calls: string[] = [];
    await sendChat("hi", null, {
      callbacks: {
        onRoundDelta: (r) => calls.push(`delta:${r.delta}`),
        onDone: () => calls.push("done"),
      },
    });
    expect(calls).toEqual(["delta:好", "done"]);
  });

  it("非 2xx 响应：抛出后端 detail（readErrorDetail 透传）", async () => {
    const { sendChat } = await import("../../src/api/chat");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"detail":"内容过长"}', { status: 400 })),
    );
    await expect(
      sendChat("hi", null, { callbacks: {} }),
    ).rejects.toThrow("内容过长");
  });
});
