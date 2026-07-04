import { useState, useRef, useEffect, useCallback } from "react";
import type { ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../stores/chatStore";
import { createBlogPost, deleteBlogPost, generateBlogCover, getBlogPost, getBlogResearchSummary, getResearchTopic, listBlogPosts, suggestBlogTags, updateBlogPost, uploadFile, type BlogResearchSummary } from "../../api/client";
import Vditor from "vditor";
import "vditor/dist/index.css";
import "./BlogEditor.css";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Save, FileText, Tags, FolderOpen, Clock, Trash2, Archive, AlertCircle, Image as ImageIcon, Upload, Wand2, X, ChevronDown, ChevronUp, GitBranch, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_COVERS = Array.from({ length: 10 }, (_, index) => `/blog-covers/cover-${String(index + 1).padStart(2, "0")}.svg`);

interface DraftInfo {
  id: number;
  title: string;
  time: string;
}

function formatSaveTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDraftTime(dateStr: string) {
  if (!dateStr) return "未知时间";
  return new Date(dateStr).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function recordString(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === "string" ? value : "";
}

function recordNumber(item: Record<string, unknown>, key: string) {
  const value = item[key];
  return typeof value === "number" ? value : null;
}

function generateExcerpt(markdown: string): string {
  const text = markdown
    .replace(/^#+\s.+$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`>\[\]!|~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= 128 ? text : text.substring(0, 128) + "…";
}

export function BlogEditor() {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();
  const existingPost = state.blogPosts.find((p) => p.id === state.blogCurrentPostId);

  const [title, setTitle] = useState(existingPost?.title || "");
  const [content, setContent] = useState(existingPost?.content || "");
  const [tags, setTags] = useState(existingPost?.tags || "");
  const [coverImage, setCoverImage] = useState(existingPost?.cover_image || "");
  const [saving, setSaving] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [tagGenerating, setTagGenerating] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [lastSaved, setLastSaved] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDraftList, setShowDraftList] = useState(false);
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [draftPanelPos, setDraftPanelPos] = useState({ top: 0, left: 0 });
  const [draftLoading, setDraftLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researchSummary, setResearchSummary] = useState<BlogResearchSummary | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftBtnRef = useRef<HTMLDivElement>(null);
  const draftKey = `draft_blog_${existingPost?.id || "new"}`;
  const vditorRef = useRef<Vditor | null>(null);
  const vditorReadyRef = useRef(false);
  const containerIdRef = useRef(`vditor-${Math.random().toString(36).slice(2, 10)}`);
  const isProgrammaticChange = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(existingPost?.title || "");
    setContent(existingPost?.content || "");
    setTags(existingPost?.tags || "");
    setCoverImage(existingPost?.cover_image || "");
    setError(null);
  }, [existingPost?.id]);

  useEffect(() => {
    if (!existingPost?.id) {
      setResearchSummary(null);
      setResearchError(null);
      setResearchLoading(false);
      return;
    }
    let cancelled = false;
    setResearchLoading(true);
    setResearchError(null);
    getBlogResearchSummary(existingPost.id)
      .then((summary) => {
        if (!cancelled) setResearchSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setResearchError("事实依据加载失败，请稍后重试");
      })
      .finally(() => {
        if (!cancelled) setResearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [existingPost?.id]);

  useEffect(() => {
    if (!vditorReadyRef.current) return;
    const newContent = existingPost?.content || "";
    isProgrammaticChange.current = true;
    const safety = setTimeout(() => { isProgrammaticChange.current = false; }, 50);
    vditorRef.current?.setValue(newContent);
    return () => clearTimeout(safety);
  }, [existingPost?.id]);

  useEffect(() => {
    const container = document.getElementById(containerIdRef.current);
    if (container) {
      container.innerHTML = "";
    }
    const vd = new Vditor(containerIdRef.current, {
      mode: "wysiwyg",
      theme: state.theme === "dark" ? "dark" : "classic",
      value: content,
      placeholder: "开始写文章...",
      minHeight: 0,
      toolbar: [
        "headings", "bold", "italic", "strike", "|",
        "list", "ordered-list", "check", "quote", "|",
        "code", "inline-code", "link", "table", "|",
        "undo", "redo", "|",
        "edit-mode",
      ],
      preview: { actions: [], mode: "editor" },
      cache: { enable: false },
      input(val) {
        if (isProgrammaticChange.current) {
          isProgrammaticChange.current = false;
          return;
        }
        setContent(val);
      },
      after() {
        vditorRef.current = vd;
        vditorReadyRef.current = true;
        window.VditorI18n.splitView = "源码模式";
        document.querySelectorAll('.vditor-panel button[data-mode="sv"]').forEach(el => {
          el.textContent = "源码模式 <⌥⌘9>";
        });
      },
    });
    vditorRef.current = vd;
    return () => {
      vditorReadyRef.current = false;
      try {
        vditorRef.current?.destroy();
      } catch {}
      vditorRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用 MutationObserver 强制约束 Vditor 高度，覆盖 JS 内联样式
  useEffect(() => {
    const el = document.querySelector(`.blog-editor-body .vditor`) as HTMLElement | null;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const constrain = () => {
      const h = parent.clientHeight + 'px';
      el.style.setProperty('height', h, 'important');
    };

    constrain();
    const ro = new ResizeObserver(constrain);
    ro.observe(parent);

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          constrain();
          break;
        }
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ['style'] });

    return () => { ro.disconnect(); mo.disconnect(); };
  }, [vditorReadyRef.current]);

  useEffect(() => {
    if (!vditorReadyRef.current) return;
    const theme = state.theme === "dark" ? "dark" : "classic";
    vditorRef.current?.setTheme(theme, theme, "native");
  }, [state.theme]);

  useEffect(() => {
    if (!title.trim() && !content.trim() && !coverImage) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify({
        title, content, tags, coverImage,
        _savedAt: new Date().toISOString(),
      }));
      setLastSaved(formatSaveTime());
    }, 2000);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, tags, coverImage, draftKey]);

  const handleSave = useCallback(async (targetStatus: "draft" | "published") => {
    if (!title.trim()) {
      setError("请输入文章标题");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const currentContent = vditorRef.current?.getValue?.() ?? content;
      const data = {
        title: title.trim(),
        content: currentContent,
        excerpt: generateExcerpt(currentContent),
        tags: tags.trim() || undefined,
        status: targetStatus,
        cover_image: coverImage || null,
      };

      if (existingPost) {
        const updated = await updateBlogPost(existingPost.id, data);
        dispatch({ type: "UPDATE_BLOG_POST", payload: updated });
      } else {
        const created = await createBlogPost(data);
        dispatch({ type: "SET_BLOG_POSTS", payload: [created, ...state.blogPosts] });
        dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: created.id });
      }
      localStorage.removeItem(draftKey);
      dispatch({ type: "SET_BLOG_VIEW", payload: existingPost ? "view" : "list" });
    } catch {
      setError("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [title, content, tags, coverImage, existingPost, state.blogPosts, dispatch, draftKey]);

  const handleCancel = useCallback(() => {
    let currentContent = content;
    try {
      currentContent = vditorRef.current?.getValue?.() ?? content;
    } catch {
      currentContent = content;
    }

    const hasUnsavedChanges =
      title !== (existingPost?.title || "") ||
      currentContent !== (existingPost?.content || "") ||
      tags !== (existingPost?.tags || "") ||
      coverImage !== (existingPost?.cover_image || "");

    if (hasUnsavedChanges) {
      setShowCancelModal(true);
    } else {
      localStorage.removeItem(draftKey);
      dispatch({ type: "SET_BLOG_VIEW", payload: existingPost ? "view" : "list" });
    }
  }, [title, content, tags, coverImage, draftKey, existingPost, dispatch]);

  const handleSaveDraft = useCallback(() => {
    localStorage.setItem(draftKey, JSON.stringify({
      title, content, tags, coverImage,
      _savedAt: new Date().toISOString(),
    }));
    setShowCancelModal(false);
    dispatch({ type: "SET_BLOG_VIEW", payload: existingPost ? "view" : "list" });
  }, [title, content, tags, coverImage, draftKey, existingPost, dispatch]);

  const handleDiscardDraft = useCallback(() => {
    localStorage.removeItem(draftKey);
    setShowCancelModal(false);
    dispatch({ type: "SET_BLOG_VIEW", payload: existingPost ? "view" : "list" });
  }, [draftKey, existingPost, dispatch]);

  const handleSuggestTags = useCallback(async () => {
    const currentContent = vditorRef.current?.getValue?.() ?? content;
    if (!currentContent.trim()) {
      setError("请先输入文章内容，再生成标签");
      return;
    }
    let postId = existingPost?.id;
    setTagGenerating(true);
    setError(null);
    try {
      if (!postId) {
        const data = {
          title: title.trim() || "未命名草稿",
          content: currentContent,
          excerpt: generateExcerpt(currentContent),
          status: "draft" as const,
        };
        const created = await createBlogPost(data);
        dispatch({ type: "SET_BLOG_POSTS", payload: [created, ...state.blogPosts] });
        dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: created.id });
        postId = created.id;
      }
      const suggested = await suggestBlogTags(postId);
      if (suggested.length > 0) {
        setTags(suggested.join(", "));
      } else {
        setError("未能生成有效标签，请手动输入");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI 生成标签失败";
      setError(msg);
    } finally {
      setTagGenerating(false);
    }
  }, [content, title, existingPost, state.blogPosts, dispatch]);

  const loadDraftList = useCallback(async () => {
    if (showDraftList) {
      setShowDraftList(false);
      return;
    }

    setError(null);
    try {
      const data = await listBlogPosts({ status: "draft", per_page: 50 });
      const serverDrafts: DraftInfo[] = data.posts.map((post) => ({
        id: post.id,
        title: post.title || "未命名草稿",
        time: post.updated_at || post.created_at || "",
      }));
      setDrafts(serverDrafts);
      if (draftBtnRef.current) {
        const rect = draftBtnRef.current.getBoundingClientRect();
        setDraftPanelPos({ top: rect.bottom + 8, left: rect.right - 340 });
      }
      setShowDraftList(true);
    } catch {
      setDrafts([]);
      setShowDraftList(true);
      setError("草稿列表加载失败，请稍后重试");
    }
  }, [showDraftList]);

  const handleLoadDraft = useCallback(async (draft: DraftInfo) => {
    setDraftLoading(true);
    try {
      const post = await getBlogPost(draft.id);
      dispatch({
        type: "SET_BLOG_POSTS",
        payload: state.blogPosts.some((p) => p.id === post.id)
          ? state.blogPosts.map((p) => (p.id === post.id ? { ...p, ...post } : p))
          : [post, ...state.blogPosts],
      });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: post.id });
      setTitle(post.title || "");
      setContent(post.content || "");
      setTags(post.tags || "");
      setCoverImage(post.cover_image || "");
      if (vditorReadyRef.current) {
        isProgrammaticChange.current = true;
        setTimeout(() => { isProgrammaticChange.current = false; }, 50);
        vditorRef.current?.setValue(post.content || "");
      }
      setError(null);
      setShowDraftList(false);
    } catch {
      setError("草稿加载失败，请稍后重试");
    } finally {
      setDraftLoading(false);
    }
  }, [dispatch, state.blogPosts]);

  const handleDeleteDraft = useCallback(async (draftId: number) => {
    try {
      await deleteBlogPost(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      dispatch({ type: "SET_BLOG_POSTS", payload: state.blogPosts.filter((p) => p.id !== draftId) });
    } catch {
      setError("删除草稿失败");
    }
  }, [dispatch, state.blogPosts]);

  const handleUploadCover = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    setUploadingCover(true);
    setError(null);
    try {
      const uploaded = await uploadFile(file);
      setCoverImage(uploaded.download_url);
    } catch {
      setError("上传封面失败，请确认图片格式后重试");
    } finally {
      setUploadingCover(false);
    }
  }, []);

  const handleGenerateCover = useCallback(async () => {
    if (!existingPost) {
      setError("请先保存文章，再使用 AI 生成封面");
      return;
    }
    setGeneratingCover(true);
    setError(null);
    try {
      const updated = await generateBlogCover(existingPost.id);
      setCoverImage(updated.cover_image || "");
      dispatch({
        type: "SET_BLOG_POSTS",
        payload: state.blogPosts.map((p) => (p.id === existingPost.id ? { ...p, ...updated } : p)),
      });
    } catch {
      setError("AI 生成封面失败，请检查图片模型配置后重试");
    } finally {
      setGeneratingCover(false);
    }
  }, [existingPost, state.blogPosts, dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave(existingPost?.status === "published" ? "published" : "draft");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleSave, existingPost?.status]);

  const wordCount = content.replace(/\s/g, "").length;
  const lineCount = content ? content.split("\n").length : 1;
  const linkedTopics = researchSummary?.topics ?? [];
  const adoptedClaims = researchSummary?.claims ?? [];
  const fallbackTopicId = state.researchCurrentTopicId ?? (linkedTopics[0] ? recordNumber(linkedTopics[0], "id") : null);
  const hasResearchContext = Boolean(existingPost || state.researchCurrentTopic || state.trustWritingEnabled || linkedTopics.length || adoptedClaims.length);

  const ensureResearchTopicContext = useCallback(async () => {
    if (!fallbackTopicId || fallbackTopicId === state.researchCurrentTopicId) return;
    dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: fallbackTopicId });
    try {
      const detail = await getResearchTopic(fallbackTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {}
  }, [dispatch, fallbackTopicId, state.researchCurrentTopicId]);

  const handleGoResearchGraph = () => {
    dispatch({ type: "SET_PAGE", payload: "research" });
    navigate(fallbackTopicId ? `/research/${fallbackTopicId}` : "/research");
  };

  const handleOpenResearchWriting = useCallback(async (choiceMode: "open" | "draft") => {
    await ensureResearchTopicContext();
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: true });
    dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: choiceMode === "draft" ? "draft_research_choices" : "open_research_choices" });
  }, [dispatch, ensureResearchTopicContext]);

  return (
    <div className="blog-editor-body flex h-full flex-1 flex-col overflow-hidden px-2 py-2">
      <div className="mb-2 rounded-[2rem] border border-border/70 bg-card/88 p-2 shadow-xl shadow-foreground/5 backdrop-blur-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" onClick={handleCancel}>
            <ArrowLeft className="w-4 h-4" />
            返回
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {lastSaved && (
              <Badge variant="secondary" className="rounded-full bg-secondary/80 text-muted-foreground">
                <Clock className="w-3 h-3" />
                已保存 {lastSaved}
              </Badge>
            )}
            <div ref={draftBtnRef}>
              <Button variant="outline" className="rounded-full bg-background/70" onClick={loadDraftList}>
                <Archive className="w-4 h-4" />
                草稿
              </Button>
              {createPortal(
                <AnimatePresence>
                  {showDraftList && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.18 }}
                      style={{ position: "fixed", top: draftPanelPos.top, left: draftPanelPos.left, zIndex: 9999 }}
                      className="max-h-[380px] min-w-[340px] overflow-y-auto rounded-2xl border border-border/70 bg-popover/96 p-2 shadow-2xl shadow-foreground/15 backdrop-blur-xl"
                    >
                      {drafts.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/80 bg-secondary/40 px-5 py-7 text-center text-sm text-muted-foreground">
                          暂无草稿
                        </div>
                      ) : (
                        drafts.map((draft) => (
                          <div key={draft.id} className="group flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-accent">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">{draft.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {formatDraftTime(draft.time)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" className="h-7 rounded-full px-3" onClick={() => handleLoadDraft(draft)} disabled={draftLoading}>
                                {draftLoading ? "加载中..." : "加载"}
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDeleteDraft(draft.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>,
                document.body
              )}
            </div>
            <Button variant="outline" className="rounded-full bg-background/70" onClick={() => handleSave("draft")} disabled={saving}>
              <FileText className="w-4 h-4" />
              保存草稿
            </Button>
            <Button className="rounded-full px-5 shadow-lg shadow-primary/20" onClick={() => handleSave("published")} disabled={saving}>
              <Save className="w-4 h-4" />
              {saving ? "保存中..." : existingPost ? "更新文章" : "发布文章"}
            </Button>
          </div>
        </div>

        <Input
          className="h-auto w-full rounded-3xl border border-primary/20 bg-card/95 px-5 py-2 text-2xl font-black tracking-[-0.05em] text-foreground shadow-lg shadow-primary/10 transition-all placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/15 sm:text-2xl md:text-2xl"
          placeholder="输入文章标题..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              展开详情
            </>
          ) : (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              折叠
            </>
          )}
        </button>

        {!collapsed && (
        <>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Tags className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 rounded-full border-border bg-secondary/65 pl-9 pr-20 text-sm shadow-none"
              placeholder="标签（逗号分隔）"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              className={`absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-full px-2 text-xs ${
                tagGenerating || !content.trim() ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={handleSuggestTags}
              disabled={tagGenerating || !content.trim()}
            >
              <Wand2 className={`mr-1 h-3 w-3 ${tagGenerating ? "animate-spin" : ""}`} />
              {tagGenerating ? "生成中..." : "AI 生成"}
            </Button>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            <FolderOpen className="w-3.5 h-3.5" />
            {wordCount} 字 · {lineCount} 行
          </span>
        </div>

        {hasResearchContext && (
          <div className="mt-5 rounded-[1.5rem] border border-primary/15 bg-background/64 p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-black tracking-[-0.03em] text-foreground">事实依据</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    关联的研究主题和已确认事实，发布后不会公开展示。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="rounded-full bg-card/80" onClick={handleGoResearchGraph}>
                  <GitBranch className="h-3.5 w-3.5" />
                  去研究图谱审核
                </Button>
                <Button
                  variant={state.trustWritingEnabled ? "default" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => handleOpenResearchWriting("open")}
                >
                  打开研究写作
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full bg-card/80"
                  onClick={() => handleOpenResearchWriting("draft")}
                >
                  用已确认事实写草稿
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="mb-2 text-xs font-bold text-muted-foreground">关联研究主题</div>
                {researchLoading ? (
                  <div className="text-xs text-muted-foreground">正在加载事实依据...</div>
                ) : researchError ? (
                  <div className="text-xs text-destructive">{researchError}</div>
                ) : linkedTopics.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {linkedTopics.map((topic, index) => (
                      <Badge key={`${recordNumber(topic, "id") ?? index}`} variant="secondary" className="rounded-full bg-secondary/80">
                        {recordString(topic, "title") || `研究主题 ${index + 1}`}
                        {recordString(topic, "status") && <span className="ml-1 text-muted-foreground">· {recordString(topic, "status")}</span>}
                      </Badge>
                    ))}
                  </div>
                ) : state.researchCurrentTopic ? (
                  <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary">
                    当前上下文：{state.researchCurrentTopic.title}
                  </Badge>
                ) : (
                  <div className="text-xs leading-relaxed text-muted-foreground">暂无关联主题，可在研究图谱中创建。</div>
                )}
              </div>

              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="mb-2 text-xs font-bold text-muted-foreground">已采用事实</div>
                {adoptedClaims.length > 0 ? (
                  <div className="space-y-2">
                    {adoptedClaims.slice(0, 3).map((claim, index) => (
                      <div key={`${recordNumber(claim, "id") ?? index}`} className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs leading-relaxed text-foreground">
                        {recordString(claim, "claim_text") || "未命名事实"}
                      </div>
                    ))}
                    {adoptedClaims.length > 3 && <div className="text-[11px] text-muted-foreground">还有 {adoptedClaims.length - 3} 条事实可在研究图谱查看。</div>}
                  </div>
                ) : (
                  <div className="text-xs leading-relaxed text-muted-foreground">暂无已采用事实。</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-[1.5rem] border border-border/70 bg-background/56 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-bold text-foreground">
                <ImageIcon className="h-4 w-4 text-primary" />
                文章封面
              </div>
              <p className="mt-1 text-xs text-muted-foreground">可使用 AI 生成、上传图片、选择默认图，也可以不设置封面。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleUploadCover} />
              <Button variant="outline" size="sm" className="rounded-full" disabled={uploadingCover} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                {uploadingCover ? "上传中..." : "上传图片"}
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" disabled={generatingCover} onClick={handleGenerateCover}>
                <Wand2 className={`h-3.5 w-3.5 ${generatingCover ? "animate-spin" : ""}`} />
                {generatingCover ? "生成中..." : "AI 生成"}
              </Button>
              {coverImage && (
                <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setCoverImage("")}>
                  <X className="h-3.5 w-3.5" />
                  移除图片
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {DEFAULT_COVERS.map((cover, index) => (
                <button
                  key={cover}
                  type="button"
                  className={`h-16 w-28 flex-shrink-0 overflow-hidden rounded-2xl border bg-card transition-all hover:border-primary/50 ${coverImage === cover ? "border-primary ring-2 ring-primary/20" : "border-border/70"}`}
                  onClick={() => setCoverImage(cover)}
                  aria-label={`选择默认封面 ${index + 1}`}
                >
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <div className="min-h-28 overflow-hidden rounded-2xl border border-border/70 bg-card/86">
              {coverImage ? (
                <img src={coverImage} alt="当前封面" className="h-full min-h-28 w-full object-cover" />
              ) : (
                <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 border border-dashed border-border/80 text-xs text-muted-foreground">
                  <ImageIcon className="h-5 w-5" />
                  无封面，发布后白底显示
                </div>
              )}
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="vditor-wrapper min-h-0 flex-1 overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/92 p-2 shadow-xl shadow-foreground/5 relative">
        <div id={containerIdRef.current} className="h-full" />
      </div>

      <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>是否保存草稿？</DialogTitle>
            <DialogDescription>
              离开编辑器前，可以保存当前内容为草稿，或直接放弃这些未发布改动。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={handleDiscardDraft}>不保存</Button>
            <DialogClose asChild>
              <Button variant="outline">继续编辑</Button>
            </DialogClose>
            <Button onClick={handleSaveDraft}>保存草稿</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
