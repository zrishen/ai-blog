import type { ChatState, ChatAction } from "../chatStore";

export function uiReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_THEME": {
      const newTheme = action.payload;
      return { ...state, theme: newTheme };
    }
    case "SET_ACTIVE_PANEL":
      return { ...state, activePanel: action.payload };
    case "SET_PAGE":
      return { ...state, currentPage: action.payload, gearMenuOpen: false };
    case "TOGGLE_GEAR_MENU":
      return { ...state, gearMenuOpen: action.payload !== undefined ? action.payload : !state.gearMenuOpen };
    case "TOGGLE_PLUGIN_CENTER":
      return { ...state, pluginCenterOpen: action.payload !== undefined ? action.payload : !state.pluginCenterOpen, gearMenuOpen: false };
    default:
      return state;
  }
}
