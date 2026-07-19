import type { ChatState, ChatAction } from "../chatStore";

// UI 切片：主题 + 布局（页面/面板/菜单），其它 action 原样返回。
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
    case "TOGGLE_MCP_MODAL":
      return { ...state, mcpModalOpen: action.payload !== undefined ? action.payload : !state.mcpModalOpen, gearMenuOpen: false };
    default:
      return state;
  }
}
