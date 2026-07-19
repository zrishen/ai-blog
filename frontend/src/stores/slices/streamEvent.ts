import type { Message, AIStreamEvent } from "../../features/ai-chat/types";

// 流式事件应用到消息上的共享 helper（conversation 与 ai-sidebar 切片共用）。
export function applyStreamEvent(message: Message, event: AIStreamEvent): Message {
  switch (event.type) {
    case "delta":
      return { ...message, streamingRound: (message.streamingRound ?? "") + event.delta };
    case "loop":
      return {
        ...message,
        streamingRound: "",
        loopSteps: [...(message.loopSteps ?? []), event.content],
      };
    case "final":
      return {
        ...message,
        content: event.content,
        streamingRound: "",
        streamFinalized: true,
        streamError: undefined,
      };
    case "discard":
      return { ...message, streamingRound: "" };
    case "error":
      return { ...message, streamingRound: "", streamError: event.message };
  }
}
