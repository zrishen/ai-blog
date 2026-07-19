import type { ChatState, ChatAction } from "../chatStore";
import type { Message, ToolEvent } from "../../features/ai-chat/types";
import { isDisplayableMessage } from "../../features/ai-chat/types";
import type { TrustChoiceOption } from "../../features/ai-chat/trustPrompts";
import type { ThinkingMode } from "../../api/chat";
import { applyStreamEvent } from "./streamEvent";

function updateMessageWithPayload(
  message: Message,
  payload: { content?: string; thinkingContent?: string; streamingRound?: string; streamFinalized?: boolean; streamError?: string; toolEvents?: ToolEvent[]; reasoningContent?: string; loopSteps?: string[]; thinkingMode?: ThinkingMode; thinkingDurationMs?: number; trustChoicePrompt?: string | null; trustChoiceOptions?: TrustChoiceOption[] },
): Message {
  return {
    ...message,
    ...(payload.content !== undefined ? { content: payload.content } : {}),
    ...(payload.thinkingContent !== undefined ? { thinkingContent: payload.thinkingContent } : {}),
    ...(payload.streamingRound !== undefined ? { streamingRound: payload.streamingRound } : {}),
    ...(payload.streamFinalized !== undefined ? { streamFinalized: payload.streamFinalized } : {}),
    ...(payload.streamError !== undefined ? { streamError: payload.streamError } : {}),
    ...(payload.toolEvents !== undefined ? { toolEvents: payload.toolEvents } : {}),
    ...(payload.reasoningContent !== undefined ? { reasoningContent: payload.reasoningContent } : {}),
    ...(payload.loopSteps !== undefined ? { loopSteps: payload.loopSteps } : {}),
    ...(payload.thinkingMode !== undefined ? { thinkingMode: payload.thinkingMode } : {}),
    ...(payload.thinkingDurationMs !== undefined ? { thinkingDurationMs: payload.thinkingDurationMs } : {}),
    ...(payload.trustChoicePrompt !== undefined ? { trustChoicePrompt: payload.trustChoicePrompt } : {}),
    ...(payload.trustChoiceOptions !== undefined ? { trustChoiceOptions: payload.trustChoiceOptions } : {}),
  };
}

