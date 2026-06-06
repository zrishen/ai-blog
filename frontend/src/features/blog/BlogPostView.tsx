import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useChat } from "../../stores/chatStore";
import { deleteBlogPost, publishBlogPost } from "../../api/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { ArrowLeft, Pencil, Trash2, Globe, EyeOff, Calendar, Eye, Tags, AlertCircle, FileText, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getBlogTagStyle, splitBlogTags } from "./blogTags";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BlogPostViewProps {
  username?: string;
  isOwner?: boolean;
}

export function BlogPostView({ username, isOwner = true }: BlogPostViewProps) {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();
  const post = state.blogPosts.find((p) => p.id === state.blogCurrentPostId);
  const isDark = state.theme === "dark";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStreaming = state.blogStreamingContent !== null;
  const patchStreaming = state.blogPatchStreaming;
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const patchAreaRef = useRef<HTMLDivElement>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.blogStreamingContent, isStreaming]);

  useEffect(() => {
    if (patchStreaming && patchAreaRef.current) {
      patchAreaRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [patchStreaming]);

  const displayContent = useMemo(() => {
    // 流式内容优先（AI 正在编辑时）
    if (state.blogStreamingContent !== null && state.blogStreamingContent !== undefined) {
      return state.blogStreamingContent;
    }
    if (!post?.title || !post?.content) return post?.content || "";
    const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");
    const normalizedTitle = normalizeText(post.title);
    if (!normalizedTitle) return post.content;
    return post.content.replace(/^\s*#(?!#)\s+(.+?)\s*#?\s*(?:\r?\n|$)/, (match, headingText) => {
      const normalizedHeading = normalizeText(headingText);
      return normalizedHeading === normalizedTitle ? "" : match;
    });
  }, [post?.title, post?.content, state.blogStreamingContent]);

  const tags = useMemo(() => splitBlogTags(post?.tags), [post?.tags]);

  const date = useMemo(() => {
    const dateStr = post?.published_at || post?.created_at;
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [post?.created_at, post?.published_at]);

  const mdComponents = useMemo(() => ({
    h2: ({ children, ...props }: { children?: React.ReactNode }) => {
      const text = typeof children === "string" ? children : "";
      const slug = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/^-|-$/g, "");
      return <h2 id={slug} {...props}>{children}</h2>;
    },
    h3: ({ children, ...props }: { children?: React.ReactNode }) => {
      const text = typeof children === "string" ? children : "";
      const slug = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/^-|-$/g, "");
      return <h3 id={slug} {...props}>{children}</h3>;
    },
    h4: ({ children, ...props }: { children?: React.ReactNode }) => {
      const text = typeof children === "string" ? children : "";
      const slug = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/^-|-$/g, "");
      return <h4 id={slug} {...props}>{children}</h4>;
    },
  }), []);

  const handleEdit = useCallback(() => {
    if (!isOwner) return;
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
  }, [dispatch, isOwner]);

  const handleConfirmDelete = useCallback(async () => {
    if (!post || !isOwner) return;
    try {
      await deleteBlogPost(post.id);
      dispatch({ type: "SET_BLOG_POSTS", payload: state.blogPosts.filter((p) => p.id !== post.id) });
      dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
      setDeleteOpen(false);
      if (username) navigate(`/u/${encodeURIComponent(username)}`);
    } catch {
      setError("删除失败，请稍后重试");
    }
  }, [post, isOwner, state.blogPosts, dispatch, username, navigate]);

  const handlePublish = useCallback(async () => {
    if (!post || !isOwner) return;
    const newStatus = post.status !== "published";
    try {
      const updated = await publishBlogPost(post.id, newStatus);
      dispatch({
        type: "SET_BLOG_POSTS",
        payload: state.blogPosts.map((p) => (p.id === post.id ? { ...p, status: updated.status, published_at: updated.published_at } : p)),
      });
      setError(null);
    } catch {
      setError("操作失败，请稍后重试");
    }
  }, [post, isOwner, state.blogPosts, dispatch]);

  const goBack = useCallback(() => {
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    if (username) navigate(`/u/${encodeURIComponent(username)}`);
  }, [dispatch, navigate, username]);

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isOwner || !post) return;
    const selection = window.getSelection()?.toString().trim() || "";
    e.preventDefault();
    if (selection.length >= 5) {
      setContextMenu({ x: e.clientX, y: e.clientY, selectedText: selection });
    } else {
      setContextMenu(null);
    }
  }, [isOwner, post]);

  // 移动端长按处理
  const handleTouchStart = useCallback(() => {
    if (!isOwner || !post) return;
    longPressTimerRef.current = setTimeout(() => {
      const selection = window.getSelection()?.toString().trim() || "";
      if (selection.length >= 5 && articleRef.current) {
        const rect = articleRef.current.getBoundingClientRect();
        setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + 50, selectedText: selection });
      }
    }, 500);
  }, [isOwner, post]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleCopySelection = useCallback(() => {
    if (!contextMenu) return;
    navigator.clipboard.writeText(contextMenu.selectedText).catch(() => {});
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleAIModify = useCallback(() => {
    if (!contextMenu || !post) return;
    dispatch({
      type: "SET_AI_SELECTION_CONTEXT",
      payload: { postId: post.id, selectedText: contextMenu.selectedText },
    });
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    closeContextMenu();
  }, [contextMenu, post, dispatch, closeContextMenu]);

  // 点击菜单外关闭
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => closeContextMenu();
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu, closeContextMenu]);

  // 原地流式渲染 — patchStreaming 定位
  const patchRenderInfo = useMemo(() => {
    if (!patchStreaming || !post?.content) return null;
    const articleContent = post.content;
    let patchIndex = -1;
    let matchedTargetText = "";

    // 1. 精确匹配
    patchIndex = articleContent.indexOf(patchStreaming.targetText);
    if (patchIndex !== -1) {
      matchedTargetText = patchStreaming.targetText;
    } else {
      // 2. trim 容错匹配
      const trimmedTarget = patchStreaming.targetText.trim();
      for (let i = 0; i <= articleContent.length - trimmedTarget.length; i++) {
        if (articleContent.slice(i, i + trimmedTarget.length).trim() === trimmedTarget) {
          let end = i + trimmedTarget.length;
          while (end < articleContent.length && articleContent.slice(i, end).trim().length < trimmedTarget.length) {
            end++;
          }
          patchIndex = i;
          matchedTargetText = articleContent.slice(i, end);
          break;
        }
      }
    }

    if (patchIndex === -1) return null;
    return { patchIndex, matchedTargetText, before: articleContent.slice(0, patchIndex), after: articleContent.slice(patchIndex + matchedTargetText.length) };
  }, [patchStreaming, post?.content]);

  if (!post) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="rounded-[2rem] border border-border/70 bg-card/80 px-10 py-9 text-center shadow-xl shadow-foreground/5">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileText className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground">文章未找到</h2>
          <Button className="mt-5 rounded-full" onClick={goBack}>
            返回列表
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 h-full min-h-full overflow-y-auto bg-background px-2 py-2" onClick={closeContextMenu}>
      <div className="mx-auto w-full max-w-[980px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border/70 bg-card/88 p-3 shadow-xl shadow-foreground/5 backdrop-blur-xl">
          <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" onClick={goBack}>
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </Button>

          {isOwner && (
            <div className="flex flex-wrap items-center gap-2">
              {error && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {error}
                </span>
              )}
              <Button variant="outline" className="rounded-full bg-background/70" onClick={handleEdit}>
                <Pencil className="w-3.5 h-3.5" />
                编辑
              </Button>
              <Button variant="outline" className="rounded-full bg-background/70" onClick={handlePublish}>
                {post.status === "published" ? (
                  <><EyeOff className="w-3.5 h-3.5" /> 取消发布</>
                ) : (
                  <><Globe className="w-3.5 h-3.5" /> 发布</>
                )}
              </Button>
              <Button variant="destructive" className="rounded-full" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </Button>
            </div>
          )}
        </div>

        <motion.article
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={cn(
            "relative overflow-hidden rounded-[2rem] border border-border/70 bg-card/92 shadow-xl shadow-foreground/5",
            isStreaming && "border-l-2 border-l-primary/60 animate-pulse"
          )}
        >
          {isStreaming && (
            <span className="absolute -left-1 -top-1 z-10 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              AI 编辑中
            </span>
          )}
          <div
            className="relative px-6 pt-8 sm:px-10 sm:pt-10 pb-0"
            style={post.cover_image ? {
              backgroundImage: `url(${post.cover_image})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            } : undefined}
          >
            {post.cover_image && (
              <div className={`absolute inset-0 rounded-t-[2rem] ${isDark ? "bg-slate-950/75" : "bg-card/25 backdrop-blur-[1px]"}`} />
            )}

            <div className="relative mb-5 flex flex-wrap items-center gap-2">
              {isOwner && (
                <Badge className={`rounded-full ${post.status === "published" ? "bg-emerald-500/12 text-emerald-600 hover:bg-emerald-500/16 dark:text-emerald-300" : "bg-amber-500/12 text-amber-600 hover:bg-amber-500/16 dark:text-amber-300"}`}>
                  {post.status === "published" ? "已发布" : "草稿"}
                </Badge>
              )}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
                  style={getBlogTagStyle(tag)}
                >
                  <Tags className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>

            <h1 className={`relative max-w-3xl text-4xl font-black leading-tight tracking-[-0.055em] ${isDark && post.cover_image ? "text-white" : "text-foreground"}`}>
              {post.title}
            </h1>

            <div className={`relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 pb-3 text-sm ${isDark && post.cover_image ? "text-white/60" : "text-muted-foreground"}`}>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {date}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Eye className="w-4 h-4" />
                {post.view_count} 次阅读
              </span>
            </div>
          </div>

          <div
            ref={articleRef}
            className="px-6 pb-10 sm:px-10"
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="prose prose-slate dark:prose-invert mt-2 max-w-none text-foreground prose-headings:tracking-[-0.035em] prose-headings:text-foreground prose-p:leading-8 prose-a:text-primary prose-strong:text-foreground prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-2xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-blockquote:rounded-r-2xl prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-img:rounded-2xl prose-img:shadow-lg prose-hr:border-border">
              {patchRenderInfo ? (
                <>
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{patchRenderInfo.before}</Markdown>
                  <div ref={patchAreaRef} className="my-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                    <span className="mb-1 block text-[10px] font-medium text-primary animate-pulse">AI 修改中...</span>
                    <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{patchStreaming?.replacementDelta ?? ""}</Markdown>
                  </div>
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{patchRenderInfo.after}</Markdown>
                </>
              ) : (
                <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{displayContent}</Markdown>
              )}
            </div>
          </div>
        </motion.article>

      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除文章</DialogTitle>
            <DialogDescription>
              确定要删除「{post.title}」吗？这个操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 右键 / 长按菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-xl border border-border/70 bg-card/95 px-1.5 py-1 shadow-2xl backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent/80 transition-colors"
            onClick={handleCopySelection}
          >
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
          {isOwner && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-primary hover:bg-primary/10 transition-colors"
              onClick={handleAIModify}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 修改
            </button>
          )}
        </div>
      )}
    </div>
  );
}
