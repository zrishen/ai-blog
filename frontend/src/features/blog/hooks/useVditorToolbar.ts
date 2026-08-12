import { useEffect } from "react";

// Vditor 工具栏 DOM 注入：折叠/展开切换按钮 + 字数/行数/保存状态 meta。
// 从 BlogEditor 抽出，行为不变；仅副作用，无返回值。
export function useVditorToolbar({
  containerId,
  toolbarExpanded,
  setToolbarExpanded,
  vditorToolbarReady,
  wordCount,
  lineCount,
  lastSaved,
  saveError,
}: {
  containerId: string;
  toolbarExpanded: boolean;
  setToolbarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  vditorToolbarReady: number;
  wordCount: number;
  lineCount: number;
  lastSaved: string;
  saveError: boolean;
}) {
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
  }, [containerId, toolbarExpanded, vditorToolbarReady, setToolbarExpanded]);

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, [toolbarExpanded]);

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
      savedSpan.innerHTML = saveError ? alertSvg : clockSvg;
      savedSpan.appendChild(document.createTextNode(
        saveError ? "保存失败" : lastSaved ? `已同步 ${lastSaved}` : "",
      ));
      savedSpan.style.display = (saveError || lastSaved) ? "" : "none";
      savedSpan.classList.toggle("text-destructive", saveError);
    }
  }, [containerId, vditorToolbarReady, wordCount, lineCount, lastSaved, saveError]);
}