// AI Sidebar 切片：侧栏会话/消息/流式/输入/错误/历史/思考模式 等 19 action，其它原样返回。
export function aiSidebarReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_AI_SIDEBAR_OPEN":
      return { ...state, aiSidebarOpen: action.payload };
    case "SET_AI_SIDEBAR_CONV_ID":
      return { ...state, aiSidebarConversationId: action.payload };
    case "SET_AI_SIDEBAR_SELECTED_KEY":
      return {
        ...state,
        aiSidebarSelectedKey: action.payload,
        aiSidebarConversationId: action.payload?.startsWith("server:") ? Number(action.payload.slice(7)) : null,
        aiSidebarMessages: action.payload ? state.aiSidebarMessagesByKey[action.payload] ?? [] : [],
      };
    case "SET_AI_SIDEBAR_MSGS":
      return { ...state, aiSidebarMessages: action.payload.filter(isDisplayableMessage) };
    case "SET_AI_SIDEBAR_MSGS_FOR_KEY": {
      const messages = action.payload.messages.filter(isDisplayableMessage);
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [action.payload.key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === action.payload.key ? messages : state.aiSidebarMessages,
      };
    }
    case "ADD_AI_SIDEBAR_MSG":
      if (!isDisplayableMessage(action.payload)) return state;
      return { ...state, aiSidebarMessages: [...state.aiSidebarMessages, action.payload] };
    case "ADD_AI_SIDEBAR_MSG_FOR_KEY": {
      if (!isDisplayableMessage(action.payload.message)) return state;
      const current = state.aiSidebarMessagesByKey[action.payload.key] ?? [];
      const messages = [...current, action.payload.message];
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [action.payload.key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === action.payload.key ? messages : state.aiSidebarMessages,
      };
    }
    case "UPDATE_AI_SIDEBAR_MSG":
      return {
        ...state,
        aiSidebarMessages: state.aiSidebarMessages.map((m) =>
          m.id === action.payload.id ? updateMessageWithPayload(m, action.payload) : m
        ),
      };
    case "UPDATE_AI_SIDEBAR_MSG_FOR_KEY": {
      const current = state.aiSidebarMessagesByKey[action.payload.key] ?? [];
      const messages = current.map((m) =>
        m.id === action.payload.id ? updateMessageWithPayload(m, action.payload) : m
      );
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [action.payload.key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === action.payload.key ? messages : state.aiSidebarMessages,
      };
    }
    case "APPLY_AI_STREAM_EVENT":
      return {
        ...state,
        aiSidebarMessages: state.aiSidebarMessages.map((m) =>
          m.id === action.payload.id ? applyStreamEvent(m, action.payload.event) : m
        ),
      };
    case "APPLY_AI_STREAM_EVENT_FOR_KEY": {
      const { key, id, event } = action.payload;
      const current = state.aiSidebarMessagesByKey[key] ?? [];
      const messages = current.map((m) => (m.id === id ? applyStreamEvent(m, event) : m));
      return {
        ...state,
        aiSidebarMessagesByKey: { ...state.aiSidebarMessagesByKey, [key]: messages },
        aiSidebarMessages: state.aiSidebarSelectedKey === key ? messages : state.aiSidebarMessages,
      };
    }
    case "SET_AI_SIDEBAR_STREAMING_FOR_KEY":
      return {
        ...state,
        aiSidebarStreamingByKey: { ...state.aiSidebarStreamingByKey, [action.payload.key]: action.payload.streaming },
      };
    case "SET_AI_SIDEBAR_INPUT_FOR_KEY":
      return {
        ...state,
        aiSidebarInputsByKey: { ...state.aiSidebarInputsByKey, [action.payload.key]: action.payload.input },
      };
    case "SET_AI_SIDEBAR_ERROR_FOR_KEY":
      return {
        ...state,
        aiSidebarErrorsByKey: { ...state.aiSidebarErrorsByKey, [action.payload.key]: action.payload.error },
      };
    case "SET_AI_SIDEBAR_HISTORY_FOR_KEY":
      return {
        ...state,
        aiSidebarHistoryByKey: { ...state.aiSidebarHistoryByKey, [action.payload.key]: action.payload.history },
      };
    case "MIGRATE_AI_SIDEBAR_TEMP_KEY": {
      const { fromKey, toKey, conversationId } = action.payload;
      const fromMessages = state.aiSidebarMessagesByKey[fromKey] ?? [];
      const toMessages = fromMessages.map((m) => ({ ...m, conversation_id: conversationId }));
      const {
        [fromKey]: _removedMessages,
        ...messagesByKey
      } = state.aiSidebarMessagesByKey;
      const { [fromKey]: removedStreaming, ...streamingByKey } = state.aiSidebarStreamingByKey;
      const { [fromKey]: removedInput, ...inputsByKey } = state.aiSidebarInputsByKey;
      const { [fromKey]: removedError, ...errorsByKey } = state.aiSidebarErrorsByKey;
      const { [fromKey]: removedHistory, ...historyByKey } = state.aiSidebarHistoryByKey;
      void _removedMessages;
      return {
        ...state,
        aiSidebarSelectedKey: state.aiSidebarSelectedKey === fromKey ? toKey : state.aiSidebarSelectedKey,
        aiSidebarConversationId: state.aiSidebarSelectedKey === fromKey ? conversationId : state.aiSidebarConversationId,
        aiSidebarMessages: state.aiSidebarSelectedKey === fromKey ? toMessages : state.aiSidebarMessages,
        aiSidebarMessagesByKey: { ...messagesByKey, [toKey]: toMessages },
        aiSidebarStreamingByKey: { ...streamingByKey, [toKey]: removedStreaming ?? false },
        aiSidebarInputsByKey: { ...inputsByKey, [toKey]: removedInput ?? "" },
        aiSidebarErrorsByKey: { ...errorsByKey, [toKey]: removedError ?? null },
        aiSidebarHistoryByKey: { ...historyByKey, [toKey]: removedHistory ?? { loading: false, error: null } },
      };
    }
    case "REMOVE_AI_SIDEBAR_THREAD": {
      const { key } = action.payload;
      const { [key]: removedMessages, ...messagesByKey } = state.aiSidebarMessagesByKey;
      const { [key]: removedStreaming, ...streamingByKey } = state.aiSidebarStreamingByKey;
      const { [key]: removedInput, ...inputsByKey } = state.aiSidebarInputsByKey;
      const { [key]: removedError, ...errorsByKey } = state.aiSidebarErrorsByKey;
      const { [key]: removedHistory, ...historyByKey } = state.aiSidebarHistoryByKey;
      void removedMessages;
      void removedStreaming;
      void removedInput;
      void removedError;
      void removedHistory;
      return {
        ...state,
        aiSidebarSelectedKey: state.aiSidebarSelectedKey === key ? null : state.aiSidebarSelectedKey,
        aiSidebarConversationId: state.aiSidebarSelectedKey === key ? null : state.aiSidebarConversationId,
        aiSidebarMessages: state.aiSidebarSelectedKey === key ? [] : state.aiSidebarMessages,
        aiSidebarMessagesByKey: messagesByKey,
        aiSidebarStreamingByKey: streamingByKey,
        aiSidebarInputsByKey: inputsByKey,
        aiSidebarErrorsByKey: errorsByKey,
        aiSidebarHistoryByKey: historyByKey,
      };
    }
    case "SET_AI_SIDEBAR_THINKING_MODE":
      return { ...state, aiSidebarThinkingMode: action.payload };
    case "SET_LLM_SUPPORTS_THINKING":
      return { ...state, llmSupportsThinking: action.payload };
    default:
      return state;
  }
}
