import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";
import { Tags } from "lucide-react";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { Surface } from "@/components/ui/surface";
import { getBlogTagStyle, splitBlogTags } from "../utils/blogTags";

export function BlogOverviewPanel() {
  const { state, dispatch } = useChat();
  const location = useLocation();

  const publishedCount = state.blogPosts.filter((p) => p.status === "published").length;
  const draftCount = state.blogPosts.length - publishedCount;

  const introPost = state.blogPosts?.find((p) => p.slug === "ai-blog-intro");
  const introTags = useMemo(() => splitBlogTags(introPost?.tags), [introPost?.tags]);

  const tagEntries = useMemo(() => {
    const tagCounts = new Map<string, number>();
    state.blogPosts.forEach((post) => {
      splitBlogTags(post.tags).forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      });
    });
    if (location.pathname === "/") {
      introTags.forEach((tag) => {
        if (!tagCounts.has(tag)) tagCounts.set(tag, 1);
      });
    }
    return Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  }, [state.blogPosts, introTags, location.pathname]);

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      <div className="p-4 flex flex-col gap-4">
        <Surface variant="card" className="rounded-panel bg-card/80 p-3 shadow-sm">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Overview
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Surface variant="inset" className="rounded-control bg-background/62 px-2 py-3">
              <div className="text-xl font-black tracking-[-0.04em] text-foreground">{state.blogPosts.length}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">文章</div>
            </Surface>
            <Surface variant="inset" className="rounded-control bg-background/62 px-2 py-3">
              <div className="text-xl font-black tracking-[-0.04em] text-primary">{publishedCount}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">已发布</div>
            </Surface>
            <Surface variant="inset" className="rounded-control bg-background/62 px-2 py-3">
              <div className="text-xl font-black tracking-[-0.04em] text-amber-600 dark:text-amber-300">{draftCount}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">草稿</div>
            </Surface>
          </div>
        </Surface>

        <Surface variant="card" className="rounded-panel bg-card/80 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <Tags className="h-3.5 w-3.5 text-primary" />
              Tags
            </div>
            <div className="flex items-center gap-2">
              {state.blogSelectedTag && (
                <button
                  className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/25 transition-colors"
                  onClick={() => dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: null })}
                >
                  清除筛选
                </button>
              )}
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                {tagEntries.length}
              </span>
            </div>
          </div>
          {tagEntries.length === 0 ? (
            <Surface variant="dashed" className="rounded-control bg-secondary/45 px-3 py-5 text-center text-xs">
              暂无标签
            </Surface>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagEntries.map(([tag, count]) => {
                const isSelected = state.blogSelectedTag === tag;
                return (
                  <button
                    key={tag}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary scale-105" : "hover:opacity-80"}`}
                    style={getBlogTagStyle(tag)}
                    onClick={() => dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: isSelected ? null : tag })}
                  >
                    {tag}
                    <span className="text-[11px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Surface>
      </div>
    </WorkspacePanel>
  );
}
