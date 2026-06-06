import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../stores/chatStore";
import type { BlogPost } from "../../stores/chatStore";
import { listSitePosts } from "../../api/client";
import { BlogPostCard } from "./BlogPostCard";
import { BlogEditor } from "./BlogEditor";
import { splitBlogTags } from "./blogTags";
import { PenLine } from "lucide-react";

interface BlogPageProps {
  username: string;
  isOwner: boolean;
}

type BlogRow =
  | { type: "single"; post: BlogPost; variant: "feature-bg" | "feature-side" }
  | { type: "double"; posts: [BlogPost, BlogPost] };

function buildBlogRows(posts: BlogPost[]): BlogRow[] {
  const pattern = [1, 2, 2, 1, 1, 2] as const;
  const rows: BlogRow[] = [];
  let postIndex = 0;
  let patternIndex = 0;
  let singleIndex = 0;

  while (postIndex < posts.length) {
    const mode = pattern[patternIndex % pattern.length];
    if (mode === 2 && posts.length - postIndex >= 2) {
      rows.push({ type: "double", posts: [posts[postIndex], posts[postIndex + 1]] });
      postIndex += 2;
    } else {
      rows.push({
        type: "single",
        post: posts[postIndex],
        variant: singleIndex % 2 === 0 ? "feature-bg" : "feature-side",
      });
      postIndex += 1;
      singleIndex += 1;
    }
    patternIndex += 1;
  }

  return rows;
}

export function BlogPage({ username, isOwner }: BlogPageProps) {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();

  const loadPosts = useCallback(async () => {
    try {
      const data = await listSitePosts(username, { include_drafts: isOwner, per_page: 50 });
      dispatch({ type: "SET_BLOG_POSTS", payload: data.posts });
      return data.posts;
    } catch (e) {
      console.error("Failed to load site posts:", e);
      dispatch({ type: "SET_BLOG_POSTS", payload: [] });
      return [];
    }
  }, [username, isOwner, dispatch]);

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    if (!isOwner || state.blogCurrentView !== "edit") {
      dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    }
  }, [username, isOwner, state.blogCurrentView, dispatch]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const visiblePosts = useMemo(() => {
    let posts = isOwner ? state.blogPosts : state.blogPosts.filter((post) => post.status === "published");
    if (state.blogSelectedTag) {
      posts = posts.filter((post) => splitBlogTags(post.tags).includes(state.blogSelectedTag!));
    }
    return posts;
  }, [isOwner, state.blogPosts, state.blogSelectedTag]);

  const handlePostClick = useCallback((id: number) => {
    const post = state.blogPosts.find((item) => item.id === id);
    if (!post) return;
    navigate(`/u/${encodeURIComponent(username)}/posts/${encodeURIComponent(post.slug)}`);
  }, [navigate, state.blogPosts, username]);

  const blogRows = useMemo(() => buildBlogRows(visiblePosts), [visiblePosts]);

  if (state.blogCurrentView === "edit" && isOwner) {
    return <BlogEditor />;
  }

  return (
    <div className="flex-1 h-full min-h-full overflow-y-auto bg-background px-2 py-2">
      {visiblePosts.length === 0 ? (
        <section className="flex min-h-[58vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-border bg-card/72 p-10 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary ring-1 ring-primary/15">
            <PenLine className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground">还没有文章</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {isOwner ? "从一篇草稿开始，把资料、观点和创作过程留在这里。" : "这个用户暂时还没有公开文章。"}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-2 pb-8">
          {blogRows.map((row) =>
            row.type === "single" ? (
              <BlogPostCard key={`single-${row.post.id}`} post={row.post} variant={row.variant} onClick={handlePostClick} />
            ) : (
              <div key={`double-${row.posts[0].id}-${row.posts[1].id}`} className="flex gap-2">
                {row.posts.map((post) => (
                  <div key={post.id} className="min-w-0 flex-1">
                    <BlogPostCard post={post} variant="compact" onClick={handlePostClick} />
                  </div>
                ))}
              </div>
            )
          )}
        </section>
      )}
    </div>
  );
}
