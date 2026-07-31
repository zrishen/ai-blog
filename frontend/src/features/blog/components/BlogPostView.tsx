import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { cn } from "../../../lib/utils";
import { useChat } from "../../../stores/chatStore";
import { deleteBlogPost, publishBlogPost } from "../../../api/client";
import type { BlogPostData } from "../../../api/blog";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { motion } from "motion/react";
import { ArrowLeft, Pencil, Trash2, Globe, EyeOff, Calendar, Eye, Tags, AlertCircle, FileText, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getBlogTagStyle, splitBlogTags } from "../utils/blogTags";
import { getSectionIndexFromSelection } from "../utils/getSectionIndexFromSelection";
import { expandBlankLines } from "../utils/markdownBlankLines";
import { MermaidBlock } from "@/components/MermaidBlock";
import { extractCodeLanguage, extractCodeText } from "@/utils/mermaidCode";

// 代码语言 class → 展示名(与编辑器语言选项保持一致)
const CODE_LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  json: "JSON",
  bash: "Bash",
  sh: "Bash",
  shell: "Bash",
  css: "CSS",
  html: "HTML",
  xml: "XML",
  markdown: "Markdown",
  md: "Markdown",
  java: "Java",
  cpp: "C++",
  c: "C",
  go: "Go",
  rust: "Rust",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  dockerfile: "Dockerfile",
};

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
  previewPost?: BlogPostData;
  onBack?: () => void;
}

