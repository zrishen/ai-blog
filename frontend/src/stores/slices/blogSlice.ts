import type { ChatState, ChatAction } from "../chatStore";

// Blog 切片：博客 CRUD + 流式 + 选区 + patch 预览，其它 action 原样返回。
export function blogReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_BLOG_POSTS":
      return { ...state, blogPosts: action.payload };
    case "SET_BLOG_VIEW":
      return { ...state, blogCurrentView: action.payload };
    case "SET_BLOG_CURRENT_POST_ID":
      return { ...state, blogCurrentPostId: action.payload };
    case "SET_BLOG_SELECTED_TAG":
      return { ...state, blogSelectedTag: action.payload };
    case "UPDATE_BLOG_POST":
      return {
        ...state,
        blogPosts: state.blogPosts.map((p) =>
          p.id === action.payload.id ? { ...p, ...action.payload } : p
        ),
      };
    case "APPEND_BLOG_STREAMING":
      return {
        ...state,
        blogStreamingContent: (state.blogStreamingContent ?? "") + action.payload,
      };
    case "CLEAR_BLOG_STREAMING":
      return { ...state, blogStreamingContent: null };
    case "SET_AI_SELECTION_CONTEXT":
      return { ...state, aiSelectionContext: action.payload };
    case "CLEAR_AI_SELECTION_CONTEXT":
      return { ...state, aiSelectionContext: null };
    case "START_BLOG_PATCH_STREAMING":
      return {
        ...state,
        blogPatchStreaming: { targetText: action.payload.targetText, replacementDelta: "" },
      };
    case "APPEND_BLOG_PATCH_STREAMING":
      if (!state.blogPatchStreaming) return state;
      return {
        ...state,
        blogPatchStreaming: {
          targetText: state.blogPatchStreaming.targetText,
          replacementDelta: state.blogPatchStreaming.replacementDelta + action.payload.replacementDelta,
        },
      };
    case "CLEAR_BLOG_PATCH_STREAMING":
      return { ...state, blogPatchStreaming: null };
    default:
      return state;
  }
}
