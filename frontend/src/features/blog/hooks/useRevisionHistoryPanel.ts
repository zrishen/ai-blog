import { useState, useEffect, useCallback } from "react";

import { useChatDispatch } from "../../../stores/chatStore";

import { useAutosave } from "./useAutosave";
import { useRevisionHistory } from "./useRevisionHistory";

import type { BlogRevision, BlogRevisionSummary } from "@/api/blog";

export type SaveTarget = "draft" | "published";

type AutosaveApi = ReturnType<typeof useAutosave>;
export type RevisionHistoryApi = ReturnType<typeof useRevisionHistory>;

type BlogCopy = { title: string; content: string; tags?: string | null; coverImage?: string | null };

interface UseRevisionHistoryPanelParams {
  historyButtonRef: React.RefObject<HTMLDivElement | null>;
  autosave: AutosaveApi;
  revisionHistory: RevisionHistoryApi;
  title: string;
  currentWorkingCopy: () => { title: string; content: string; tags: string; coverImage: string };
  hasUnsavedChanges: () => boolean;
  applyWorkingCopy: (copy: BlogCopy, markAsSaved?: boolean) => void;
  setError: (message: string | null) => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
}

// 历史版本面板子领域：面板开关/定位、版本预览/选择、恢复流程、版本容量检查。
// 从 BlogEditor 抽出，行为不变。historyButtonRef 由调用方持有（工具栏按钮需要直接绑定），
// 保存/发布编排（handleSave）仍留在 BlogEditor，经 checkRevisionCapacityForSave 协作。
export function useRevisionHistoryPanel({
  historyButtonRef,
  autosave,
  revisionHistory,
  title,
  currentWorkingCopy,
  hasUnsavedChanges,
  applyWorkingCopy,
  setError,
  saving,
  setSaving,
}: UseRevisionHistoryPanelParams) {
  const dispatch = useChatDispatch();
  const refreshHistory = revisionHistory.refresh;
  const [showHistory, setShowHistory] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [checkingRevisionLimit, setCheckingRevisionLimit] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [expandedRevision, setExpandedRevision] = useState<BlogRevision | null>(null);
  const [pruneCandidate, setPruneCandidate] = useState<BlogRevisionSummary | null>(null);
  const [pendingSaveTarget, setPendingSaveTarget] = useState<SaveTarget | null>(null);
  const [pendingRestoreRevision, setPendingRestoreRevision] = useState<BlogRevision | null>(null);
  const [restorePruneCandidate, setRestorePruneCandidate] = useState<BlogRevisionSummary | null>(null);
  const [restoreCannotSnapshot, setRestoreCannotSnapshot] = useState(false);
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
  }, [historyButtonRef]);

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
    void autosave.flushNow(currentWorkingCopy())
      .then((saved) => {
        if (!saved) throw new Error("An article title is required");
        openHistoryPanel();
      })
      .catch(() => setError("同步文章后无法打开历史"))
      .finally(() => setSaving(false));
  }, [autosave, currentWorkingCopy, openHistoryPanel, setError, setSaving, showHistory, title]);

  useEffect(() => {
    if (!showHistory || !autosave.postId) return;
    void refreshHistory().catch(() => setError("加载历史失败"));
  }, [autosave.postId, refreshHistory, showHistory, setError]);

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
  }, [showHistory, historyButtonRef]);

  const previewRevision = useCallback((revisionId: number) => {
    void revisionHistory.selectRevision(revisionId).catch(() => setError("加载历史版本失败"));
  }, [revisionHistory, setError]);

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
  }, [autosave, completeRestore, restoreWorkingCopy, setError]);

  const requestRestore = useCallback((revision: BlogRevision) => {
    if (!hasUnsavedChanges()) {
      restoreRevision(revision.id);
      return;
    }

    const atRevisionLimit = revisionHistory.revisions.length >= 10;
    const candidate = atRevisionLimit
      ? [...revisionHistory.revisions].reverse().find((item) => !item.is_published && item.id !== revision.id) ?? null
      : null;
    setRestorePruneCandidate(candidate);
    setRestoreCannotSnapshot(atRevisionLimit && candidate == null);
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
  }, [autosave, completeRestore, currentWorkingCopy, restorePruneCandidate, restoreWorkingCopy, revisionHistory, setError]);

  // 面板内"展开查看"：锁定展开版本并收起浮层
  const openExpandedRevision = useCallback(() => {
    if (revisionHistory.selected) setExpandedRevision(revisionHistory.selected);
    setShowHistory(false);
  }, [revisionHistory.selected]);

  // 面板内"删除"当前选中版本
  const deleteSelectedRevision = useCallback(() => {
    const selected = revisionHistory.selected;
    if (!selected) return;
    setRevisionBusy(true);
    void autosave.enqueue(() => revisionHistory.remove(selected.id))
      .then(() => setSelectedRevisionId(null))
      .catch(() => setError("删除历史版本失败"))
      .finally(() => setRevisionBusy(false));
  }, [autosave, revisionHistory, setError]);

  const cancelRestore = useCallback(() => {
    setPendingRestoreRevision(null);
    setRestorePruneCandidate(null);
    setRestoreCannotSnapshot(false);
  }, []);

  const cancelPrune = useCallback(() => {
    setPruneCandidate(null);
    setPendingSaveTarget(null);
  }, []);

  // handleSave 用：检查版本容量，满则挂起 pruneCandidate 待确认
  const checkRevisionCapacityForSave = useCallback(async (targetStatus: SaveTarget): Promise<boolean> => {
    if (!autosave.postId) return true;
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
          return false;
        }
      }
      return true;
    } catch {
      setError("无法检查历史版本容量，请稍后重试");
      return false;
    } finally {
      setCheckingRevisionLimit(false);
    }
  }, [autosave.postId, revisionHistory, setError]);

  return {
    showHistory,
    toggleHistory,
    historyDisabled: saving || revisionBusy || checkingRevisionLimit || !title.trim(),
    checkRevisionCapacityForSave,
    historyPanelPosition,
    postId: autosave.postId,
    revisionHistory,
    selectedRevisionId,
    revisionBusy,
    checkingRevisionLimit,
    saving,
    expandedRevision,
    setExpandedRevision,
    pendingRestoreRevision,
    restorePruneCandidate,
    restoreCannotSnapshot,
    pruneCandidate,
    pendingSaveTarget,
    previewRevision,
    selectDefaultRevision,
    restoreDefaultPreview,
    openExpandedRevision,
    deleteSelectedRevision,
    requestRestore,
    restoreRevision,
    saveAndRestore,
    cancelRestore,
    cancelPrune,
  };
}
