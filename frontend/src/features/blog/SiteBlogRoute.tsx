import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSiteUser } from "../../api/client";
import { useAuth } from "../../stores/authStore";
import { BlogPage } from "./BlogPage";
import { AlertCircle } from "lucide-react";

export function SiteBlogRoute() {
  const { username } = useParams<{ username: string }>();
  const { user, isAuthenticated } = useAuth();
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    setLoading(true);
    setError(null);

    getSiteUser(username)
      .then((siteUser) => {
        if (!alive) return;
        setIsOwner(Boolean(siteUser.is_owner));
      })
      .catch(() => {
        if (!alive) return;
        setIsOwner(false);
        setError("用户主页不存在或暂时无法访问");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [username, isAuthenticated, user?.username]);

  if (!username) return null;

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-8 text-sm text-muted-foreground">
        正在加载用户主页...
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
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">无法打开主页</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return <BlogPage username={username} isOwner={isOwner} />;
}
