import { useCallback, useEffect } from "react";

import { useChat } from "../../../stores/chatStore";
import {
  DEFAULT_AI_SIDEBAR_THINKING_MODE,
  loadAISidebarThinkingMode,
  saveAISidebarThinkingMode,
} from "../ai-sidebar/constants";

import type { ThinkingMode } from "@/types/chat";

// thinking mode 子领域：挂载时按用户恢复持久化值，切换时落盘 + 同步 store。
// 从 AISidebar 抽出，行为不变。
export function useAISidebarThinkingMode(userId: number | undefined) {
  const { dispatch } = useChat();

  useEffect(() => {
    dispatch({
      type: "SET_AI_SIDEBAR_THINKING_MODE",
      payload: userId
        ? loadAISidebarThinkingMode(userId)
        : DEFAULT_AI_SIDEBAR_THINKING_MODE,
    });
  }, [dispatch, userId]);

  const handleThinkingModeChange = useCallback((mode: ThinkingMode) => {
    dispatch({ type: "SET_AI_SIDEBAR_THINKING_MODE", payload: mode });
    if (userId) saveAISidebarThinkingMode(userId, mode);
  }, [dispatch, userId]);

  return handleThinkingModeChange;
}
