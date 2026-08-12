import { useCallback, useEffect, useRef, useState } from "react";

import type { AISidebarConversationKey } from "../../../stores/chatStore";

// 滚动子领域：消息列表 viewport 贴底判定 + 滚到底部（含 rAF 双帧等渲染）。
// selectedKeyRef 内聚于此，handleSend/handleSelectConversation 经返回的
// scrollToLatestAfterRender 间接消费。从 AISidebar 抽出，行为不变。
export function useAISidebarScroll(selectedKey: AISidebarConversationKey | null) {
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const selectedKeyRef = useRef<AISidebarConversationKey | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = messagesViewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      return;
    }
    msgsEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const scrollToLatestAfterRender = useCallback((key: AISidebarConversationKey, behavior: ScrollBehavior = "auto") => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (selectedKeyRef.current === key) scrollToLatest(behavior);
      });
    });
  }, [scrollToLatest]);

  // 跟踪 viewport 是否贴底:不贴底时才显示"跳到最新回复"按钮
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const update = () => {
      const threshold = 32;
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setIsAtBottom(distance < threshold);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    return () => viewport.removeEventListener("scroll", update);
  }, [selectedKey]);

  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return {
    msgsEndRef,
    messagesViewportRef,
    isAtBottom,
    scrollToLatest,
    scrollToLatestAfterRender,
  };
}
