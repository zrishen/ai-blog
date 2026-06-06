import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSitePost, getSiteUser } from "../../api/client";
import { useAuth } from "../../stores/authStore";
import { useChat } from "../../stores/chatStore";
import { BlogPostView } from "./BlogPostView";
import { BlogEditor } from "./BlogEditor";
import { AlertCircle } from "lucide-react";

export function SitePostRoute() {
  const { username, slug } = useParams<{ username: string; slug: string }>();
  const { user, isAuthenticated } = useAuth();
  const { state, dispatch } = useChat();
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username || !slug) return;
    let alive = true;
    setLoading(true);
    setError(null);

    Promise.all([getSiteUser(username), getSitePost(username, slug)])
      .then(([siteUser, post]) => {
        if (!alive) return;
        setIsOwner(Boolean(siteUser.is_owner));
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
        setIsOwner(false);
        setError("文章不存在，或你没有权限阅读这篇文章");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [username, slug, isAuthenticated, user?.username, dispatch]);

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
