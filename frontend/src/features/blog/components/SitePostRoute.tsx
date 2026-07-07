import { useEffect, useReducer } from "react";
import { useParams } from "react-router-dom";
import { getSitePost, getSiteUser } from "../../../api/client";
import { useAuth } from "../../../stores/authStore";
import { useChat } from "../../../stores/chatStore";
import { BlogPostView } from "./BlogPostView";
import { BlogEditor } from "./BlogEditor";
import { AlertCircle } from "lucide-react";

type State = { loading: boolean; error: string | null; isOwner: boolean };
type Action =
  | { type: "reset" }
  | { type: "loaded"; isOwner: boolean }
  | { type: "error"; message: string };

const initialState: State = { loading: true, error: null, isOwner: false };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return initialState;
    case "loaded":
      return { loading: false, error: null, isOwner: action.isOwner };
    case "error":
      return { loading: false, error: action.message, isOwner: false };
  }
}

export function SitePostRoute() {
  const { username, slug } = useParams<{ username: string; slug: string }>();
  const { user, isAuthenticated } = useAuth();
  const { state, dispatch } = useChat();
  const [local, localDispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (!username || !slug) return;
    let alive = true;
    localDispatch({ type: "reset" });

    Promise.all([getSiteUser(username), getSitePost(username, slug)])
      .then(([siteUser, post]) => {
        if (!alive) return;
        localDispatch({ type: "loaded", isOwner: Boolean(siteUser.is_owner) });
        dispatch({ type: "SET_PAGE", payload: "blog" });
        dispatch({ type: "SET_BLOG_VIEW", payload: "view" });
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
  }, [username, slug, isAuthenticated, user?.username, dispatch]);

  const { loading, error, isOwner } = local;

  if (!username || !slug) return null;

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-8 text-sm text-muted-foreground">
        正在加载文章...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-8">
        <div className="flex max-w-sm flex-col items-center rounded-[2rem] border border-border/70 bg-card/80 px-8 py-8 text-center shadow-xl shadow-foreground/5">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">无法打开文章</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (isOwner && state.blogCurrentView === "edit") {
    return <BlogEditor />;
  }

  return <BlogPostView username={username} isOwner={isOwner} />;
}
