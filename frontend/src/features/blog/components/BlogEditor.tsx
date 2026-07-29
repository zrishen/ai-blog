import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";
import { createBlogPost, updateBlogPost } from "../../../api/client";
import Vditor from "vditor";
import "vditor/dist/index.css";
import "vditor/dist/js/i18n/zh_CN";
import "./BlogEditor.css";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Save, FileText, Tags, FolderOpen, Trash2, Archive, AlertCircle, Image as ImageIcon, Upload, Wand2, X, GitBranch, ShieldCheck, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import { generateExcerpt } from "../utils/blogExcerpt";
import { getSectionIndexFromSelection } from "../utils/getSectionIndexFromSelection";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_COVERS,
  formatDraftTime,
  recordNumber,
  recordString,
  type DraftInfo,
} from "../utils/blogEditorTypes";
import { expandBlankLines, preserveBlankLines } from "../utils/markdownBlankLines";
import { useBlogResearchContext } from "../hooks/useBlogResearchContext";
import { useBlogCover } from "../hooks/useBlogCover";
import { useBlogDrafts } from "../hooks/useBlogDrafts";
import { useVditorBridge } from "../hooks/useVditorBridge";
import type { BlogPost } from "../types";

function getWysiwygReset(vditor: Vditor): HTMLElement | null {
  return (vditor as unknown as {
    vditor?: { wysiwyg?: { element?: HTMLElement | null } };
  }).vditor?.wysiwyg?.element?.querySelector(".vditor-reset") as HTMLElement | null | undefined ?? null;
}

interface DraftsPanelProps {
  show: boolean;
  position: { top: number; left: number };
  drafts: DraftInfo[];
  draftLoading: boolean;
  onLoad: (draft: DraftInfo) => void;
  onDeleteRequest: (draft: DraftInfo) => void;
}

