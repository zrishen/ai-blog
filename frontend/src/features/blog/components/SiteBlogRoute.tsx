import { useEffect, useReducer } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";

import { useAuth } from "../../../stores/authStore";
import { useChat } from "../../../stores/chatStore";

import { BlogPage } from "./BlogPage";

import { getSiteUser } from "@/api/blog";


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

export function SiteBlogRoute() {
  const { username } = useParams<{ username: string }>();
  const { user, isAuthenticated } = useAuth();
  const { dispatch: chatDispatch } = useChat();
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    dispatch({ type: "reset" });

    getSiteUser(username)
      .then((siteUser) => {
        if (!alive) return;
        chatDispatch({ type: "SET_LEFTBAR_HTML", payload: siteUser.sidebar_html ?? null });
        chatDispatch({ type: "SET_LEFTBAR_SHOW_TAGS", payload: siteUser.show_tags ?? true });
        dispatch({ type: "loaded", isOwner: Boolean(siteUser.is_owner) });
      })
      .catch(() => {
        if (!alive) return;
        dispatch({ type: "error", message: "用户主页不存在或暂时无法访问" });
      });

    return () => {
      alive = false;
    };
  }, [username, isAuthenticated, user?.username, chatDispatch]);

  const { loading, error, isOwner } = state;

  if (!username) return null;

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-8 text-body text-muted-foreground">
        正在加载用户主页...
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
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">无法打开主页</h2>
          <p className="mt-2 text-body leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return <BlogPage username={username} isOwner={isOwner} />;
}