function resolveMarkdownImageSrc(src?: string) {
  if (!src) return "";
  const value = src.trim();
  if (
    /^(?:https?:)?\/\//i.test(value)
    || /^(?:data|blob):/i.test(value)
    || value.startsWith("/")
    || value.startsWith("#")
  ) {
    return value;
  }

  const filename = value.replace(/^\.?\//, "");
  if (/^[^/?#]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(filename)) {
    return `/api/v1/uploads/${encodeURIComponent(filename)}`;
  }
  return value;
}

export function BlogPostView({ username, isOwner = true, previewPost, onBack }: BlogPostViewProps) {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();
  const isPreview = previewPost !== undefined;
  const post = previewPost ?? state.blogPosts.find((p) => p.id === state.blogCurrentPostId);
  const isDark = state.theme === "dark";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamingState = !isPreview && post ? state.blogStreamingByPostId[post.id] : undefined;
  const isStreaming = Boolean(streamingState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string; sectionIndex: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingState?.content, isStreaming]);

  const streamingContent = streamingState?.content;
  const postTitle = post?.title;
  const postContent = post?.content;
  const rawDisplayContent = useMemo(() => {
    // 流式内容优先（AI 正在编辑时）
    if (streamingContent) {
      return streamingContent;
    }
    if (!postTitle || !postContent) return postContent || "";
    const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");
    const normalizedTitle = normalizeText(postTitle);
    if (!normalizedTitle) return postContent;
    return postContent.replace(/^\s*#(?!#)\s+(.+?)\s*#?\s*(?:\r?\n|$)/, (match, headingText) => {
      const normalizedHeading = normalizeText(headingText);
      return normalizedHeading === normalizedTitle ? "" : match;
    });
  }, [postTitle, postContent, streamingContent]);
  const displayContent = useMemo(() => expandBlankLines(rawDisplayContent), [rawDisplayContent]);

  const patchStreaming = !isPreview && post ? state.blogPatchStreamingByPostId[post.id] : undefined;
  const patchRenderInfo = useMemo(() => {
    if (!patchStreaming || !patchStreaming.targetText) return null;
    if (!rawDisplayContent.includes(patchStreaming.targetText)) return null;
    const idx = rawDisplayContent.indexOf(patchStreaming.targetText);
    return {
      before: rawDisplayContent.slice(0, idx),
      target: patchStreaming.targetText,
      replacement: patchStreaming.replacementDelta || "",
    };
  }, [patchStreaming, rawDisplayContent]);

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
    img: ({ src, alt, ...props }: { src?: string; alt?: string }) => (
      <img src={resolveMarkdownImageSrc(src)} alt={alt || ""} loading="lazy" {...props} />
    ),
    pre: ({ children, node, ...props }: { children?: React.ReactNode; node?: unknown }) => {
      // 注意:node 是 react-markdown 传入的 hast 节点引用,不可透传到 DOM
      void node;
      const language = extractCodeLanguage(children);
      if (language === "mermaid") {
        return <MermaidBlock code={extractCodeText(children)} />;
      }
      const label = language ? CODE_LANGUAGE_LABELS[language] ?? language : "文本";
      return (
        <div className="blog-post-code-block">
          <div className="blog-post-code-header" data-language={language || "text"}>
            <span>{label}</span>
          </div>
          <pre {...props}>{children}</pre>
        </div>
      );
    },
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
    if (!isOwner || isPreview) return;
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
    // 带 ?edit 标记,刷新后仍留在编辑页
    navigate(`?edit`, { replace: true });
  }, [dispatch, isOwner, isPreview, navigate]);

  const handleConfirmDelete = useCallback(async () => {
    if (!post || !isOwner || isPreview) return;
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
  }, [post, isOwner, isPreview, state.blogPosts, dispatch, username, navigate]);

  const handlePublish = useCallback(async () => {
    if (!post || !isOwner || isPreview) return;
    const newStatus = post.status !== "published";
    try {
      const updated = await publishBlogPost(post.id, newStatus);
      dispatch({
        type: "SET_BLOG_POSTS",
        payload: state.blogPosts.map((p) => (p.id === post.id ? { ...p, status: updated.status, published_at: updated.published_at } : p)),
      });
      dispatch({ type: "SET_WORKSPACE_BLOG_STATUS", payload: { id: updated.id, status: updated.status } });
      setError(null);
    } catch {
      setError("操作失败，请稍后重试");
    }
  }, [post, isOwner, isPreview, state.blogPosts, dispatch]);

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    if (username) navigate(`/u/${encodeURIComponent(username)}`);
  }, [onBack, dispatch, navigate, username]);

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!isOwner || !post) { setContextMenu(null); return; }
    const selection = window.getSelection()?.toString().trim() || "";
    if (selection.length >= 5) {
      const sectionIndex = getSectionIndexFromSelection(articleRef.current);
      setContextMenu({ x: e.clientX, y: e.clientY, selectedText: selection, sectionIndex });
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
        const sectionIndex = getSectionIndexFromSelection(articleRef.current);
        setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + 50, selectedText: selection, sectionIndex });
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
      payload: { postId: post.id, selectedText: contextMenu.selectedText, sectionIndex: contextMenu.sectionIndex },
    });
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    closeContextMenu();
  }, [contextMenu, post, dispatch, closeContextMenu]);

  // 点击菜单外关闭(用 mousedown + 捕获,确保在各种容器下都能关闭)
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".fixed.z-50")) return;
      closeContextMenu();
    };
    window.addEventListener("mousedown", handler, true);
    return () => window.removeEventListener("mousedown", handler, true);
  }, [contextMenu, closeContextMenu]);

  if (!post) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="border border-border/70 bg-card/80 px-10 py-9 text-center shadow-xl shadow-foreground/5">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-panel bg-primary/10 text-primary">
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
    <div ref={scrollRef} className="flex-1 h-full min-h-full overflow-y-auto" onClick={closeContextMenu}>
      <div className="w-full min-w-0">
        <motion.article
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={cn(
            "relative overflow-hidden",
            isStreaming && "border-l-2 border-l-primary/60 animate-pulse"
          )}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {isStreaming && (
            <span className="absolute -left-1 -top-1 z-10 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              AI 编辑中
            </span>
          )}

          <div
            className="relative px-4 pt-4 sm:px-10 sm:pt-5 pb-0"
            style={post.cover_image ? {
              backgroundImage: `url(${post.cover_image})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            } : undefined}
          >
            {post.cover_image && (
              <div className={`absolute inset-0 ${isDark ? "bg-black/75" : "bg-white/10"}`} />
            )}

            <div className={`relative mb-5 flex flex-wrap items-center justify-between gap-2 ${isDark && post.cover_image ? "[&_button]:text-white/85 [&_button]:border-white/25 [&_button:hover]:bg-white/10 [&_.text-muted-foreground]:text-white/70" : ""}`}>
              <Button variant="ghost" className="h-7 rounded-full px-2.5 text-body text-muted-foreground hover:text-foreground" onClick={goBack}>
                <ArrowLeft className="w-3 h-3" />
                返回
              </Button>
              {isOwner && !isPreview && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {error && (
                    <Badge variant="destructive" className="gap-1 rounded-full px-2 py-1 text-caption">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </Badge>
                  )}
                  <Button variant="outline" className="h-7 rounded-full bg-background/70 px-2.5 text-body" onClick={handleEdit}>
                    <Pencil className="w-3 h-3" />
                    编辑
                  </Button>
                  <Button variant="outline" className="h-7 rounded-full bg-background/70 px-2.5 text-body" onClick={handlePublish}>
                    {post.status === "published" ? (
                      <><EyeOff className="w-3 h-3" /> 取消发布</>
                    ) : (
                      <><Globe className="w-3 h-3" /> 发布</>
                    )}
                  </Button>
                  <Button variant="destructive" className="h-7 rounded-full px-2.5 text-body" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="w-3 h-3" />
                    删除
                  </Button>
                </div>
              )}
            </div>

            <div className="relative mb-5 flex flex-wrap items-center gap-2">
              {isOwner && !isPreview && (
                <Badge variant={post.status === "published" ? "success" : "warning"} className="rounded-full">
                  {post.status === "published" ? "已发布" : "草稿"}
                </Badge>
              )}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-fine font-semibold"
                  style={getBlogTagStyle(tag)}
                >
                  <Tags className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>

            <h1 className={`relative max-w-none text-3xl font-black leading-tight tracking-[-0.055em] sm:text-4xl ${isDark && post.cover_image ? "text-white" : "text-foreground"}`}>
              {post.title}
            </h1>

            <div className={`relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 pb-3 text-body ${isDark && post.cover_image ? "text-white/60" : "text-muted-foreground"}`}>
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
            className="px-4 pb-10 sm:px-10"
          >
            <div className="prose prose-slate dark:prose-invert mt-2 max-w-none text-foreground prose-headings:tracking-[-0.035em] prose-headings:text-foreground prose-p:mt-0 prose-p:mb-[0.92em] prose-p:leading-[1.86] prose-a:text-primary prose-strong:text-foreground prose-code:rounded-control prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-pre:m-0 prose-pre:rounded-none prose-pre:border-0 prose-pre:bg-transparent prose-pre:p-0 prose-blockquote:rounded-r-2xl prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-img:rounded-panel prose-img:shadow-lg prose-hr:border-border">
              {patchRenderInfo ? (
                <>
                  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>{expandBlankLines(patchRenderInfo.before)}</Markdown>
                  <div className="ai-patch-inline my-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 not-prose">
                    <div className="ai-patch-inline__label mb-2 text-fine font-medium text-primary">AI 修改中...</div>
                    <div className="ai-patch-inline__text text-foreground whitespace-pre-wrap">
                      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>{expandBlankLines(patchRenderInfo.replacement)}</Markdown>
                    </div>
                  </div>
                  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>{expandBlankLines(rawDisplayContent.slice(patchRenderInfo.before.length + patchRenderInfo.target.length))}</Markdown>
                </>
              ) : (
                <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>{displayContent}</Markdown>
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
              确定要删除「{post.title}」吗？删除后可在回收站恢复。
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

      {/* 右键 / 长按菜单:用 Portal 渲染到 body,避免被祖先 backdrop-filter 破坏 fixed 定位 */}
      {contextMenu && createPortal(
        <div
          className="fixed z-50 min-w-[160px] rounded-xl border border-border/70 bg-card/95 px-1.5 py-1 shadow-2xl backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-meta text-foreground hover:bg-accent/80 transition-colors"
            onClick={handleCopySelection}
          >
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
          {isOwner && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-meta text-primary hover:bg-primary/10 transition-colors"
              onClick={handleAIModify}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 修改
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
