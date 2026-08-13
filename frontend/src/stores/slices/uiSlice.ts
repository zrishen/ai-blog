import type { ChatState, ChatAction } from "../chatStore";

export function uiReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_THEME": {
      const newTheme = action.payload;
      return { ...state, theme: newTheme };
    }
    case "SET_PAGE":
      return { ...state, currentPage: action.payload };
    default:
      return state;
  }
}
