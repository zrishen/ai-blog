import { useEffect, useReducer } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getSitePost } from "@/api/blog";
import { useAuth } from "../../../stores/authStore";
import { useChat } from "../../../stores/chatStore";
import { BlogPostView } from "./BlogPostView";
import { BlogEditor } from "./BlogEditor";
import { AlertCircle } from "lucide-react";

type State = { loading: boolean; error: string | null };
type Action = { type: "reset" } | { type: "loaded" } | { type: "error"; message: string };

const initialState: State = { loading: true, error: null };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return initialState;
    case "loaded":
      return { loading: false, error: null };
    case "error":
      return { loading: false, error: action.message };
  }
}

export function SitePostRoute() {
  const { username, slug } = useParams<{ username: string; slug: string }>();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const { state, dispatch } = useChat();
  const [local, localDispatch] = useReducer(reducer, initialState);

  // isOwner 用前端登录态比对，不用后端 is_owner：公开接口按 access token 判断，
  // token 过期/未就绪时返回匿名 false 且不触发 401 刷新，按钮会直到刷新页面才显示。
  const isOwner = isAuthenticated && !!user && user.username === username;

  useEffect(() => {
    if (!username || !slug) return;
    let alive = true;
    localDispatch({ type: "reset" });

    getSitePost(username, slug)
      .then((post) => {
        if (!alive) return;
        localDispatch({ type: "loaded" });
        dispatch({ type: "SET_PAGE", payload: "blog" });
        // URL 带 ?edit 时刷新后仍留在编辑页
        dispatch({ type: "SET_BLOG_VIEW", payload: searchParams.get("edit") !== null ? "edit" : "view" });
        dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: post.id });
        dispatch({
          type: "SET_BLOG_POSTS",
          payload: [post],
        });
      })
      .catch(() => {
        if (!alive) return;
        localDispatch({ type: "error", message: "文章不存在，或你没有权限阅读这篇文章" });
      });

    return () => {
      alive = false;
    };
  }, [username, slug, dispatch, searchParams]);

  const { loading, error } = local;

  if (!username || !slug) return null;

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-8 text-body text-muted-foreground">
        正在加载文章...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-8">
        <div className="flex max-w-sm flex-col items-center rounded-feature border border-border/70 bg-card/80 px-8 py-8 text-center shadow-xl shadow-foreground/5">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-panel bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">无法打开文章</h2>
          <p className="mt-2 text-body leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (isOwner && state.blogCurrentView === "edit") {
    return <BlogEditor />;
  }

  return <BlogPostView username={username} isOwner={isOwner} />;
}
