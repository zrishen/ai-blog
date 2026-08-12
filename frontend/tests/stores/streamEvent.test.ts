import { describe, expect, it } from "vitest";

import { applyStreamEvent } from "../../src/stores/slices/streamEvent";

import type { Message } from "../../src/types/chat";

const base: Message = {
  id: 1,
  conversation_id: 1,
  role: "assistant",
  content: "",
  token_count: 0,
  created_at: "",
};

describe("applyStreamEvent", () => {
  it("delta 追加到 streamingRound", () => {
    const m = applyStreamEvent({ ...base, streamingRound: "ab" }, { type: "delta", delta: "c" });
    expect(m.streamingRound).toBe("abc");
  });

  it("loop 清空 streamingRound 并追加 loopStep", () => {
    const m = applyStreamEvent(
      { ...base, streamingRound: "x", loopSteps: ["a"] },
      { type: "loop", content: "b" },
    );
    expect(m.streamingRound).toBe("");
    expect(m.loopSteps).toEqual(["a", "b"]);
  });

  it("final 写入 content、标记完成、清空错误", () => {
    const m = applyStreamEvent(
      { ...base, streamingRound: "x", streamError: "e" },
      { type: "final", content: "done" },
    );
    expect(m.content).toBe("done");
    expect(m.streamingRound).toBe("");
    expect(m.streamFinalized).toBe(true);
    expect(m.streamError).toBeUndefined();
  });

  it("discard 清空 streamingRound", () => {
    const m = applyStreamEvent({ ...base, streamingRound: "x" }, { type: "discard" });
    expect(m.streamingRound).toBe("");
  });

  it("error 记录 streamError", () => {
    const m = applyStreamEvent({ ...base, streamingRound: "x" }, { type: "error", message: "坏了" });
    expect(m.streamingRound).toBe("");
    expect(m.streamError).toBe("坏了");
  });
});
