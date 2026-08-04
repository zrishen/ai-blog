import type { ChatState, ChatAction } from "../chatStore";

// AI 大脑领域 slice：左栏视图切换 + 概览统计。
// 视图/统计跨 LeftSidebar↔BrainPage 兄弟组件共享，故进 store（同 research/workspace 范式）。
export function brainReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_BRAIN_TAB":
      return { ...state, brainTab: action.payload };
    case "SET_BRAIN_STATS":
      return { ...state, brainStats: action.payload };
    case "DECREMENT_BRAIN_STATS": {
      // 删除记忆后概览减量；放 reducer 避免 BrainPage 闭包拿旧值算增量
      if (!state.brainStats) return state;
      const { field, by = 1 } = action.payload;
      return {
        ...state,
        brainStats: { ...state.brainStats, [field]: Math.max(0, state.brainStats[field] - by) },
      };
    }
    default:
      return state;
  }
}
