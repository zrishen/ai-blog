import type { ChatState, ChatAction } from "../chatStore";

function removePostKey<T>(record: Record<number, T>, postId: number): Record<number, T> {
  if (!(postId in record)) return record;
  const next = { ...record };
  delete next[postId];
  return next;
}

// Blog 切片：博客 CRUD + 按文章隔离的流式预览 + 选区，其它 action 原样返回。
export function blogReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_BLOG_POSTS": {
      // 列表接口不含完整正文（content 为可选）：合并时保留已加载的详情正文，
      // 避免 create_post 等触发的列表刷新把当前打开文章的正文冲成空。
      const previousById = new Map(state.blogPosts.map((p) => [p.id, p]));
      return {
        ...state,
        blogPosts: action.payload.map((p) => {
          const prev = previousById.get(p.id);
          const incomingContent = typeof p.content === "string" ? p.content : "";
          if (prev && prev.content && !incomingContent.trim()) {
            return { ...p, content: prev.content };
          }
          return p;
        }),
      };
    }
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
    case "UPSERT_BLOG_POST": {
      const exists = state.blogPosts.some((p) => p.id === action.payload.id);
      return {
        ...state,
        blogPosts: exists
          ? state.blogPosts.map((p) => (p.id === action.payload.id ? { ...p, ...action.payload } : p))
          : [action.payload, ...state.blogPosts],
      };
    }
    case "START_BLOG_STREAMING":
      return {
        ...state,
        blogStreamingByPostId: {
          ...state.blogStreamingByPostId,
          [action.payload.postId]: {
            runId: action.payload.runId,
            content: "",
            status: "streaming",
          },
        },
      };
    case "APPEND_BLOG_STREAMING": {
      const current = state.blogStreamingByPostId[action.payload.postId];
      if (!current || current.runId !== action.payload.runId) return state;
      return {
        ...state,
        blogStreamingByPostId: {
          ...state.blogStreamingByPostId,
          [action.payload.postId]: {
            ...current,
            content: current.content + action.payload.contentDelta,
          },
        },
      };
    }
    case "CLEAR_BLOG_STREAMING": {
      const current = state.blogStreamingByPostId[action.payload.postId];
      if (!current || current.runId !== action.payload.runId) return state;
      return {
        ...state,
        blogStreamingByPostId: removePostKey(state.blogStreamingByPostId, action.payload.postId),
      };
    }
    case "START_BLOG_PATCH_STREAMING":
      return {
        ...state,
        blogPatchStreamingByPostId: {
          ...state.blogPatchStreamingByPostId,
          [action.payload.postId]: {
            runId: action.payload.runId,
            targetText: action.payload.targetText,
            replacementDelta: "",
          },
        },
      };
    case "APPEND_BLOG_PATCH_STREAMING": {
      const current = state.blogPatchStreamingByPostId[action.payload.postId];
      if (!current || current.runId !== action.payload.runId) return state;
      return {
        ...state,
        blogPatchStreamingByPostId: {
          ...state.blogPatchStreamingByPostId,
          [action.payload.postId]: {
            ...current,
            replacementDelta: current.replacementDelta + action.payload.replacementDelta,
          },
        },
      };
    }
    case "CLEAR_BLOG_PATCH_STREAMING": {
      const current = state.blogPatchStreamingByPostId[action.payload.postId];
      if (!current || current.runId !== action.payload.runId) return state;
      return {
        ...state,
        blogPatchStreamingByPostId: removePostKey(state.blogPatchStreamingByPostId, action.payload.postId),
      };
    }
    default:
      return state;
  }
}
