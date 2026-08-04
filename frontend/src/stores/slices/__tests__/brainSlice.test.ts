import { describe, expect, it } from "vitest";
import type { ChatAction, ChatState } from "../../chatStore";
import type { BrainStats } from "../../../api/client";
import { brainReducer } from "../brainSlice";

// brainReducer 只读写 brainTab/brainStats，构造只含这两个字段的局部 state 足以覆盖
function makeState(
  overrides: Partial<Pick<ChatState, "brainTab" | "brainStats">>,
): ChatState {
  return { brainTab: "graph", brainStats: null, ...overrides } as unknown as ChatState;
}

const stats: BrainStats = {
  enabled: true,
  entities: 5,
  facts: 10,
  episodes: 3,
  preferences: 2,
  chunks: 0,
  documents: 0,
};

describe("brainReducer", () => {
  it("SET_BRAIN_TAB 切换左栏视图", () => {
    const next = brainReducer(makeState({ brainTab: "graph" }), {
      type: "SET_BRAIN_TAB",
      payload: "entities",
    });
    expect(next.brainTab).toBe("entities");
  });

  it("SET_BRAIN_STATS 整体替换概览统计", () => {
    const next = brainReducer(makeState({ brainStats: null }), {
      type: "SET_BRAIN_STATS",
      payload: stats,
    });
    expect(next.brainStats).toEqual(stats);
  });

  it("DECREMENT_BRAIN_STATS 默认减 1，到 0 不为负", () => {
    const one = brainReducer(makeState({ brainStats: { ...stats, facts: 1 } }), {
      type: "DECREMENT_BRAIN_STATS",
      payload: { field: "facts" },
    });
    expect(one.brainStats?.facts).toBe(0);
    const floor = brainReducer(one, {
      type: "DECREMENT_BRAIN_STATS",
      payload: { field: "facts" },
    });
    expect(floor.brainStats?.facts).toBe(0);
  });

  it("DECREMENT_BRAIN_STATS 支持 by 自定义步长", () => {
    const next = brainReducer(makeState({ brainStats: stats }), {
      type: "DECREMENT_BRAIN_STATS",
      payload: { field: "entities", by: 3 },
    });
    expect(next.brainStats?.entities).toBe(2);
  });

  it("DECREMENT_BRAIN_STATS 在 brainStats 为 null 时原样返回", () => {
    const state = makeState({ brainStats: null });
    const next = brainReducer(state, {
      type: "DECREMENT_BRAIN_STATS",
      payload: { field: "entities" },
    });
    expect(next).toBe(state);
  });

  it("无关 action 透传同一引用", () => {
    const state = makeState({ brainTab: "episodes" });
    const next = brainReducer(state, { type: "SET_PAGE", payload: "brain" } as ChatAction);
    expect(next).toBe(state);
  });
});