// 草稿浮层:移动端与桌面端共用同一份列表 UI(原先两处 createPortal 逐字重复)。
function DraftsPanel({ show, position, drafts, draftLoading, onLoad, onDeleteRequest }: DraftsPanelProps) {
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          style={{ position: "fixed", top: position.top, left: position.left, zIndex: 9999 }}
          className="max-h-[min(380px,70dvh)] w-[calc(100vw-2rem)] max-w-[340px] sm:max-h-[380px] overflow-y-auto rounded-panel border border-border/70 bg-popover/96 p-2 shadow-2xl shadow-foreground/15 backdrop-blur-xl sm:min-w-[340px]"
        >
          {drafts.length === 0 ? (
            <div className="rounded-xl border border-border/80 bg-secondary/40 px-5 py-7 text-center text-sm text-muted-foreground">
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
                  <Button size="sm" className="h-7 rounded-full px-3" onClick={() => onLoad(draft)} disabled={draftLoading}>
                    {draftLoading ? "加载中..." : "加载"}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full opacity-100 hover:bg-destructive/10 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" onClick={() => onDeleteRequest(draft)} aria-label={`删除草稿 ${draft.title}`}>
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
  );
}

export function BlogEditor({ onBack }: { onBack?: () => void } = {}) {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();
  const existingPost = state.blogPosts.find((p) => p.id === state.blogCurrentPostId);

  const [title, setTitle] = useState(existingPost?.title || "");
  const [content, setContent] = useState(existingPost?.content || "");
  const [tags, setTags] = useState(existingPost?.tags || "");
  const [coverImage, setCoverImage] = useState(existingPost?.cover_image || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string; sectionIndex: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const skipDirtyOnceRef = useRef(false);
  // AI 修改相关
  const aiModifySavingRef = useRef(false);                    // 防止保存期间重复触发
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  // 表单字段需在切换博文时整体重置；拆分 keyed 子组件成本过大，保留此 effect
  useEffect(() => {
    setTitle(existingPost?.title || "");
    setContent(existingPost?.content || "");
    setTags(existingPost?.tags || "");
    setCoverImage(existingPost?.cover_image || "");
    setError(null);
    isDirtyRef.current = false;
    skipDirtyOnceRef.current = true;
  }, [existingPost?.id]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // 监听字段变化标记 dirty；切换文章时的批量重置通过 skipDirtyOnceRef 跳过一次
  useEffect(() => {
    if (skipDirtyOnceRef.current) {
      skipDirtyOnceRef.current = false;
      return;
    }
    isDirtyRef.current = true;
  }, [title, content, tags, coverImage]);

  const {
    containerId,
    vditorRef,
    vditorReadyRef,
    isProgrammaticChangeRef,
    getEditorElement,
    getContent,
    vditorToolbarReady,
  } = useVditorBridge({
    content,
    setContent,
    existingPost,
    setError,
  });

  // 退出编辑器:工作区内联时走 onBack(回工作区列表);否则切回详情页/列表 + 清 URL ?edit
  const exitEditor = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    dispatch({ type: "SET_BLOG_VIEW", payload: existingPost ? "view" : "list" });
    if (window.location.search) navigate(window.location.pathname, { replace: true });
  }, [onBack, dispatch, existingPost, navigate]);

  // 加载草稿时把后端 post 整体写回表单 + Vditor（桥接逻辑留主组件）
  const applyDraft = useCallback((post: BlogPost) => {
    setTitle(post.title || "");
    setContent(post.content || "");
    setTags(post.tags || "");
    setCoverImage(post.cover_image || "");
    if (vditorReadyRef.current) {
      isProgrammaticChangeRef.current = true;
      setTimeout(() => { isProgrammaticChangeRef.current = false; }, 50);
      vditorRef.current?.setValue(expandBlankLines(post.content || ""));
    }
  }, [vditorRef, vditorReadyRef, isProgrammaticChangeRef]);

  const {
    drafts,
    draftPanelPos,
    showDraftList,
    draftLoading,
    draftDeleting,
    draftDeleteTarget,
    setDraftDeleteTarget,
    lastSaved,
    draftBtnRef,
    draftKey,
    showCancelModal,
    setShowCancelModal,
    loadDraftList,
    handleLoadDraft,
    handleDeleteDraft,
    handleCancel,
    handleSaveDraft,
    handleDiscardDraft,
  } = useBlogDrafts({
    existingPost,
    title,
    content,
    tags,
    coverImage,
    isDirtyRef,
    applyDraft,
    exitEditor,
    onError: setError,
  });

  const handleSave = useCallback(async (targetStatus: "draft" | "published") => {
    if (!title.trim()) {
      setError("请输入文章标题");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rawContent = vditorRef.current?.getValue?.() ?? content;
      const currentContent = vditorRef.current ? preserveBlankLines(getWysiwygReset(vditorRef.current), rawContent) : rawContent;
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
      exitEditor();
    } catch {
      setError("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [title, content, tags, coverImage, existingPost, state.blogPosts, dispatch, draftKey, exitEditor, vditorRef]);

  // ── AI 修改:确保有 postId(新建则静默 create,不切页)──────────────
  const ensurePostId = useCallback(async (): Promise<number | null> => {
    if (existingPost) return existingPost.id;
    if (!title.trim()) { setError("请输入文章标题"); return null; }
    setSaving(true);
    setError(null);
    try {
      const rawC = vditorRef.current?.getValue?.() ?? content;
      const c = vditorRef.current ? preserveBlankLines(getWysiwygReset(vditorRef.current), rawC) : rawC;
      const created = await createBlogPost({
        title: title.trim(),
        content: c,
        excerpt: generateExcerpt(c),
        tags: tags.trim() || undefined,
        status: "draft",
        cover_image: coverImage || null,
      });
      dispatch({ type: "SET_BLOG_POSTS", payload: [created, ...state.blogPosts] });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: created.id });
      localStorage.removeItem(draftKey);
      return created.id;
    } catch {
      setError("保存失败，无法进入 AI 修改");
      return null;
    } finally {
      setSaving(false);
    }
  }, [existingPost, title, content, tags, coverImage, state.blogPosts, dispatch, draftKey, vditorRef]);

  // ── 右键菜单 handler ──────────────────────────────────────────────
  const isSelectionInsideEditor = useCallback((selection: Selection | null, editorEl: HTMLElement | null) => {
    if (!selection || !editorEl || selection.rangeCount === 0) return false;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    const range = selection.getRangeAt(0);
    return (
      (!!anchor && editorEl.contains(anchor))
      || (!!focus && editorEl.contains(focus))
      || editorEl.contains(range.commonAncestorContainer)
    );
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    const editorEl = getEditorElement();
    const sel = window.getSelection();
    // 校验选区落在编辑器内(避免标题/标签等输入框误触)
    if (!isSelectionInsideEditor(sel, editorEl)) {
      setContextMenu(null);
      return;
    }
    const selection = sel?.toString().trim() || "";
    if (selection.length >= 5) {
      e.preventDefault();
      const sectionIndex = getSectionIndexFromSelection(editorEl);
      setContextMenu({ x: e.clientX, y: e.clientY, selectedText: selection, sectionIndex });
    } else {
      setContextMenu(null);
    }
  }, [getEditorElement, isSelectionInsideEditor]);

  const handleEditorTouchStart = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      const editorEl = getEditorElement();
      const sel = window.getSelection();
      if (!isSelectionInsideEditor(sel, editorEl)) return;
      const selection = sel?.toString().trim() || "";
      if (selection.length >= 5) {
        const range = sel!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const sectionIndex = getSectionIndexFromSelection(editorEl);
        setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + 50, selectedText: selection, sectionIndex });
      }
    }, 500);
  }, [getEditorElement, isSelectionInsideEditor]);

  const handleEditorTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCopySelection = useCallback(() => {
    if (!contextMenu) return;
    navigator.clipboard.writeText(contextMenu.selectedText).catch(() => {});
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleEditorAIModify = useCallback(async () => {
    if (!contextMenu || aiModifySavingRef.current) return;
    aiModifySavingRef.current = true;
    const { selectedText, sectionIndex } = contextMenu;
    closeContextMenu();
    try {
      const postId = await ensurePostId();
      if (postId == null) return;
      dispatch({ type: "SET_AI_SELECTION_CONTEXT", payload: { postId, selectedText, sectionIndex } });
      dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    } finally {
      aiModifySavingRef.current = false;
    }
  }, [contextMenu, closeContextMenu, dispatch, ensurePostId]);

  // 点击菜单外关闭(用 mousedown + 捕获,避免被 Vditor 内部 click stopPropagation 拦截)
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      // 点在菜单内不关闭(菜单自身有 stopPropagation,这里再加一层保险)
      const target = e.target as HTMLElement;
      if (target.closest(".fixed.z-50")) return;
      closeContextMenu();
    };
    window.addEventListener("mousedown", handler, true);
    return () => window.removeEventListener("mousedown", handler, true);
  }, [contextMenu, closeContextMenu]);

  const {
    generatingCover,
    uploadingCover,
    tagGenerating,
    handleUploadCover,
    handleGenerateCover,
    handleSuggestTags,
  } = useBlogCover({
    existingPost,
    title,
    getContent,
    onError: setError,
    onCoverChange: setCoverImage,
    onTagsChange: setTags,
  });

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
  const {
    researchLoading,
    researchError,
    linkedTopics,
    adoptedClaims,
    hasResearchContext,
    handleGoResearchGraph,
    handleOpenResearchWriting,
  } = useBlogResearchContext(existingPost);

  useEffect(() => {
    const toolbar = document.getElementById(containerId)?.querySelector<HTMLElement>(".vditor-toolbar");
    if (!toolbar) return;

    let toggleButton = toolbar.querySelector<HTMLButtonElement>(".blog-editor-toolbar-toggle");
    if (!toggleButton) {
      toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "blog-editor-toolbar-toggle";
      toolbar.append(toggleButton);
    }

    const editModeItem = Array.from(toolbar.querySelectorAll<HTMLElement>(".vditor-toolbar__item"))
      .find((item) => item.getAttribute("data-type") === "edit-mode" || /编辑模式|edit-mode/i.test(item.textContent || ""));
    if (editModeItem && editModeItem.previousElementSibling !== toggleButton) {
      editModeItem.insertAdjacentElement("beforebegin", toggleButton);
    }

    toggleButton.hidden = false;

    const maximizeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    const minimizeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

    toggleButton.setAttribute("aria-label", toolbarExpanded ? "收缩文章设置" : "展开文章设置");
    toggleButton.innerHTML = toolbarExpanded ? minimizeSvg : maximizeSvg;
    toggleButton.onclick = () => setToolbarExpanded((v) => !v);

    return () => {
      toggleButton.onclick = null;
    };
  }, [containerId, toolbarExpanded, vditorToolbarReady]);

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [toolbarExpanded]);

  // 回收站清空/永久删除后,若当前编辑的文章已不存在,自动退回列表
  useEffect(() => {
    if (state.trashRevision === 0) return;
    if (state.blogCurrentPostId != null && !state.blogPosts.some((p) => p.id === state.blogCurrentPostId)) {
      dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    }
  }, [state.trashRevision, state.blogCurrentPostId, state.blogPosts, dispatch]);

  useEffect(() => {
    const toolbar = document.getElementById(containerId)?.querySelector<HTMLElement>(".vditor-toolbar");
    if (!toolbar) return;

    let meta = toolbar.querySelector<HTMLElement>(".blog-editor-toolbar-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "blog-editor-toolbar-meta";

      const countSpan = document.createElement("span");
      countSpan.className = "blog-editor-toolbar-meta-count";
      countSpan.textContent = `${wordCount} 字 · ${lineCount} 行`;

      const savedSpan = document.createElement("span");
      savedSpan.className = "blog-editor-toolbar-meta-saved";
      savedSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      const savedText = document.createTextNode("");
      savedSpan.appendChild(savedText);

      meta.append(countSpan, savedSpan);
      toolbar.append(meta);
    }

    const countSpan = meta.querySelector<HTMLElement>(".blog-editor-toolbar-meta-count");
    if (countSpan) countSpan.textContent = `${wordCount} 字 · ${lineCount} 行`;

    const savedSpan = meta.querySelector<HTMLElement>(".blog-editor-toolbar-meta-saved");
    if (savedSpan) {
      const textNode = Array.from(savedSpan.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
      if (textNode) {
        textNode.nodeValue = lastSaved ? `已保存 ${lastSaved}` : "";
      }
      savedSpan.style.display = lastSaved ? "" : "none";
    }
  }, [containerId, vditorToolbarReady, wordCount, lineCount, lastSaved]);

  return (
    <div className="blog-editor-body flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {toolbarExpanded ? (
      <div className="border-b border-border/70 p-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" onClick={handleCancel}>
            <ArrowLeft className="w-4 h-4" />
            返回
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <div ref={draftBtnRef}>
              <Button variant="outline" className="rounded-full bg-background/70" onClick={loadDraftList}>
                <Archive className="w-4 h-4" />
                草稿
              </Button>
              <DraftsPanel
                show={showDraftList}
                position={draftPanelPos}
                drafts={drafts}
                draftLoading={draftLoading}
                onLoad={handleLoadDraft}
                onDeleteRequest={setDraftDeleteTarget}
              />
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
          className="h-auto w-full rounded-surface border border-primary/20 bg-card/95 px-5 py-2 text-2xl font-black tracking-[-0.05em] text-foreground shadow-lg shadow-primary/10 transition-all placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/15 sm:text-2xl md:text-2xl"
          placeholder="输入文章标题..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-0 flex-1 basis-full sm:min-w-[220px] sm:basis-auto">
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
          <div className="mt-2 rounded-surface border border-primary/15 bg-background/64 p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15">
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
              <div className="rounded-panel border border-border/70 bg-card/70 p-3">
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

              <div className="rounded-panel border border-border/70 bg-card/70 p-3">
                <div className="mb-2 text-xs font-bold text-muted-foreground">已采用事实</div>
                {adoptedClaims.length > 0 ? (
                  <div className="space-y-2">
                    {adoptedClaims.slice(0, 3).map((claim, index) => (
                      <div key={`${recordNumber(claim, "id") ?? index}`} className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs leading-relaxed text-foreground">
                        {recordString(claim, "claim_text") || "未命名事实"}
                      </div>
                    ))}
                    {adoptedClaims.length > 3 && <div className="text-caption text-muted-foreground">还有 {adoptedClaims.length - 3} 条事实可在研究图谱查看。</div>}
                  </div>
                ) : (
                  <div className="text-xs leading-relaxed text-muted-foreground">暂无已采用事实。</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 rounded-surface border border-border/70 bg-background/56 p-3">
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
                  className={cn(
                    surfaceVariants({ variant: coverImage === cover ? "selected" : "interactive" }),
                    "h-16 w-28 flex-shrink-0 overflow-hidden rounded-panel",
                    coverImage === cover ? "ring-2 ring-foreground/10" : "bg-card",
                  )}
                  onClick={() => setCoverImage(cover)}
                  aria-label={`选择默认封面 ${index + 1}`}
                >
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <div className="min-h-28 overflow-hidden rounded-panel border border-border/70 bg-card/86">
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
      </div>
      ) : (
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-0.5 text-xs">
        <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground" onClick={handleCancel}>
          <ArrowLeft className="w-3 h-3" />
          返回
        </Button>
        <Input
          className="h-7 min-w-[120px] flex-1 appearance-none rounded-full border border-solid border-input bg-background shadow-sm px-3 text-xs text-foreground placeholder:text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="输入文章标题..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div ref={draftBtnRef}>
          <Button variant="outline" size="sm" className="h-7 rounded-full px-2 text-xs" onClick={loadDraftList}>
            <Archive className="w-3 h-3" />
            草稿
          </Button>
          <DraftsPanel
            show={showDraftList}
            position={draftPanelPos}
            drafts={drafts}
            draftLoading={draftLoading}
            onLoad={handleLoadDraft}
            onDeleteRequest={setDraftDeleteTarget}
          />
        </div>
        <Button variant="outline" size="sm" className="h-7 rounded-full px-2 text-xs" onClick={() => handleSave("draft")} disabled={saving}>
          <FileText className="w-3 h-3" />
          保存草稿
        </Button>
        <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => handleSave("published")} disabled={saving}>
          <Save className="w-3 h-3" />
          {saving ? "保存中..." : existingPost ? "更新文章" : "发布文章"}
        </Button>
      </div>
      )}

      {error && (
        <Alert variant="destructive" className="m-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </Alert>
      )}

      <div
        className="vditor-wrapper min-h-0 flex-1 overflow-hidden relative"
        onContextMenu={handleEditorContextMenu}
        onTouchStart={handleEditorTouchStart}
        onTouchEnd={handleEditorTouchEnd}
      >
        <div id={containerId} className="h-full" />
      </div>
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

      <Dialog open={draftDeleteTarget !== null} onOpenChange={(open) => { if (!open && !draftDeleting) setDraftDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除草稿</DialogTitle>
            <DialogDescription>
              确定要删除「{draftDeleteTarget?.title || "未命名草稿"}」吗？删除后可在回收站恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftDeleteTarget(null)} disabled={draftDeleting}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteDraft} disabled={draftDeleting}>
              {draftDeleting ? "删除中..." : "删除草稿"}
            </Button>
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
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-meta text-primary hover:bg-primary/10 transition-colors"
            onClick={handleEditorAIModify}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 修改
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
