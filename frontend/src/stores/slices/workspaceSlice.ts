import type { ChatState, ChatAction } from "../chatStore";

// Workspace 切片：目录树 + 选中目录，其它 action 原样返回。
export function workspaceReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_WORKSPACE_TREE":
      return { ...state, workspaceTree: action.payload };
    case "SET_WORKSPACE_SELECTED_FOLDER":
      return { ...state, workspaceSelectedFolderId: action.payload };
    case "SET_WORKSPACE_SELECTED_VIEW":
      return { ...state, workspaceSelectedView: action.payload };
    case "SET_WORKSPACE_EDITING_BLOG":
      return { ...state, workspaceEditingBlogId: action.payload };
    default:
      return state;
  }
}
