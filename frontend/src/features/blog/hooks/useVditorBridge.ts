import { useCallback, useEffect, useId, useRef, useState } from "react";
import Vditor from "vditor";
import { useChat } from "../../../stores/chatStore";
import { useAuth } from "../../../stores/authStore";
import { getAccessToken } from "../../../api/client";
import type { BlogPost } from "../types";
import { expandBlankLines } from "../utils/markdownBlankLines";
import { applyBackspaceShortcut, applyEnterShortcuts, applyUnorderedListShortcut } from "../utils/vditorShortcuts";
import {
  getEditorI18n,
  installCodeLanguageMenu,
  installControlledEditModeMenu,
  installControlledTableMenu,
  installTableCellMenu,
} from "../utils/vditorMenus";

// Vditor 桥子领域：Vditor 实例生命周期（mount-only）+ content↔setValue 同步（含防回环）+
// 主题/高度约束 + AI 修改 patch 注入链 + 超时。从 BlogEditor 抽出，行为不变。
// content 表单字段仍由主组件持有（发布/字数等多处用），hook 经 setContent 写回、经 getContent 读出。
export interface UseVditorBridgeParams {
  content: string;
  setContent: (value: string) => void;
  existingPost: BlogPost | undefined;
  setError: (message: string | null) => void;
}

