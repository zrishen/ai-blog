import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Copy, Sparkles } from "lucide-react";

import { useChatDispatch } from "../../../stores/chatStore";
import { getSectionIndexFromSelection } from "../utils/getSectionIndexFromSelection";

// 编辑器右键 / 长按上下文菜单 + 空白画布聚焦。
// 从 BlogEditor 抽出：持有 contextMenu 状态与所有交互 handler，
// 渲染包裹 Vditor 容器的 .vditor-wrapper 与 Portal 菜单。行为不变。
interface EditorContextMenuProps {
  getEditorElement: () => HTMLElement | null;
  getContent: () => string;
  ensurePostId: () => Promise<number | null>;
  children: React.ReactNode;
}

interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  sectionIndex: number;
}

export function EditorContextMenu({ getEditorElement, getContent, ensurePostId, children }: EditorContextMenuProps) {
  const dispatch = useChatDispatch();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiModifySavingRef = useRef(false);

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
      if (!sel) return;
      const selection = sel.toString().trim() || "";
      if (selection.length >= 5) {
        const range = sel.getRangeAt(0);
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
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest(".fixed.z-50")) return;
      closeContextMenu();
    };
    window.addEventListener("mousedown", handler, true);
    return () => window.removeEventListener("mousedown", handler, true);
  }, [contextMenu, closeContextMenu]);

  return (
    <div
      className="vditor-wrapper min-h-0 flex-1 overflow-hidden relative"
      onPointerDownCapture={handleEmptyCanvasPointerDown}
      onContextMenu={handleEditorContextMenu}
      onTouchStart={handleEditorTouchStart}
      onTouchEnd={handleEditorTouchEnd}
    >
      {children}
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
            onClick={() => void handleEditorAIModify()}
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
