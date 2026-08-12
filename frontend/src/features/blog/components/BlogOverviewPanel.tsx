import { useMemo, useState } from "react";
import { useLocation, matchPath } from "react-router-dom";
import { Sparkles, Tags } from "lucide-react";

import { useChat } from "../../../stores/chatStore";
import { useAuth } from "../../../stores/authStore";
import { getBlogTagStyle, splitBlogTags } from "../utils/blogTags";

import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { Surface } from "@/components/ui/surface";
import { LeftbarHtmlFrame } from "./LeftbarHtmlFrame";
import { cn } from "@/lib/utils";

// 博客主页左栏：DIY 卡片（AI 生成 HTML，iframe 沙箱渲染）+ 标签云（可开关）。
// DIY 卡片 hover 出编辑入口（仅博主）；编辑时把卡片当前高度传给 AI，
// 让其生成刚好填满该高度的内容。
export function BlogOverviewPanel() {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  // LeftSidebar 渲染在 <Routes> 之外（三栏 Panel 布局），useParams 取不到路由参数，
  // 改用 matchPath 从 location 解析当前博主用户名（与 useAISidebarRouteContext 同范式）。
  const routeUsername = matchPath("/u/:username", location.pathname)?.params.username;

  // 仅博主自己可见编辑入口；客户端比对，比后端 is_owner 更可靠（token 过期不误判）
  const isOwner = isAuthenticated && !!user && !!routeUsername && user.username === routeUsername;
  const hasHtml = !!state.leftbarHtml;
  const showTags = state.leftbarShowTags;
  // 当前 DIY 卡片实际渲染高度（iframe 内容高度），编辑时作为生成目标传给 AI
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  // hover 用 React state 而非 CSS group-hover：iframe 会吞掉父文档的 :hover，
  // 改用 onMouseEnter/Leave 边界事件更可靠
  const [cardHover, setCardHover] = useState(false);

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
    dispatch({
      type: "SET_AI_LEFTBAR_EDIT_CONTEXT",
      payload: { html: state.leftbarHtml, heightPx: frameHeight },
    });
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
  };

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      <div className="flex flex-col gap-4 p-4">
        {/* DIY 卡片：AI 自定义内容；博主 hover 卡片右上角触发编辑 */}
        <Surface
          variant="card"
          className="relative rounded-panel bg-card/80 p-3 shadow-sm"
          onMouseEnter={() => setCardHover(true)}
          onMouseLeave={() => setCardHover(false)}
        >
          {hasHtml ? (
            <LeftbarHtmlFrame
              html={state.leftbarHtml ?? ""}
              theme={state.theme}
              onHeightChange={setFrameHeight}
            />
          ) : (
            <div className="flex min-h-[120px] items-center justify-center px-2 py-6 text-center text-fine text-muted-foreground">
              {isOwner ? "悬停卡片右上角「编辑」，用 AI 自定义左栏" : "博主暂未设置自定义左栏内容"}
            </div>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={startAiEdit}
              className={cn(
                "absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-control bg-background/85 px-2 py-1 text-caption font-medium text-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm transition-opacity hover:bg-background",
                cardHover ? "opacity-100" : "opacity-0",
              )}
              aria-label="用 AI 编辑左栏"
            >
              <Sparkles className="h-3 w-3 text-primary" />
              编辑
            </button>
          )}
        </Surface>

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
              <p className="px-3 py-5 text-center text-fine text-muted-foreground">
                暂无标签
              </p>
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
      </div>
    </WorkspacePanel>
  );
}
