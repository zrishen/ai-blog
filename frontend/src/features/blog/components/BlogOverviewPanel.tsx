import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Sparkles, Tags } from "lucide-react";
import { useChat } from "../../../stores/chatStore";
import { useAuth } from "../../../stores/authStore";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LeftbarHtmlFrame } from "@/components/LeftbarHtmlFrame";
import { getBlogTagStyle, splitBlogTags } from "../utils/blogTags";

// 博客主页左栏：博主用 AI 生成的自定义 HTML（iframe 沙箱）+ 标签云（可开关），叠加渲染。
export function BlogOverviewPanel() {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated } = useAuth();
  const { username } = useParams<{ username: string }>();
  const location = useLocation();

  // 仅博主自己可见编辑入口；客户端比对，比后端 is_owner 更可靠（token 过期不误判）
  const isOwner = isAuthenticated && !!user && user.username === username;
  const hasHtml = !!state.leftbarHtml;
  const showTags = state.leftbarShowTags;
  const isEmpty = !hasHtml && !showTags;

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

  const startAiEdit = () => {
    dispatch({ type: "SET_AI_LEFTBAR_EDIT_CONTEXT", payload: { html: state.leftbarHtml } });
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
  };

  return (
    <WorkspacePanel className="overflow-y-auto">
      <div className={isEmpty ? "flex h-full w-full flex-col items-center justify-center gap-4 p-4" : "flex flex-col gap-4 p-4"}>
        {hasHtml && <LeftbarHtmlFrame html={state.leftbarHtml as string} theme={state.theme} />}

        {showTags && (
          <Surface variant="card" className="rounded-panel bg-card/80 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-fine font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <Tags className="h-3.5 w-3.5 text-primary" />
                Tags
              </div>
              <div className="flex items-center gap-2">
                {state.blogSelectedTag && (
                  <button
                    className="rounded-full bg-primary/15 px-2 py-0.5 text-caption font-semibold text-primary hover:bg-primary/25 transition-colors"
                    onClick={() => dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: null })}
                  >
                    清除筛选
                  </button>
                )}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-caption text-muted-foreground">
                  {tagEntries.length}
                </span>
              </div>
            </div>
            {tagEntries.length === 0 ? (
              <Surface variant="dashed" className="rounded-control bg-secondary/45 px-3 py-5 text-center text-fine">
                暂无标签
              </Surface>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tagEntries.map(([tag, count]) => {
                  const isSelected = state.blogSelectedTag === tag;
                  return (
                    <button
                      key={tag}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-fine font-semibold cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary scale-105" : "hover:opacity-80"}`}
                      style={getBlogTagStyle(tag)}
                      onClick={() => dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: isSelected ? null : tag })}
                    >
                      {tag}
                      <span className="text-caption opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Surface>
        )}

        {isEmpty && (
          <EmptyState
            icon={Sparkles}
            title={isOwner ? "定制你的博客左栏" : "博主暂未设置左栏内容"}
            description={
              isOwner
                ? "用 AI 添加个人介绍、创作理念和更多内容。"
                : "这里将展示博主的个人介绍与创作信息。"
            }
            variant="ai-chat"
          />
        )}

        {isOwner && (
          <Button variant="outline" size="sm" onClick={startAiEdit} className="flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
            用 AI 编辑
          </Button>
        )}
      </div>
    </WorkspacePanel>
  );
}
