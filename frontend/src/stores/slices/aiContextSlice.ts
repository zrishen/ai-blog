import type { ChatState, ChatAction } from "../chatStore";

// AI↔博客 桥接 UI 状态切片：右键选区上下文、主页左栏 HTML、左栏编辑上下文。
// 从 blogSlice 按域聚合抽出（前缀均为 AI_/LEFTBAR_，非博客 CRUD 语义）。
export function aiContextReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_AI_SELECTION_CONTEXT":
      return { ...state, aiSelectionContext: action.payload };
    case "CLEAR_AI_SELECTION_CONTEXT":
      return { ...state, aiSelectionContext: null };
    case "SET_LEFTBAR_HTML":
      return { ...state, leftbarHtml: action.payload };
    case "SET_LEFTBAR_SHOW_TAGS":
      return { ...state, leftbarShowTags: action.payload };
    case "SET_AI_LEFTBAR_EDIT_CONTEXT":
      return { ...state, aiLeftbarEditContext: action.payload };
    case "CLEAR_AI_LEFTBAR_EDIT_CONTEXT":
      return { ...state, aiLeftbarEditContext: null };
    default:
      return state;
  }
}
