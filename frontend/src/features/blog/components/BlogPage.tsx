import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";
import type { BlogPost } from "../../../stores/chatStore";
import { listSitePosts } from "@/api/blog";
import { BlogPostCard } from "./BlogPostCard";
import { BlogEditor } from "./BlogEditor";
import { splitBlogTags } from "../utils/blogTags";
import { PenLine } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

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
      const data = await listSitePosts(username);
      dispatch({ type: "SET_BLOG_POSTS", payload: data.posts });
      return data.posts;
    } catch (e) {
      console.error("Failed to load site posts:", e);
      dispatch({ type: "SET_BLOG_POSTS", payload: [] });
      return [];
    }
  }, [username, dispatch]);

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    if (!isOwner || state.blogCurrentView !== "edit") {
      dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    }
  }, [username, isOwner, state.blogCurrentView, dispatch]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts, state.trashRevision]);

  const visiblePosts = useMemo(() => {
    let posts = state.blogPosts.filter((post) => post.status === "published");
    if (state.blogSelectedTag) {
      posts = posts.filter((post) => splitBlogTags(post.tags).includes(state.blogSelectedTag!));
    }
    return posts;
  }, [state.blogPosts, state.blogSelectedTag]);

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
    <div className="flex h-full min-h-0 flex-1 flex-col touch-pan-y overflow-y-auto bg-background p-2">
      {/* 列表只允许纵向滚动（touch-pan-y），把横向触摸交给边缘滑动手势；否则浏览器会把触摸序列绑定到滚动容器，导致滑出抽屉时中栏被一起拖动、面板跟到一半就卡住。 */}
      {visiblePosts.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="还没有文章"
          description={isOwner ? "从一篇草稿开始，把资料、观点和创作过程留在这里。" : "这个用户暂时还没有公开文章。"}
          className="min-h-0 flex-1 rounded-surface p-10"
        />
      ) : (
        <section className="flex flex-col gap-2 pb-8">
          {blogRows.map((row) =>
            row.type === "single" ? (
              <BlogPostCard key={`single-${row.post.id}`} post={row.post} variant={row.variant} onClick={handlePostClick} />
            ) : (
              <div key={`double-${row.posts[0].id}-${row.posts[1].id}`} className="flex flex-row gap-2">
                {row.posts.map((post) => (
                  <div key={post.id} className="flex min-w-0 flex-1">
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
