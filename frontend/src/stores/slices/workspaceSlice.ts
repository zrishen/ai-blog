import type { ChatState, ChatAction } from "../chatStore";

export function workspaceReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_FILE_SELECTED_FILE":
      return { ...state, fileSelectedFile: action.payload };
    case "SET_WORKSPACE_TREE":
      return { ...state, workspaceTree: action.payload };
    case "SET_WORKSPACE_BLOG_STATUS":
      return {
        ...state,
        workspaceTree: state.workspaceTree.map((node) =>
          node.resource_type === "blog_post" && node.resource_id === action.payload.id
            ? { ...node, blog_status: action.payload.status }
            : node,
        ),
      };
    case "SET_WORKSPACE_SELECTED_VIEW":
      return { ...state, workspaceSelectedView: action.payload };
    case "SET_WORKSPACE_EDITING_BLOG":
      return { ...state, workspaceEditingBlogId: action.payload };
    default:
      return state;
  }
}
