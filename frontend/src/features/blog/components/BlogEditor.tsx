import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useChat } from "../../../stores/chatStore";
import { publishBlogPost } from "../../../api/client";
import type { BlogPostData, BlogRevision, BlogRevisionSummary } from "../../../api/blog";
import "vditor/dist/index.css";
import "vditor/dist/js/i18n/zh_CN";
import "./BlogEditor.css";
import { ArrowLeft, Save, Tags, FolderOpen, Archive, AlertCircle, Eye, Image as ImageIcon, Upload, Wand2, X, GitBranch, ShieldCheck, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import { isSafeInternalPath } from "@/lib/routing";
import { getSectionIndexFromSelection } from "../utils/getSectionIndexFromSelection";
import { DEFAULT_COVERS, recordNumber, recordString } from "../utils/blogEditorTypes";
import { expandBlankLines } from "../utils/markdownBlankLines";
import { useBlogResearchContext } from "../hooks/useBlogResearchContext";
import { useBlogCover } from "../hooks/useBlogCover";
import { useAutosave } from "../hooks/useAutosave";
import { useRevisionHistory } from "../hooks/useRevisionHistory";
import { useVditorBridge } from "../hooks/useVditorBridge";
import { BlogPostView } from "./BlogPostView";

const REVISION_KIND_LABELS = {
  commit: "保存版本",
  publish: "发布版本",
  pre_restore: "恢复前备份",
} as const;

function formatRevisionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function BlogEditor({ onBack }: { onBack?: () => void } = {}) {
  const { state, dispatch } = useChat();
  const navigate = useNavigate();
  const location = useLocation();
  const existingPost = state.blogPosts.find((p) => p.id === state.blogCurrentPostId);
  const isPublishedPost = existingPost?.status === "published";

  const [title, setTitle] = useState(existingPost?.title || "");
  const [content, setContent] = useState(existingPost?.content || "");
  const [tags, setTags] = useState(existingPost?.tags || "");
  const [coverImage, setCoverImage] = useState(existingPost?.cover_image || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [previewPost, setPreviewPost] = useState<BlogPostData | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string; sectionIndex: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AI 修改相关
  const aiModifySavingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const savedWorkingCopyRef = useRef({
    title: existingPost?.title || "",
    content: existingPost?.content || "",
    tags: existingPost?.tags || "",
    coverImage: existingPost?.cover_image || "",
  });

  const markWorkingCopySaved = useCallback((copy: { title: string; content: string; tags?: string | null; coverImage?: string | null }) => {
    savedWorkingCopyRef.current = {
      title: copy.title,
      content: copy.content,
      tags: copy.tags || "",
      coverImage: copy.coverImage || "",
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  // 表单字段需在切换博文时整体重置；拆分 keyed 子组件成本过大，保留此 effect
  useEffect(() => {
    setTitle(existingPost?.title || "");
    setContent(existingPost?.content || "");
    setTags(existingPost?.tags || "");
    setCoverImage(existingPost?.cover_image || "");
    markWorkingCopySaved({
      title: existingPost?.title || "",
      content: existingPost?.content || "",
      tags: existingPost?.tags || "",
      coverImage: existingPost?.cover_image || "",
    });
    setError(null);
  }, [existingPost?.id]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

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
    const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
    if (isSafeInternalPath(returnTo)) {
      navigate(returnTo, { replace: true });
      return;
    }
    if (window.location.search) navigate(window.location.pathname, { replace: true });
  }, [onBack, dispatch, existingPost, location.state, navigate]);

  const applyWorkingCopy = useCallback((copy: { title: string; content: string; tags?: string | null; coverImage?: string | null }, markAsSaved = true) => {
    setTitle(copy.title || "");
    setContent(copy.content || "");
    setTags(copy.tags || "");
    setCoverImage(copy.coverImage || "");
    if (markAsSaved) markWorkingCopySaved(copy);
    if (vditorReadyRef.current) {
      isProgrammaticChangeRef.current = true;
      setTimeout(() => { isProgrammaticChangeRef.current = false; }, 50);
      vditorRef.current?.setValue(expandBlankLines(copy.content || ""));
    }
  }, [markWorkingCopySaved, vditorRef, vditorReadyRef, isProgrammaticChangeRef]);

  const applyRecoveredWorkingCopy = useCallback((copy: { title: string; content: string; tags?: string | null; coverImage?: string | null }) => {
    applyWorkingCopy(copy, false);
  }, [applyWorkingCopy]);

  const onAutosaveCreated = useCallback((post: BlogPostData) => {
    // 新建成功瞬间用编辑器当前值回写 store，而非 createBlogPost 的提交快照：
    // 否则下方 [existingPost?.id] 初始化 effect 会拿滞后快照覆盖正在输入的编辑器。
    dispatch({
      type: "UPSERT_BLOG_POST",
      payload: {
        ...post,
        title: title.trim() || post.title,
        content: getContent(),
        tags: tags.trim() || undefined,
        cover_image: coverImage || null,
      },
    });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: post.id });
  }, [coverImage, dispatch, getContent, tags, title]);
  const onAutosaveSaved = useCallback((post: { id: number; updated_at?: string }) => {
    dispatch({ type: "UPDATE_BLOG_POST", payload: post });
  }, [dispatch]);
  const autosave = useAutosave({
    postId: existingPost?.id,
    values: { title, content, tags, coverImage },
    onCreated: onAutosaveCreated,
    onSaved: onAutosaveSaved,
    onRecovered: applyRecoveredWorkingCopy,
  });
  const revisionHistory = useRevisionHistory(autosave.postId);
  const refreshHistory = revisionHistory.refresh;
  const [showHistory, setShowHistory] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [checkingRevisionLimit, setCheckingRevisionLimit] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [expandedRevision, setExpandedRevision] = useState<BlogRevision | null>(null);
  const [pruneCandidate, setPruneCandidate] = useState<BlogRevisionSummary | null>(null);
  const [pendingSaveTarget, setPendingSaveTarget] = useState<"draft" | "published" | null>(null);
  const [activeSaveTarget, setActiveSaveTarget] = useState<"draft" | "published" | null>(null);
  const [pendingRestoreRevision, setPendingRestoreRevision] = useState<BlogRevision | null>(null);
  const [restorePruneCandidate, setRestorePruneCandidate] = useState<BlogRevisionSummary | null>(null);
  const [restoreCannotSnapshot, setRestoreCannotSnapshot] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(false);
  const historyButtonRef = useRef<HTMLDivElement>(null);
  const [historyPanelPosition, setHistoryPanelPosition] = useState({ top: 8, left: 8 });
  const openHistoryPanel = useCallback(() => {
    const rect = historyButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const panelWidth = Math.min(640, window.innerWidth - 16);
      const panelHeight = Math.min(600, window.innerHeight - 16);
      setHistoryPanelPosition({
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - panelHeight - 8)),
        left: Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8)),
      });
    }
    setShowHistory(true);
  }, []);

  const toggleHistory = useCallback(() => {
    if (showHistory) {
      setShowHistory(false);
      setSelectedRevisionId(null);
      return;
    }
    if (autosave.postId) {
      openHistoryPanel();
      return;
    }
    if (!title.trim()) {
      setError("请输入文章标题");
      return;
    }

    setSaving(true);
    setError(null);
    void autosave.flushNow({ title, content: getContent(), tags, coverImage })
      .then((saved) => {
        if (!saved) throw new Error("An article title is required");
        openHistoryPanel();
      })
      .catch(() => setError("同步文章后无法打开历史"))
      .finally(() => setSaving(false));
  }, [autosave, coverImage, getContent, openHistoryPanel, showHistory, tags, title]);

  useEffect(() => {
    if (!showHistory || !autosave.postId) return;
    void refreshHistory().catch(() => setError("加载历史失败"));
  }, [autosave.postId, refreshHistory, showHistory]);

  useEffect(() => {
    if (!showHistory) return;

    const closeHistory = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (historyButtonRef.current?.contains(target) || target?.closest(".blog-history-popover")) return;
      setShowHistory(false);
      setSelectedRevisionId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowHistory(false);
        setSelectedRevisionId(null);
      }
    };

    window.addEventListener("mousedown", closeHistory, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeHistory, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showHistory]);

  const previewRevision = useCallback((revisionId: number) => {
    void revisionHistory.selectRevision(revisionId).catch(() => setError("加载历史版本失败"));
  }, [revisionHistory]);

  const selectDefaultRevision = useCallback((revisionId: number) => {
    if (selectedRevisionId === revisionId) {
      setSelectedRevisionId(null);
      return;
    }
    setSelectedRevisionId(revisionId);
    previewRevision(revisionId);
  }, [previewRevision, selectedRevisionId]);

  const restoreDefaultPreview = useCallback(() => {
    if (selectedRevisionId != null) previewRevision(selectedRevisionId);
  }, [previewRevision, selectedRevisionId]);

  const currentWorkingCopy = useCallback(() => ({
    title,
    content: getContent(),
    tags,
    coverImage,
  }), [coverImage, getContent, tags, title]);

  const hasUnsavedChanges = useCallback(() => {
    const current = currentWorkingCopy();
    const saved = savedWorkingCopyRef.current;
    return current.title !== saved.title
      || current.content !== saved.content
      || current.tags !== saved.tags
      || current.coverImage !== saved.coverImage;
  }, [currentWorkingCopy]);

  const restoreWorkingCopy = useCallback(async (revisionId: number) => {
    const restored = await revisionHistory.restore(revisionId);
    applyWorkingCopy({
      title: restored.title,
      content: restored.content || "",
      tags: restored.tags,
      coverImage: restored.cover_image,
    });
    dispatch({ type: "UPDATE_BLOG_POST", payload: restored });
  }, [applyWorkingCopy, dispatch, revisionHistory]);

  const completeRestore = useCallback(() => {
    setPendingRestoreRevision(null);
    setRestorePruneCandidate(null);
    setRestoreCannotSnapshot(false);
    setShowHistory(false);
    setSelectedRevisionId(null);
  }, []);

  const restoreRevision = useCallback((revisionId: number) => {
    setRevisionBusy(true);
    autosave.pause();
    void autosave.enqueue(() => restoreWorkingCopy(revisionId))
      .then(completeRestore)
      .catch(() => setError("恢复历史版本失败"))
      .finally(() => {
        autosave.resume();
        setRevisionBusy(false);
      });
  }, [autosave, completeRestore, restoreWorkingCopy]);

  const requestRestore = useCallback((revision: BlogRevision) => {
    if (!hasUnsavedChanges()) {
      restoreRevision(revision.id);
      return;
    }

    const atRevisionLimit = revisionHistory.revisions.length >= 10;
    const pruneCandidate = atRevisionLimit
      ? [...revisionHistory.revisions].reverse().find((item) => !item.is_published && item.id !== revision.id) ?? null
      : null;
    setRestorePruneCandidate(pruneCandidate);
    setRestoreCannotSnapshot(atRevisionLimit && pruneCandidate == null);
    setPendingRestoreRevision(revision);
    setShowHistory(false);
    setSelectedRevisionId(null);
  }, [hasUnsavedChanges, restoreRevision, revisionHistory.revisions]);

  const saveAndRestore = useCallback((revision: BlogRevision) => {
    const workingCopy = currentWorkingCopy();
    setRevisionBusy(true);
    autosave.pause();
    void autosave.flushNow(workingCopy)
      .then((saved) => {
        if (!saved) throw new Error("An article title is required");
        return autosave.enqueue(async () => {
          if (restorePruneCandidate) await revisionHistory.remove(restorePruneCandidate.id);
          await revisionHistory.commit(saved.id);
          await restoreWorkingCopy(revision.id);
        });
      })
      .then(completeRestore)
      .catch(() => setError("保存当前修改或恢复历史版本失败"))
      .finally(() => {
        autosave.resume();
        setRevisionBusy(false);
      });
  }, [autosave, completeRestore, currentWorkingCopy, restorePruneCandidate, restoreWorkingCopy, revisionHistory]);

  const handleCancel = useCallback(() => {
    // 强制保存失败时不直接退出，弹确认让用户知情（本地恢复副本仍保留）
    void autosave.flushNow()
      .then(exitEditor)
      .catch(() => setPendingLeave(true));
  }, [autosave, exitEditor]);

  const handlePreview = useCallback(() => {
    const now = new Date().toISOString();
    setPreviewPost({
      id: existingPost?.id ?? 0,
      title: title.trim() || "未命名文章",
      slug: existingPost?.slug ?? "preview",
      content: vditorRef.current?.getValue?.() ?? content,
      excerpt: existingPost?.excerpt ?? "",
      cover_image: coverImage || undefined,
      status: "published",
      tags: tags.trim() || undefined,
      author: existingPost?.author,
      view_count: existingPost?.view_count ?? 0,
      created_at: existingPost?.created_at ?? now,
      updated_at: existingPost?.updated_at ?? now,
      published_at: existingPost?.published_at ?? now,
    });
  }, [content, coverImage, existingPost, tags, title, vditorRef]);

  const handleSave = useCallback(async (targetStatus: "draft" | "published", pruneConfirmed = false) => {
    if (!title.trim()) {
      setError("请输入文章标题");
      return;
    }
    if (!pruneConfirmed && autosave.postId) {
      setCheckingRevisionLimit(true);
      setError(null);
      try {
        const revisions = await revisionHistory.refresh();
        if (revisions.length >= 10) {
          const candidate = [...revisions]
            .reverse()
            .find((revision) => targetStatus === "published" || !revision.is_published);
          if (candidate) {
            setPruneCandidate(candidate);
            setPendingSaveTarget(targetStatus);
            return;
          }
        }
      } catch {
        setError("无法检查历史版本容量，请稍后重试");
        return;
      } finally {
        setCheckingRevisionLimit(false);
      }
    }
    setSaving(true);
    setActiveSaveTarget(targetStatus);
    setError(null);
    try {
      const workingCopy = currentWorkingCopy();
      const saved = await autosave.flushNow(workingCopy);
      if (!saved) throw new Error("An article title is required");
      if (targetStatus === "draft") {
        await autosave.enqueue(() => revisionHistory.commit(saved.id));
        markWorkingCopySaved(workingCopy);
      } else {
        const published = await autosave.enqueue(() => publishBlogPost(saved.id, true));
        dispatch({ type: "UPDATE_BLOG_POST", payload: published });
        dispatch({ type: "SET_WORKSPACE_BLOG_STATUS", payload: { id: published.id, status: published.status } });
        await revisionHistory.refresh();
        exitEditor();
      }
    } catch {
      setError("保存失败，请稍后重试");
    } finally {
      setSaving(false);
      setActiveSaveTarget(null);
    }
  }, [title, autosave, currentWorkingCopy, revisionHistory, dispatch, exitEditor, markWorkingCopySaved]);

  const ensurePostId = useCallback(async (): Promise<number | null> => {
    if (autosave.postId) return autosave.postId;
    if (!title.trim()) { setError("请输入文章标题"); return null; }
    setSaving(true);
    setError(null);
    try {
      const currentContent = vditorRef.current?.getValue?.() ?? content;
      return (await autosave.flushNow({ title, content: currentContent, tags, coverImage }))?.id ?? null;
    } catch {
      setError("保存失败，无法进入 AI 修改");
      return null;
    } finally {
      setSaving(false);
    }
  }, [autosave, title, content, tags, coverImage, vditorRef]);

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

  const handleEmptyCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || getContent().trim()) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const contentArea = target.closest<HTMLElement>(".vditor-content");
    const editorEl = getEditorElement();
    if (
      !contentArea
      || !editorEl
      || !contentArea.contains(editorEl)
      || editorEl.contains(target)
      || target.closest(".vditor-panel, .vditor-hint, .vditor-resize")
    ) return;

    event.preventDefault();
    editorEl.focus({ preventScroll: true });

    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [getContent, getEditorElement]);

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
        void autosave.flushNow().catch(() => setError("保存失败，请稍后重试"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autosave]);

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

      meta.append(countSpan, savedSpan);
      toolbar.append(meta);
    }

    const countSpan = meta.querySelector<HTMLElement>(".blog-editor-toolbar-meta-count");
    if (countSpan) countSpan.textContent = `${wordCount} 字 · ${lineCount} 行`;

    const savedSpan = meta.querySelector<HTMLElement>(".blog-editor-toolbar-meta-saved");
    if (savedSpan) {
      const clockSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      const alertSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      savedSpan.innerHTML = autosave.saveError ? alertSvg : clockSvg;
      savedSpan.appendChild(document.createTextNode(
        autosave.saveError ? "保存失败" : autosave.lastSaved ? `已同步 ${autosave.lastSaved}` : "",
      ));
      savedSpan.style.display = (autosave.saveError || autosave.lastSaved) ? "" : "none";
      savedSpan.classList.toggle("text-destructive", autosave.saveError);
    }
  }, [containerId, vditorToolbarReady, wordCount, lineCount, autosave.lastSaved, autosave.saveError]);

  return (
    <>
      {previewPost && <BlogPostView previewPost={previewPost} isOwner={false} onBack={() => setPreviewPost(null)} />}
    <div className={cn("blog-editor-body flex h-full flex-1 flex-col overflow-hidden", previewPost && "hidden")}>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {toolbarExpanded ? (
      <div className="border-b border-border/70 p-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" onClick={handleCancel}>
            <ArrowLeft className="w-4 h-4" />
            返回
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <div ref={historyButtonRef}>
              <Button
                variant="outline"
                className="rounded-full bg-background/70"
                onClick={toggleHistory}
                disabled={saving || revisionBusy || checkingRevisionLimit || !title.trim()}
                aria-expanded={showHistory}
                aria-controls="blog-history-popover"
              >
                <Archive className="w-4 h-4" />
                历史
              </Button>
            </div>
            <Button variant="outline" className="rounded-full bg-background/70" onClick={handlePreview}>
              <Eye className="w-4 h-4" />
              预览
            </Button>
            <Button className="w-20 rounded-full px-2 shadow-lg shadow-primary/20" onClick={() => handleSave("published")} disabled={saving || revisionBusy || checkingRevisionLimit}>
              <Save className="w-4 h-4" />
              {activeSaveTarget === "published" ? (isPublishedPost ? "更新中" : "发布中") : isPublishedPost ? "更新" : "发布"}
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
              className="h-9 rounded-full border-border bg-secondary/65 pl-9 pr-20 text-body shadow-none"
              placeholder="标签（逗号分隔）"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              className={`absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-full px-2 text-fine ${
                tagGenerating || !content.trim() ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={handleSuggestTags}
              disabled={tagGenerating || !content.trim()}
            >
              <Wand2 className={`mr-1 h-3 w-3 ${tagGenerating ? "animate-spin" : ""}`} />
              {tagGenerating ? "生成中..." : "AI 生成"}
            </Button>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-2 text-fine text-muted-foreground">
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
                  <div className="text-body font-black tracking-[-0.03em] text-foreground">事实依据</div>
                  <p className="mt-1 text-fine leading-relaxed text-muted-foreground">
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
                <div className="mb-2 text-fine font-bold text-muted-foreground">关联研究主题</div>
                {researchLoading ? (
                  <div className="text-fine text-muted-foreground">正在加载事实依据...</div>
                ) : researchError ? (
                  <div className="text-fine text-destructive">{researchError}</div>
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
                  <div className="text-fine leading-relaxed text-muted-foreground">暂无关联主题，可在研究图谱中创建。</div>
                )}
              </div>

              <div className="rounded-panel border border-border/70 bg-card/70 p-3">
                <div className="mb-2 text-fine font-bold text-muted-foreground">已采用事实</div>
                {adoptedClaims.length > 0 ? (
                  <div className="space-y-2">
                    {adoptedClaims.slice(0, 3).map((claim, index) => (
                      <div key={`${recordNumber(claim, "id") ?? index}`} className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-fine leading-relaxed text-foreground">
                        {recordString(claim, "claim_text") || "未命名事实"}
                      </div>
                    ))}
                    {adoptedClaims.length > 3 && <div className="text-caption text-muted-foreground">还有 {adoptedClaims.length - 3} 条事实可在研究图谱查看。</div>}
                  </div>
                ) : (
                  <div className="text-fine leading-relaxed text-muted-foreground">暂无已采用事实。</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 rounded-surface border border-border/70 bg-background/56 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="inline-flex items-center gap-2 text-body font-bold text-foreground">
                <ImageIcon className="h-4 w-4 text-primary" />
                文章封面
              </div>
              <p className="mt-1 text-fine text-muted-foreground">可使用 AI 生成、上传图片、选择默认图，也可以不设置封面。</p>
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
                <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 border border-dashed border-border/80 text-fine text-muted-foreground">
                  <ImageIcon className="h-5 w-5" />
                  无封面，发布后白底显示
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      ) : (
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-body">
        <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 text-body text-muted-foreground hover:text-foreground" onClick={handleCancel}>
          <ArrowLeft className="w-3 h-3" />
          返回
        </Button>
        <Input
          className="h-7 min-w-[120px] flex-1 appearance-none rounded-full border border-solid border-input bg-background shadow-sm px-3 text-body text-foreground placeholder:text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="输入文章标题..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div ref={historyButtonRef}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-2 text-body"
            onClick={toggleHistory}
            disabled={saving || revisionBusy || checkingRevisionLimit || !title.trim()}
            aria-expanded={showHistory}
            aria-controls="blog-history-popover"
          >
            <Archive className="w-3 h-3" />
            历史
          </Button>
        </div>
        <Button variant="outline" size="sm" className="h-7 rounded-full px-2 text-body" onClick={handlePreview}>
          <Eye className="w-3 h-3" />
          预览
        </Button>
        <Button size="sm" className="h-7 w-20 rounded-full px-2 text-body" onClick={() => handleSave("published")} disabled={saving || revisionBusy || checkingRevisionLimit}>
          <Save className="w-3 h-3" />
          {activeSaveTarget === "published" ? (isPublishedPost ? "更新中" : "发布中") : isPublishedPost ? "更新" : "发布"}
        </Button>
      </div>
      )}

      {showHistory && autosave.postId && createPortal(
        <section
          id="blog-history-popover"
          className="blog-history-popover fixed z-[60] grid h-[min(600px,calc(100dvh-2rem))] w-[calc(100vw-1rem)] max-w-[640px] overflow-hidden rounded-panel border border-border/70 bg-popover/96 p-2 shadow-2xl shadow-foreground/15 backdrop-blur-xl md:grid-cols-[220px_minmax(0,1fr)]"
          style={historyPanelPosition}
          aria-label="文章历史"
        >
          <div className="flex min-h-0 flex-col overflow-hidden border-b border-border/60 p-2 md:border-b-0 md:border-r">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="text-body font-semibold text-foreground">历史版本</div>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => handleSave("draft")}
                disabled={saving || revisionBusy || checkingRevisionLimit}
              >
                保存版本
              </Button>
            </div>
            {revisionHistory.revisions.length === 0 ? (
              <p className="text-fine text-muted-foreground">还没有历史。保存版本或发布后会在这里创建版本。</p>
            ) : (
              <div
                className={cn(
                  "min-h-0 flex-1",
                  revisionHistory.revisions.length >= 10
                    ? "grid grid-rows-[repeat(10,minmax(0,1fr))] gap-1"
                    : "space-y-1",
                )}
                onMouseLeave={restoreDefaultPreview}
              >
                {revisionHistory.revisions.slice(0, 10).map((revision) => (
                  <button
                    key={revision.id}
                    type="button"
                    onMouseEnter={() => previewRevision(revision.id)}
                    onFocus={() => previewRevision(revision.id)}
                    onClick={() => selectDefaultRevision(revision.id)}
                    aria-pressed={selectedRevisionId === revision.id}
                    title={selectedRevisionId === revision.id ? "当前默认预览版本，点击取消选择" : "点击设为默认预览版本"}
                    className={cn(
                      "min-h-0 w-full overflow-hidden rounded-control px-2 py-1 text-left transition-colors",
                      revisionHistory.revisions.length >= 10 ? "h-full" : "py-1.5",
                      selectedRevisionId === revision.id ? "bg-primary/10 text-foreground" : "hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-fine font-medium leading-tight">版本 {revision.revision_number}</span>
                      <Badge variant={revision.is_published ? "success" : "secondary"} className="shrink-0 px-1.5 py-0 text-caption font-medium">
                        {revision.is_published ? "公开版本" : REVISION_KIND_LABELS[revision.kind]}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-caption leading-tight text-muted-foreground">{formatRevisionTime(revision.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden p-2">
            {revisionHistory.selected ? (
              <>
                <div className="mb-3 shrink-0 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex h-8 items-center text-body font-semibold text-foreground">版本 {revisionHistory.selected.revision_number}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={revisionHistory.selected.is_published ? "success" : "secondary"}
                        className="px-1.5 py-0 text-caption font-medium"
                      >
                        {revisionHistory.selected.is_published ? "公开版本" : REVISION_KIND_LABELS[revisionHistory.selected.kind]}
                      </Badge>
                      <span className="text-caption text-muted-foreground">{formatRevisionTime(revisionHistory.selected.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 self-start gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setExpandedRevision(revisionHistory.selected);
                        setShowHistory(false);
                      }}
                    >展开查看</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revisionBusy}
                      onClick={() => requestRestore(revisionHistory.selected!)}
                    >恢复</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      disabled={revisionBusy || revisionHistory.selected.is_published}
                      title={revisionHistory.selected.is_published ? "公开版本受保护，不能删除" : "删除此历史版本"}
                      onClick={() => {
                        setRevisionBusy(true);
                        void autosave.enqueue(() => revisionHistory.remove(revisionHistory.selected!.id))
                          .then(() => setSelectedRevisionId(null))
                          .catch(() => setError("删除历史版本失败"))
                          .finally(() => setRevisionBusy(false));
                      }}
                    >删除</Button>
                  </div>
                </div>
                {revisionHistory.selected.title !== title && (
                  <div className="mb-3 shrink-0 rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                    <span className="mr-1 text-muted-foreground">标题：</span>
                    {revisionHistory.selected.title}
                  </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col rounded-control border border-border/60 bg-muted/25 p-3">
                  <div className="mb-2 text-caption font-medium text-muted-foreground">快速预览</div>
                  <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-sans text-fine leading-relaxed text-foreground">{revisionHistory.selected.content}</pre>
                </div>
              </>
            ) : (
              <p className="text-fine text-muted-foreground">{revisionHistory.loading ? "正在加载预览…" : "悬停一个历史版本查看内容。"}</p>
            )}
          </div>
        </section>,
        document.body,
      )}

      <Dialog open={expandedRevision != null} onOpenChange={(open) => !open && setExpandedRevision(null)}>
        <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl">
          {expandedRevision && (
            <>
              <DialogHeader className="border-b border-border/70 p-5 pr-12">
                <DialogTitle>版本 {expandedRevision.revision_number} 完整内容</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant={expandedRevision.is_published ? "success" : "secondary"} className="px-1.5 py-0 text-caption font-medium">
                    {expandedRevision.is_published ? "公开版本" : REVISION_KIND_LABELS[expandedRevision.kind]}
                  </Badge>
                  <span>{formatRevisionTime(expandedRevision.created_at)}</span>
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60dvh]">
                <div className="space-y-4 p-5">
                  {expandedRevision.title !== title && (
                    <div className="rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                      <span className="mr-1 text-muted-foreground">标题：</span>
                      {expandedRevision.title}
                    </div>
                  )}
                  <div>
                    <div className="mb-2 text-caption font-medium text-muted-foreground">正文</div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-body leading-relaxed text-foreground">{expandedRevision.content}</pre>
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingRestoreRevision != null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRestoreRevision(null);
            setRestorePruneCandidate(null);
            setRestoreCannotSnapshot(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          {pendingRestoreRevision && (
            <>
              <DialogHeader>
                <DialogTitle>当前修改尚未保存为版本</DialogTitle>
                <DialogDescription>
                  恢复版本 {pendingRestoreRevision.revision_number} 会覆盖这些修改。你可以先保存为版本，或直接放弃后恢复。
                </DialogDescription>
              </DialogHeader>
              {restorePruneCandidate && (
                <div className="rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                  保存当前修改为版本会删除版本 {restorePruneCandidate.revision_number}，以保留最多 10 个历史版本。
                </div>
              )}
              {restoreCannotSnapshot && (
                <div className="rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2 text-fine text-destructive">
                  历史版本已满，且没有可删除的非公开版本；无法在恢复前保存当前修改为版本。
                </div>
              )}
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  disabled={revisionBusy}
                  onClick={() => {
                    setPendingRestoreRevision(null);
                    setRestorePruneCandidate(null);
                    setRestoreCannotSnapshot(false);
                  }}
                >取消</Button>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={revisionBusy}
                    onClick={() => restoreRevision(pendingRestoreRevision.id)}
                  >放弃修改并恢复</Button>
                  <Button
                    disabled={revisionBusy || restoreCannotSnapshot}
                    onClick={() => saveAndRestore(pendingRestoreRevision)}
                  >保存版本并恢复</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pruneCandidate != null}
        onOpenChange={(open) => {
          if (!open) {
            setPruneCandidate(null);
            setPendingSaveTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          {pruneCandidate && pendingSaveTarget && (
            <>
              <DialogHeader>
                <DialogTitle>历史版本已满</DialogTitle>
                <DialogDescription>
                  {pendingSaveTarget === "published" && pruneCandidate.is_published
                    ? "发布新版本会替换并删除当前公开版本，删除后无法恢复。"
                    : "继续操作会删除最早的非公开版本，删除后无法恢复。"}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                <div className="font-medium">版本 {pruneCandidate.revision_number}</div>
                <div className="mt-1 text-caption text-muted-foreground">
                  {pruneCandidate.is_published ? "公开版本" : REVISION_KIND_LABELS[pruneCandidate.kind]} · {formatRevisionTime(pruneCandidate.created_at)}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPruneCandidate(null);
                    setPendingSaveTarget(null);
                  }}
                >取消</Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const targetStatus = pendingSaveTarget;
                    setPruneCandidate(null);
                    setPendingSaveTarget(null);
                    void handleSave(targetStatus, true);
                  }}
                >
                  {pendingSaveTarget === "published" ? "删除并发布" : "删除并保存版本"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pendingLeave} onOpenChange={setPendingLeave}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>保存失败</DialogTitle>
            <DialogDescription>
              文章未能保存到服务器（可能网络异常或登录已过期）。仍要离开吗？本地恢复副本仍保留，下次进入编辑器会自动恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLeave(false)}>留在此页</Button>
            <Button variant="destructive" onClick={() => { setPendingLeave(false); exitEditor(); }}>仍要离开</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <Alert variant="destructive" className="m-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </Alert>
      )}

      <div
        className="vditor-wrapper min-h-0 flex-1 overflow-hidden relative"
        onPointerDownCapture={handleEmptyCanvasPointerDown}
        onContextMenu={handleEditorContextMenu}
        onTouchStart={handleEditorTouchStart}
        onTouchEnd={handleEditorTouchEnd}
      >
        <div id={containerId} className="h-full" />
      </div>
      </div>

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
    </>
  );
}
