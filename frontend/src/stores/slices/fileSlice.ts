import type { ChatState, ChatAction } from "../chatStore";

// File 切片：文件库文档 + 分类选择，其它 action 原样返回。
export function fileReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_FILE_DOCUMENTS":
      return { ...state, fileDocuments: action.payload };
    case "REMOVE_FILE_DOCUMENT":
      return {
        ...state,
        fileDocuments: state.fileDocuments.filter((d) => d.id !== action.payload),
      };
    case "SET_FILE_CATEGORIES":
      return { ...state, fileCategories: action.payload };
    case "SET_FILE_SELECTED_CATEGORY_ID":
      return { ...state, fileSelectedCategoryId: action.payload };
    case "SET_FILE_SELECTED_FILE":
      return { ...state, fileSelectedFile: action.payload };
    default:
      return state;
  }
}