export function useVditorBridge({ content, setContent, existingPost, setError }: UseVditorBridgeParams) {
  const { state, dispatch } = useChat();
  const { user: authUser } = useAuth();
  const containerId = useId();
  const vditorRef = useRef<Vditor | null>(null);
  const vditorReadyRef = useRef(false);
  const isProgrammaticChange = useRef(false);
  const patchApplyPendingRef = useRef(false);
  const cleanupEditModeMenuRef = useRef<(() => void) | null>(null);
  const cleanupTableMenuRef = useRef<(() => void) | null>(null);
  const cleanupCodeLanguageMenuRef = useRef<(() => void) | null>(null);
  const cleanupTableCellMenuRef = useRef<(() => void) | null>(null);
  const cleanupEnterHandlerRef = useRef<(() => void) | null>(null);
  const [vditorToolbarReady, setVditorToolbarReady] = useState(0);

  // existingPost.content 变化 → programmatic setValue（防回环）
  useEffect(() => {
    if (!vditorReadyRef.current) return;
    const newContent = existingPost?.content || "";
    isProgrammaticChange.current = true;
    const safety = setTimeout(() => { isProgrammaticChange.current = false; }, 50);
    vditorRef.current?.setValue(expandBlankLines(newContent));
    return () => clearTimeout(safety);
  }, [existingPost?.content]);

  /* eslint-disable react-hooks/exhaustive-deps */
  // Vditor 实例 mount-only 生命周期：空 deps，只挂载一次，content/theme 闭包初始值（变更走上面同步 effect 与 theme effect）
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = "";
    }
    const vd = new Vditor(containerId, {
      mode: "wysiwyg",
      theme: state.theme === "dark" ? "dark" : "classic",
      i18n: getEditorI18n(),
      value: expandBlankLines(content),
      placeholder: "开始写文章...",
      minHeight: 0,
      customWysiwygToolbar: (_type, element) => {
        element.innerHTML = "";
        element.style.display = "none";
      },
      keydown(event) {
        const editor = document.getElementById(containerId)?.querySelector<HTMLElement>('[contenteditable="true"]');
        if (!editor) return;
        if (applyUnorderedListShortcut(editor, event)) return;
      },
      toolbar: [
        "headings", "bold", "italic", "strike", "|",
        "list", "ordered-list", "check", "quote", "|",
        "code", "inline-code", "link", "table", "|",
        "undo", "redo", "|",
        "edit-mode",
      ],
      preview: { actions: [], mode: "editor" },
      upload: {
        accept: "image/*",
        fieldName: "file",
        max: 20 * 1024 * 1024,
        multiple: false,
        url: "/api/v1/upload",
        setHeaders: () => {
          const token = getAccessToken();
          return token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>);
        },
        format: (files, responseText) => {
          const response = JSON.parse(responseText) as {
            download_url?: string;
            original_name?: string;
            stored_name?: string;
          };
          const username = authUser?.username;
          const filename = response.original_name || files[0]?.name || response.stored_name || "image";
          const imageUrl = username && response.stored_name
            ? `/api/v1/public/uploads/${encodeURIComponent(username)}/${encodeURIComponent(response.stored_name)}`
            : response.download_url;
          return JSON.stringify({
            code: 0,
            msg: "",
            data: {
              errFiles: [],
              succMap: {
                [filename]: imageUrl,
              },
            },
          });
        },
      },
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
        cleanupEditModeMenuRef.current = installControlledEditModeMenu(vd);
        cleanupTableMenuRef.current = installControlledTableMenu(vd);
        cleanupCodeLanguageMenuRef.current = installCodeLanguageMenu(vd);
        cleanupTableCellMenuRef.current = installTableCellMenu(vd, setContent);
        const editorContainer = document.getElementById(containerId);
        if (editorContainer) {
          const enterHandler = (event: KeyboardEvent) => {
            const editor = editorContainer.querySelector<HTMLElement>('[contenteditable="true"]');
            if (!editor) return;
            const handled = applyEnterShortcuts(editor, event) || applyBackspaceShortcut(editor, event);
            if (handled) {
              event.stopImmediatePropagation();
            }
          };
          editorContainer.addEventListener("keydown", enterHandler, true);
          cleanupEnterHandlerRef.current = () => {
            editorContainer.removeEventListener("keydown", enterHandler, true);
          };
        }
        setVditorToolbarReady((value) => value + 1);
      },
    });
    vditorRef.current = vd;
    return () => {
      vditorReadyRef.current = false;
      cleanupEditModeMenuRef.current?.();
      cleanupEditModeMenuRef.current = null;
      cleanupTableMenuRef.current?.();
      cleanupTableMenuRef.current = null;
      cleanupCodeLanguageMenuRef.current?.();
      cleanupCodeLanguageMenuRef.current = null;
      cleanupTableCellMenuRef.current?.();
      cleanupTableCellMenuRef.current = null;
      cleanupEnterHandlerRef.current?.();
      cleanupEnterHandlerRef.current = null;
      try {
        vditorRef.current?.destroy();
      } catch { /* ignore vditor destroy errors on unmount */ }
      vditorRef.current = null;
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

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
  }, []);

  useEffect(() => {
    if (!vditorReadyRef.current) return;
    const theme = state.theme === "dark" ? "dark" : "classic";
    vditorRef.current?.setTheme(theme, theme, "native");
  }, [state.theme]);

  const getEditorElement = useCallback((): HTMLElement | null => {
    const vditorElement = vditorRef.current?.vditor?.element as HTMLElement | undefined;
    const internalEditor = vditorRef.current?.vditor?.wysiwyg?.element as HTMLElement | undefined;
    const container = document.getElementById(containerId);
    return (
      internalEditor
      ?? vditorElement?.querySelector<HTMLElement>(".vditor-wysiwyg, .vditor-ir, .vditor-sv, .vditor-reset")
      ?? container?.querySelector<HTMLElement>(".vditor-wysiwyg, .vditor-ir, .vditor-sv, .vditor-reset")
      ?? null
    );
  }, [containerId]);

  // AI 修改 patch 链：仅消费当前文章的 START/APPEND，CLEAR 后回写正式正文
  const patchStreaming = existingPost ? state.blogPatchStreamingByPostId[existingPost.id] : undefined;
  useEffect(() => {
    const editorEl = getEditorElement();
    if (!editorEl) return;

    if (!patchStreaming) {
      if (patchApplyPendingRef.current) {
        patchApplyPendingRef.current = false;
        isProgrammaticChange.current = true;
        vditorRef.current?.setValue(expandBlankLines(existingPost?.content || ""));
        window.setTimeout(() => { isProgrammaticChange.current = false; }, 50);
      }
      return;
    }

    const existing = editorEl.querySelector(".ai-patch-inline__text");
    if (existing instanceof HTMLElement) {
      existing.textContent = patchStreaming.replacementDelta || "...";
      return;
    }

    const cleanTarget = patchStreaming.targetText.replace(/[`*_~#[\]()>]/g, "").trim();
    const matchKey = cleanTarget.length > 15 ? cleanTarget.slice(0, 15) : cleanTarget;
    const blocks = Array.from(
      editorEl.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote"),
    );
    for (const block of blocks) {
      const blockText = (block.textContent || "").replace(/[`*_~#[\]()>]/g, "");
      if (!matchKey || !blockText.includes(matchKey)) continue;
      const preview = document.createElement("div");
      preview.className = "ai-patch-inline";
      preview.setAttribute("data-block", "0");
      preview.setAttribute("contenteditable", "false");
      const label = document.createElement("span");
      label.className = "ai-patch-inline__label";
      label.textContent = "AI 修改中...";
      const text = document.createElement("div");
      text.className = "ai-patch-inline__text";
      text.textContent = patchStreaming.replacementDelta || "...";
      preview.append(label, text);
      block.replaceWith(preview);
      patchApplyPendingRef.current = true;
      return;
    }
  }, [patchStreaming, existingPost?.content, getEditorElement]);

  // 超时从目标文本确定时开始计算；流式 replacementDelta 不应重置计时器
  useEffect(() => {
    if (!patchStreaming) return;
    const timer = window.setTimeout(() => {
      dispatch({
        type: "CLEAR_BLOG_PATCH_STREAMING",
        payload: { postId: existingPost!.id, runId: patchStreaming.runId },
      });
      setError("AI 修改超时，请重试");
    }, 30000);
    return () => window.clearTimeout(timer);
    // 只按 targetText 重置；流式 delta 不应延长既有超时。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchStreaming?.targetText, dispatch]);

  const getContent = useCallback(() => vditorRef.current?.getValue?.() ?? content, [content]);

  return {
    containerId,
    vditorRef,
    vditorReadyRef,
    isProgrammaticChangeRef: isProgrammaticChange,
    getEditorElement,
    getContent,
    vditorToolbarReady,
  };
}
