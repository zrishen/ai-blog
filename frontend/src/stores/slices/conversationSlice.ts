import type { ChatState, ChatAction } from "../chatStore";
import { applyStreamEvent } from "./streamEvent";

// Conversation 切片：处理对话与消息相关 action，其它原样返回。
export function conversationReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.payload };
    case "SET_CURRENT_CONVERSATION":
      return { ...state, currentConversationId: action.payload };
    case "SET_MESSAGES":
      return { ...state, messages: action.payload };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.id ? { ...m, ...action.payload } : m
        ),
      };
    case "APPLY_MESSAGE_STREAM_EVENT":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.id ? applyStreamEvent(m, action.payload.event) : m
        ),
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_STREAMING":
      return { ...state, isStreaming: action.payload };
    default:
      return state;
  }
}
