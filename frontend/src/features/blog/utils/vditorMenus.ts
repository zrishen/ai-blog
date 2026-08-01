import Vditor from "vditor";
import { expandBlankLines, preserveBlankLines } from "./markdownBlankLines";

type VditorOptions = NonNullable<ConstructorParameters<typeof Vditor>[1]>;
type VditorI18n = NonNullable<VditorOptions["i18n"]>;

export function getEditorI18n(): VditorI18n {
  return {
    ...(window as typeof window & { VditorI18n: VditorI18n }).VditorI18n,
    splitView: "源码模式",
  };
}

const TABLE_PICKER_ROWS = 6;
const TABLE_PICKER_COLUMNS = 6;
const HIGHLIGHT_SCRIPT_URL = new URL("vditor/dist/js/highlight.js/highlight.min.js", import.meta.url).toString();
const HIGHLIGHT_THIRD_LANGUAGES_URL = new URL("vditor/dist/js/highlight.js/third-languages.js", import.meta.url).toString();
let highlightLoaderPromise: Promise<void> | null = null;

function loadHighlightJs() {
  const existingHighlighter = (window as typeof window & { hljs?: unknown }).hljs;
  if (existingHighlighter) return Promise.resolve();
  if (highlightLoaderPromise) return highlightLoaderPromise;

  const loadScript = (src: string, id: string) => new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    // 超时兜底:脚本既不 load 也不 error(被 CSP 阻止/跨域/返回非脚本等)时,避免永久挂起卡住调用方
    const timeoutId = window.setTimeout(() => reject(new Error(`Timeout loading ${src}`)), 8000);
    const settle = (ok: boolean) => {
      window.clearTimeout(timeoutId);
      if (ok) resolve();
      else reject(new Error(`Failed to load ${src}`));
    };
    if (existing) {
      existing.addEventListener("load", () => settle(true), { once: true });
      existing.addEventListener("error", () => settle(false), { once: true });
      if ((window as typeof window & { hljs?: unknown }).hljs) settle(true);
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => settle(true);
    script.onerror = () => settle(false);
    document.head.appendChild(script);
  });

  highlightLoaderPromise = loadScript(HIGHLIGHT_SCRIPT_URL, "blogEditorHljsScript")
    .then(() => loadScript(HIGHLIGHT_THIRD_LANGUAGES_URL, "blogEditorHljsThirdLanguagesScript"))
    .catch(() => {
      highlightLoaderPromise = null;
    });
  return highlightLoaderPromise;
}

function buildMarkdownTable(rowCount: number, columnCount: number) {
  const columns = Array.from({ length: columnCount }, (_, index) => `列 ${index + 1}`);
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const bodyRows = Array.from({ length: Math.max(1, rowCount - 1) }, () => `| ${columns.map(() => " ").join(" | ")} |`);
  return ["", header, separator, ...bodyRows, ""].join("\n");
}

function positionFloatingMenu(bodyPanel: HTMLElement, anchor: HTMLElement, spacing = 6) {
  const rect = anchor.getBoundingClientRect();
  bodyPanel.style.display = "block";
  bodyPanel.style.top = `${rect.bottom + spacing}px`;
  bodyPanel.style.left = `${rect.left}px`;

  const menuRect = bodyPanel.getBoundingClientRect();
  const viewportPadding = 8;
  if (menuRect.right > window.innerWidth - viewportPadding) {
    bodyPanel.style.left = `${Math.max(viewportPadding, rect.right - menuRect.width)}px`;
  }
  if (menuRect.bottom > window.innerHeight - viewportPadding) {
    bodyPanel.style.top = `${Math.max(viewportPadding, rect.top - menuRect.height - spacing)}px`;
  }
}

export function installControlledEditModeMenu(editor: Vditor) {
  const elements = editor.vditor.toolbar?.elements;
  if (!elements) return () => {};
  const editModeItem = elements["edit-mode"];
  const originalActionButton = editModeItem?.children.item(0) as HTMLElement | null;
  const originalPanel = Array.from(editModeItem?.children ?? []).find((child) =>
    child instanceof HTMLElement && child.classList.contains("vditor-hint")
  ) as HTMLElement | undefined;

  if (!editModeItem || !originalActionButton || !originalPanel) return () => {};

  const actionButton = originalActionButton.cloneNode(true) as HTMLElement;
  originalActionButton.replaceWith(actionButton);
  originalPanel.style.display = "none";

  const bodyPanel = document.createElement("div");
  bodyPanel.className = "blog-editor-mode-menu";
  bodyPanel.innerHTML = `
    <button type="button" data-mode="wysiwyg">${getEditorI18n().wysiwyg} &lt;Alt+Ctrl+7&gt;</button>
    <button type="button" data-mode="ir">${getEditorI18n().instantRendering} &lt;Alt+Ctrl+8&gt;</button>
    <button type="button" data-mode="sv">${getEditorI18n().splitView} &lt;Alt+Ctrl+9&gt;</button>
  `;
  document.body.appendChild(bodyPanel);

  const hideMenu = () => {
    bodyPanel.style.display = "none";
  };

  const syncCurrentMode = () => {
    const currentMode = editor.getCurrentMode();
    bodyPanel.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("vditor-menu--current", button.getAttribute("data-mode") === currentMode);
    });
  };

  const showMenu = () => {
    originalPanel.style.display = "none";
    syncCurrentMode();
    positionFloatingMenu(bodyPanel, actionButton);
  };

  const toggleMenu = () => {
    if (bodyPanel.style.display === "block") {
      hideMenu();
    } else {
      showMenu();
    }
  };

  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (actionButton.classList.contains("vditor-menu--disabled")) return;
    toggleMenu();
  };

  const handleMenuClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button[data-mode]") : null;
    const mode = target?.getAttribute("data-mode");
    if (!mode) return;

    const currentMode = editor.getCurrentMode();
    const currentMd = editor.getValue();
    const wysiwygReset = (editor as unknown as {
      vditor?: { wysiwyg?: { element?: HTMLElement | null } };
    }).vditor?.wysiwyg?.element?.querySelector(".vditor-reset") as HTMLElement | null;
    const preservedMd = currentMode === "wysiwyg"
      ? preserveBlankLines(wysiwygReset, currentMd)
      : currentMd;

    originalPanel.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`)?.click();
    hideMenu();

    if (preservedMd !== currentMd || /(\n){3,}/.test(preservedMd)) {
      setTimeout(() => {
        const targetMd = expandBlankLines(preservedMd);
        if (editor.getValue() !== targetMd) {
          editor.setValue(targetMd);
        }
      }, 0);
    }
  };

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (bodyPanel.contains(target) || actionButton.contains(target))) return;
    hideMenu();
  };

  const handleViewportChange = () => {
    if (bodyPanel.style.display === "block") {
      positionFloatingMenu(bodyPanel, actionButton);
    }
  };

  actionButton.addEventListener("click", handleClick);
  bodyPanel.addEventListener("click", handleMenuClick);
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);

  return () => {
    actionButton.removeEventListener("click", handleClick);
    bodyPanel.removeEventListener("click", handleMenuClick);
    document.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("scroll", handleViewportChange, true);
    bodyPanel.remove();
  };
}

export function installControlledTableMenu(editor: Vditor) {
  const elements = editor.vditor.toolbar?.elements;
  if (!elements) return () => {};
  const tableItem = elements.table;
  const originalActionButton = tableItem?.children.item(0) as HTMLElement | null;

  if (!tableItem || !originalActionButton) return () => {};

  const actionButton = originalActionButton.cloneNode(true) as HTMLElement;
  originalActionButton.replaceWith(actionButton);

  const bodyPanel = document.createElement("div");
  bodyPanel.className = "blog-editor-table-menu";

  const status = document.createElement("div");
  status.className = "blog-editor-table-menu__status";
  status.textContent = "选择表格大小";
  bodyPanel.appendChild(status);

  const grid = document.createElement("div");
  grid.className = "blog-editor-table-menu__grid";
  bodyPanel.appendChild(grid);

  for (let row = 1; row <= TABLE_PICKER_ROWS; row++) {
    for (let column = 1; column <= TABLE_PICKER_COLUMNS; column++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "blog-editor-table-menu__cell";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute("aria-label", `${row} 行 ${column} 列`);
      grid.appendChild(cell);
    }
  }

  document.body.appendChild(bodyPanel);

  const updateActiveCells = (rowCount = 0, columnCount = 0) => {
    grid.querySelectorAll<HTMLButtonElement>(".blog-editor-table-menu__cell").forEach((cell) => {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      cell.classList.toggle("is-active", row <= rowCount && column <= columnCount);
    });
    status.textContent = rowCount && columnCount ? `${rowCount} 行 x ${columnCount} 列` : "选择表格大小";
  };

  const hideMenu = () => {
    bodyPanel.style.display = "none";
    updateActiveCells();
  };

  const toggleMenu = () => {
    if (bodyPanel.style.display === "block") {
      hideMenu();
    } else {
      positionFloatingMenu(bodyPanel, actionButton);
    }
  };

  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (actionButton.classList.contains("vditor-menu--disabled")) return;
    toggleMenu();
  };

  const handleGridMouseOver = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>(".blog-editor-table-menu__cell") : null;
    if (!target) return;
    updateActiveCells(Number(target.dataset.row), Number(target.dataset.column));
  };

  const handleGridClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>(".blog-editor-table-menu__cell") : null;
    if (!target) return;

    editor.focus();
    editor.insertMD(buildMarkdownTable(Number(target.dataset.row), Number(target.dataset.column)));
    hideMenu();
  };

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (bodyPanel.contains(target) || actionButton.contains(target))) return;
    hideMenu();
  };

  const handleWindowChange = () => hideMenu();

  actionButton.addEventListener("click", handleClick);
  grid.addEventListener("mouseover", handleGridMouseOver);
  grid.addEventListener("click", handleGridClick);
  document.addEventListener("click", handleDocumentClick, true);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);

  return () => {
    actionButton.removeEventListener("click", handleClick);
    grid.removeEventListener("mouseover", handleGridMouseOver);
    grid.removeEventListener("click", handleGridClick);
    document.removeEventListener("click", handleDocumentClick, true);
    window.removeEventListener("resize", handleWindowChange);
    window.removeEventListener("scroll", handleWindowChange, true);
    bodyPanel.remove();
  };
}

const CODE_LANGUAGE_OPTIONS = [
  { label: "纯文本", value: "" },
  { label: "Python", value: "python" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "JSON", value: "json" },
  { label: "Bash", value: "bash" },
  { label: "CSS", value: "css" },
  { label: "HTML", value: "html" },
  { label: "Markdown", value: "markdown" },
  { label: "Java", value: "java" },
  { label: "C++", value: "cpp" },
  { label: "Go", value: "go" },
  { label: "Rust", value: "rust" },
  { label: "SQL", value: "sql" },
  { label: "YAML", value: "yaml" },
  { label: "XML", value: "xml" },
  { label: "Dockerfile", value: "dockerfile" },
];

export function installCodeLanguageMenu(editor: Vditor) {
  const editorRoot = editor.vditor.element as HTMLElement | undefined;
  const editorElement =
    editorRoot?.querySelector<HTMLElement>(".vditor-wysiwyg")
    ?? editor.vditor.wysiwyg?.element as HTMLElement | undefined;
  if (!editorElement) return () => {};

  // 滚动容器(代码块超出它可视区时,浮层/标签应被裁剪或隐藏,避免溢出到编辑器外)
  const scrollContainer =
    (editorElement.closest<HTMLElement>(".vditor-content"))
    ?? editorElement.closest<HTMLElement>(".vditor") ?? null;

  // 当前激活的代码块(用于语言下拉菜单定位/改语言);高亮本身对所有块常驻
  let activeCodeBlock: HTMLElement | null = null;
  let menuOpen = false;
  // 每个代码块对应的浮层/标签实例
  interface CodeBlockUI {
    trigger: HTMLButtonElement;
    overlay: HTMLPreElement;
    overlayCode: HTMLElement;
    renderId: number;
  }
  const codeBlockUIs = new Map<HTMLElement, CodeBlockUI>();
  const codeBlockLanguages = new WeakMap<HTMLElement, string>();

  // 语言下拉菜单:全局共享一份
  const menu = document.createElement("div");
  menu.className = "blog-editor-code-language-menu";
  menu.innerHTML = `
    <input class="blog-editor-code-language-search" type="text" placeholder="搜索" aria-label="搜索代码语言" />
    <div class="blog-editor-code-language-options" role="menu"></div>
  `;
  const searchInput = menu.querySelector<HTMLInputElement>(".blog-editor-code-language-search");
  const options = menu.querySelector<HTMLDivElement>(".blog-editor-code-language-options");

  CODE_LANGUAGE_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "blog-editor-code-language-option";
    button.dataset.language = option.value;
    button.textContent = option.label;
    button.setAttribute("role", "menuitem");
    options?.appendChild(button);
  });

  document.body.append(menu);

  const getCodeBlockFromTarget = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const codeBlock = element?.closest<HTMLElement>('div.vditor-wysiwyg__block[data-type="code-block"]');
    return codeBlock && editorElement.contains(codeBlock) ? codeBlock : null;
  };

  const getCodeElement = (codeBlock: HTMLElement | null) => {
    if (!codeBlock) return null;
    const visibleCode = Array.from(codeBlock.querySelectorAll<HTMLElement>("pre code")).find((code) => {
      const pre = code.closest("pre");
      const rect = code.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (!pre || window.getComputedStyle(pre).display !== "none");
    });
    return visibleCode ?? codeBlock.querySelector<HTMLElement>("pre code");
  };

  const normalizeCodeElement = (codeElement: HTMLElement) => {
    const hasInjectedHighlight = codeElement.classList.contains("hljs") || Boolean(codeElement.querySelector("[class^='hljs-'], .hljs"));
    if (hasInjectedHighlight) codeElement.textContent = codeElement.textContent ?? "";
    codeElement.classList.remove("hljs");
  };

  const getLanguage = (codeBlock: HTMLElement | null) => {
    const cachedLanguage = codeBlock ? codeBlockLanguages.get(codeBlock) : "";
    if (cachedLanguage !== undefined) return cachedLanguage;
    const codeElement = getCodeElement(codeBlock);
    const languageClass = Array.from(codeElement?.classList ?? []).find((className) => className.startsWith("language-"));
    return languageClass?.replace("language-", "") ?? "";
  };

  const languageLabel = (language: string) => {
    if (!language) return "plaintext";
    const found = CODE_LANGUAGE_OPTIONS.find((option) => option.value === language);
    return found?.label ?? language;
  };

  const updateTriggerText = (codeBlock: HTMLElement) => {
    const ui = codeBlockUIs.get(codeBlock);
    if (ui) ui.trigger.textContent = languageLabel(getLanguage(codeBlock));
  };

  const updateActiveOption = () => {
    const language = getLanguage(activeCodeBlock);
    menu.querySelectorAll<HTMLButtonElement>(".blog-editor-code-language-option").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.language === language);
    });
  };

  const filterOptions = () => {
    const query = searchInput?.value.trim().toLowerCase() ?? "";
    menu.querySelectorAll<HTMLButtonElement>(".blog-editor-code-language-option").forEach((button) => {
      const value = button.dataset.language ?? "";
      const label = button.textContent?.toLowerCase() ?? "";
      button.hidden = Boolean(query) && !value.includes(query) && !label.includes(query);
    });
  };

  const escapeHtml = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const isOutsideViewport = (rect: DOMRect) => {
    if (!scrollContainer) return false;
    const cr = scrollContainer.getBoundingClientRect();
    const above = rect.bottom <= cr.top + 1;
    const below = rect.top >= cr.bottom - 1;
    const left = rect.right <= cr.left + 1;
    const right = rect.left >= cr.right - 1;
    return above || below || left || right;
  };

  // 将 fixed 定位的浮层裁剪到滚动容器可视区内(避免溢出到编辑器外)
  const clipToScrollContainer = (rect: DOMRect) => {
    if (!scrollContainer) return { top: rect.top, height: rect.height, visible: true };
    const cr = scrollContainer.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, cr.top);
    const visibleBottom = Math.min(rect.bottom, cr.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    return { top: visibleTop, height: visibleHeight, visible: visibleHeight > 1 };
  };

  const positionTrigger = (codeBlock: HTMLElement) => {
    const ui = codeBlockUIs.get(codeBlock);
    if (!ui) return;
    const rect = codeBlock.getBoundingClientRect();
    // 标签贴在代码块顶部内侧;代码块顶部滚出可视区(或完全滚出)则隐藏标签
    const topOutside = scrollContainer
      ? rect.top + 6 < scrollContainer.getBoundingClientRect().top
      : rect.top + 6 < 8;
    if (topOutside || isOutsideViewport(rect)) {
      ui.trigger.style.display = "none";
      return;
    }
    ui.trigger.style.display = "inline-flex";
    ui.trigger.style.top = `${Math.max(8, rect.top + 6)}px`;
    ui.trigger.style.left = `${Math.max(8, rect.left + 11)}px`;
  };

  const positionHighlightOverlay = (codeBlock: HTMLElement, codeElement: HTMLElement) => {
    const ui = codeBlockUIs.get(codeBlock);
    if (!ui) return;
    const rect = codeElement.getBoundingClientRect();
    // 代码块完全在可视区外 → 隐藏浮层,避免内容溢出到编辑器外
    if (isOutsideViewport(rect)) {
      ui.overlay.style.display = "none";
      return;
    }
    const styles = window.getComputedStyle(codeElement);
    const { top, height, visible } = clipToScrollContainer(rect);
    if (!visible) {
      ui.overlay.style.display = "none";
      return;
    }
    // 浮层裁剪到滚动容器可视区内:
    //   - 浮层本身定位在可视区顶部(top),高度 = 可视高度(height)
    //   - 浮层内容(完整代码)需向上偏移「被裁掉的顶部高度」,使可见部分与真实代码对齐
    //     被裁掉的顶部高度 = visibleTop - rect.top(当 rect.top < visibleTop 即代码块顶部滚出时为正)
    //     内容 translateY 取负值(向上)= rect.top - top
    const offsetY = rect.top - top;
    ui.overlay.style.display = "block";
    ui.overlay.style.top = `${top}px`;
    ui.overlay.style.left = `${rect.left}px`;
    ui.overlay.style.width = `${rect.width}px`;
    ui.overlay.style.height = `${height}px`;
    ui.overlay.style.minHeight = `${height}px`;
    ui.overlay.style.fontFamily = styles.fontFamily;
    ui.overlay.style.fontSize = styles.fontSize;
    ui.overlay.style.fontWeight = styles.fontWeight;
    ui.overlay.style.lineHeight = styles.lineHeight;
    ui.overlay.style.letterSpacing = styles.letterSpacing;
    ui.overlay.style.tabSize = styles.tabSize;
    // 复制真实 code 的 padding,确保两层可用内容宽度一致,避免换行位置不同导致错位
    ui.overlayCode.style.padding = styles.padding;
    ui.overlayCode.style.transform = `translateY(${offsetY}px)`;
  };

  const positionMenu = () => {
    if (!activeCodeBlock) return;
    const ui = codeBlockUIs.get(activeCodeBlock);
    if (!ui) return;
    const triggerRect = ui.trigger.getBoundingClientRect();
    menu.style.display = "block";

    const spacing = 6;
    const menuRect = menu.getBoundingClientRect();
    const belowTop = triggerRect.bottom + spacing;
    const aboveTop = triggerRect.top - menuRect.height - spacing;
    const top = belowTop + menuRect.height <= window.innerHeight - spacing ? belowTop : Math.max(spacing, aboveTop);
    const left = Math.min(
      Math.max(spacing, triggerRect.left),
      Math.max(spacing, window.innerWidth - menuRect.width - spacing)
    );
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  };

  const closeMenu = () => {
    menuOpen = false;
    const ui = activeCodeBlock ? codeBlockUIs.get(activeCodeBlock) : null;
    if (ui) ui.trigger.setAttribute("aria-expanded", "false");
    menu.style.display = "none";
  };

  const renderHighlightOverlay = async (codeBlock: HTMLElement) => {
    const ui = codeBlockUIs.get(codeBlock);
    if (!ui) return;
    const renderId = ui.renderId + 1;
    ui.renderId = renderId;

    const codeElement = getCodeElement(codeBlock);
    if (!codeElement) return;
    normalizeCodeElement(codeElement);

    const language = getLanguage(codeBlock);
    const plainText = codeElement.textContent ?? "";

    // 高亮始终常驻:即便没有语言,也保留透明覆盖(真实文本可见)
    codeBlock.classList.add("blog-editor-code-block--highlighted");
    positionHighlightOverlay(codeBlock, codeElement);
    ui.overlayCode.className = language ? `language-${language} hljs` : "hljs";
    ui.overlayCode.textContent = plainText;

    if (!language || !plainText) {
      ui.overlayCode.innerHTML = escapeHtml(plainText);
      return;
    }

    await loadHighlightJs();
    if (renderId !== ui.renderId) return;

    const highlighter = (window as typeof window & {
      hljs?: {
        highlight?: (code: string, options: { language: string; ignoreIllegals?: boolean }) => { value: string };
        getLanguage?: (language: string) => unknown;
      };
    }).hljs;

    if (!highlighter || !highlighter.getLanguage?.(language)) {
      ui.overlayCode.innerHTML = escapeHtml(plainText);
      return;
    }

    try {
      const result = highlighter.highlight?.(plainText, { language, ignoreIllegals: true });
      if (result?.value) {
        ui.overlayCode.innerHTML = result.value;
        return;
      }
    } catch {
      ui.overlayCode.innerHTML = escapeHtml(plainText);
    }
  };

  const createUIForBlock = (codeBlock: HTMLElement) => {
    if (codeBlockUIs.has(codeBlock)) return codeBlockUIs.get(codeBlock)!;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "blog-editor-code-language-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = languageLabel(getLanguage(codeBlock));

    const overlay = document.createElement("pre");
    overlay.className = "blog-editor-code-highlight-overlay";
    const overlayCode = document.createElement("code");
    overlay.appendChild(overlayCode);

    document.body.append(trigger, overlay);
    const ui: CodeBlockUI = { trigger, overlay, overlayCode, renderId: 0 };
    codeBlockUIs.set(codeBlock, ui);

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeCodeBlock = codeBlock;
      menuOpen = !menuOpen;
      trigger.setAttribute("aria-expanded", String(menuOpen));
      if (!menuOpen) {
        closeMenu();
        return;
      }
      if (searchInput) searchInput.value = "";
      updateTriggerText(codeBlock);
      updateActiveOption();
      positionTrigger(codeBlock);
      filterOptions();
      positionMenu();
      searchInput?.focus();
    });

    return ui;
  };

  const mountBlock = (codeBlock: HTMLElement) => {
    createUIForBlock(codeBlock);
    codeBlock.classList.add("blog-editor-code-block--highlighted");
    updateTriggerText(codeBlock);
    positionTrigger(codeBlock);
    void renderHighlightOverlay(codeBlock);
  };

  const unmountBlock = (codeBlock: HTMLElement) => {
    const ui = codeBlockUIs.get(codeBlock);
    if (!ui) return;
    ui.trigger.remove();
    ui.overlay.remove();
    codeBlock.classList.remove("blog-editor-code-block--highlighted");
    codeBlockUIs.delete(codeBlock);
    if (activeCodeBlock === codeBlock) {
      activeCodeBlock = null;
      closeMenu();
    }
  };

  const syncAllBlocks = () => {
    const currentBlocks = new Set(
      Array.from(editorElement.querySelectorAll<HTMLElement>('div.vditor-wysiwyg__block[data-type="code-block"]'))
    );
    for (const block of Array.from(codeBlockUIs.keys())) {
      if (!currentBlocks.has(block)) unmountBlock(block);
    }
    for (const block of currentBlocks) {
      if (!codeBlockUIs.has(block)) mountBlock(block);
    }
    // 全部重新定位 + 重渲染(内容可能变化)
    for (const block of currentBlocks) {
      positionTrigger(block);
      void renderHighlightOverlay(block);
    }
  };

  const setLanguage = (language: string) => {
    if (!activeCodeBlock) return;
    const codeElement = getCodeElement(activeCodeBlock);
    if (!codeElement) return;

    normalizeCodeElement(codeElement);
    Array.from(codeElement.classList)
      .filter((className) => className.startsWith("language-"))
      .forEach((className) => codeElement.classList.remove(className));
    codeBlockLanguages.set(activeCodeBlock, language);
    if (language) codeElement.classList.add(`language-${language}`);

    updateTriggerText(activeCodeBlock);
    updateActiveOption();
    void renderHighlightOverlay(activeCodeBlock);
  };

  // hover/focus 只用于:把鼠标所在块设为 active(便于点 trigger 开菜单)。
  // 高亮与语言标签不再随 hover 显隐——它们对所有块常驻。
  const handleEditorPointerOver = (event: MouseEvent | FocusEvent) => {
    const codeBlock = getCodeBlockFromTarget(event.target);
    if (codeBlock) {
      activeCodeBlock = codeBlock;
      updateActiveOption();
    }
  };

  const handleTriggerClick = (event: MouseEvent) => {
    // trigger 自身的点击在 createUIForBlock 里绑定;此函数保留给可能的代理点击
    event.preventDefault();
    event.stopPropagation();
  };

  const handleMenuClick = (event: MouseEvent) => {
    const option = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>(".blog-editor-code-language-option")
      : null;
    if (!option) return;

    event.preventDefault();
    event.stopPropagation();
    setLanguage(option.dataset.language ?? "");
    closeMenu();
  };

  const handleSearchInput = () => {
    filterOptions();
  };

  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !searchInput) return;
    event.preventDefault();
    setLanguage(searchInput.value.trim().toLowerCase());
    closeMenu();
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    // 仅当点击落在语言下拉菜单内、或某个语言标签按钮上时保持打开(由各自处理);
    // 点击编辑器正文/代码块/页面其他位置一律收起菜单,避免只能再点一次按钮才消失
    if (target && menu.contains(target)) return;
    for (const ui of codeBlockUIs.values()) {
      if (ui.trigger.contains(target as Node)) return;
    }
    closeMenu();
  };

  const handleViewportChange = () => {
    for (const block of codeBlockUIs.keys()) {
      positionTrigger(block);
      const codeElement = getCodeElement(block);
      if (codeElement) positionHighlightOverlay(block, codeElement);
    }
    if (!menuOpen) return;
    // 菜单跟随代码块:代码块在可视区(trigger 可见)→ 跟随定位并显示;
    // 代码块滚出可视区(trigger 被收起)→ 仅视觉隐藏(保持打开状态),滑回来由 positionMenu 自动重现
    const activeUI = activeCodeBlock ? codeBlockUIs.get(activeCodeBlock) : null;
    if (!activeUI || activeUI.trigger.style.display === "none") {
      menu.style.display = "none";
      return;
    }
    positionMenu();
  };

  // 编辑器内任何输入都可能改动代码块内容/结构 → 全量同步
  let syncScheduled = false;
  const scheduleSync = () => {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(() => {
      syncScheduled = false;
      syncAllBlocks();
    });
  };

  const handleEditorInput = () => {
    scheduleSync();
  };

  // DOM 变更观察:代码块增删时同步
  const mutationObserver = new MutationObserver((mutations) => {
    let needsSync = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length || mutation.removedNodes.length) {
        needsSync = true;
        break;
      }
    }
    if (needsSync) scheduleSync();
  });
  mutationObserver.observe(editorElement, { childList: true, subtree: true });

  // 初始化:挂载所有代码块的 UI(trigger 语言标签按钮 + 高亮覆盖层)。
  // Vditor 代码块是异步渲染的,首次进入编辑页时序不确定
  // (HMR/组件重建都可能让代码块晚于 initAll 出现),用轮询兜底直到全部挂载或达到上限。
  // 关键:不在此处 await loadHighlightJs——trigger 的挂载不依赖高亮库,高亮由
  // renderHighlightOverlay 内部按需异步加载。预先等待会让 hljs 脚本加载挂起(不触发
  // load/error)时永久卡住 poll,导致语言按钮间歇性丢失(刷新几次就不出现)。
  const initAll = () => {
    const maxAttempts = 20; // 约 4 秒(20 × 200ms)
    let attempt = 0;
    const poll = () => {
      const blocks = editorElement.querySelectorAll<HTMLElement>('div.vditor-wysiwyg__block[data-type="code-block"]');
      const allMounted = blocks.length > 0 && Array.from(blocks).every((b) => codeBlockUIs.has(b) && b.classList.contains("blog-editor-code-block--highlighted"));
      syncAllBlocks();
      attempt += 1;
      if (!allMounted && attempt < maxAttempts) {
        setTimeout(poll, 200);
      }
    };
    poll();
  };
  void initAll();

  editorElement.addEventListener("pointerover", handleEditorPointerOver);
  editorElement.addEventListener("focusin", handleEditorPointerOver);
  editorElement.addEventListener("input", handleEditorInput);
  document.addEventListener("selectionchange", handleEditorPointerOver);
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
  menu.addEventListener("click", handleMenuClick);
  searchInput?.addEventListener("input", handleSearchInput);
  searchInput?.addEventListener("keydown", handleSearchKeydown);
  // editorElement 上的代理 click(兜底,正常逻辑由各 trigger 自身处理)
  editorElement.addEventListener("click", handleTriggerClick);

  return () => {
    editorElement.removeEventListener("pointerover", handleEditorPointerOver);
    editorElement.removeEventListener("focusin", handleEditorPointerOver);
    editorElement.removeEventListener("input", handleEditorInput);
    document.removeEventListener("selectionchange", handleEditorPointerOver);
    document.removeEventListener("mousedown", handleDocumentMouseDown, true);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("scroll", handleViewportChange, true);
    menu.removeEventListener("click", handleMenuClick);
    searchInput?.removeEventListener("input", handleSearchInput);
    searchInput?.removeEventListener("keydown", handleSearchKeydown);
    editorElement.removeEventListener("click", handleTriggerClick);
    mutationObserver.disconnect();
    for (const block of Array.from(codeBlockUIs.keys())) unmountBlock(block);
    menu.remove();
  };
}

export function installTableCellMenu(editor: Vditor, onContentChange: (value: string) => void) {
  const editorElement = editor.vditor.wysiwyg?.element as HTMLElement | undefined;
  if (!editorElement) return () => {};

  let activeCell: HTMLTableCellElement | null = null;
  const menu = document.createElement("div");
  menu.className = "blog-editor-table-cell-menu";
  menu.innerHTML = `
    <button type="button" class="blog-editor-table-cell-menu__trigger" data-action="toggle-menu" aria-expanded="false">
      表格工具
      <span aria-hidden="true">▾</span>
    </button>
    <div class="blog-editor-table-cell-menu__dropdown" role="menu">
      <button type="button" data-action="row-above" role="menuitem">上方插入行</button>
      <button type="button" data-action="row-below" role="menuitem">下方插入行</button>
      <button type="button" data-action="column-left" role="menuitem">左侧插入列</button>
      <button type="button" data-action="column-right" role="menuitem">右侧插入列</button>
      <span class="blog-editor-table-cell-menu__divider"></span>
      <button type="button" data-action="delete-row" role="menuitem">删除当前行</button>
      <button type="button" data-action="delete-column" role="menuitem">删除当前列</button>
    </div>
  `;
  document.body.appendChild(menu);
  const trigger = menu.querySelector<HTMLButtonElement>(".blog-editor-table-cell-menu__trigger");

  const hideMenu = () => {
    menu.style.display = "none";
    menu.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
    activeCell = null;
  };

  const positionMenu = () => {
    if (!activeCell) return;
    const rect = activeCell.getBoundingClientRect();
    menu.style.display = "flex";

    const menuRect = menu.getBoundingClientRect();
    const viewportPadding = 8;
    const top = rect.top - menuRect.height - 8;
    menu.style.top = `${top >= viewportPadding ? top : rect.bottom + 8}px`;
    menu.style.left = `${Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - menuRect.width - viewportPadding)}px`;
  };

  const getCellFromNode = (node: Node | null) => {
    const element = node instanceof Element ? node : node?.parentElement;
    const cell = element?.closest<HTMLTableCellElement>("td, th");
    return cell && editorElement.contains(cell) ? cell : null;
  };

  const updateFromSelection = () => {
    const selection = window.getSelection();
    const cell = getCellFromNode(selection?.anchorNode ?? null) || getCellFromNode(document.activeElement);
    if (!cell) {
      if (!menu.matches(":hover")) hideMenu();
      return;
    }
    activeCell = cell;
    positionMenu();
  };

  const createCell = (tagName: "td" | "th", reference?: HTMLTableCellElement | null) => {
    const cell = document.createElement(tagName);
    const align = reference?.getAttribute("align");
    if (align) cell.setAttribute("align", align);
    cell.innerHTML = " ";
    return cell;
  };

  const syncEditorValue = () => {
    editorElement.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    window.setTimeout(() => onContentChange(editor.getValue()), 0);
  };

  const insertRow = (position: "above" | "below") => {
    if (!activeCell) return;
    const row = activeCell.parentElement as HTMLTableRowElement | null;
    const table = activeCell.closest("table");
    if (!row || !table) return;

    const isHeaderRow = row.parentElement?.tagName === "THEAD";
    const tagName: "td" | "th" = position === "above" && isHeaderRow ? "th" : "td";
    const newRow = document.createElement("tr");
    Array.from(row.cells).forEach((cell) => newRow.appendChild(createCell(tagName, cell)));

    if (position === "below" && isHeaderRow) {
      const tbody = table.tBodies[0] || table.createTBody();
      tbody.insertBefore(newRow, tbody.firstElementChild);
    } else {
      row.insertAdjacentElement(position === "above" ? "beforebegin" : "afterend", newRow);
    }
    syncEditorValue();
    activeCell = newRow.cells[Math.min(activeCell.cellIndex, newRow.cells.length - 1)] || activeCell;
    positionMenu();
  };

  const insertColumn = (position: "left" | "right") => {
    if (!activeCell) return;
    const table = activeCell.closest("table");
    if (!table) return;
    const cellIndex = activeCell.cellIndex;

    Array.from(table.rows).forEach((row) => {
      const reference = row.cells[cellIndex];
      if (!reference) return;
      const tagName = reference.tagName === "TH" ? "th" : "td";
      reference.insertAdjacentElement(position === "left" ? "beforebegin" : "afterend", createCell(tagName, reference));
    });
    syncEditorValue();
    positionMenu();
  };

  const deleteRow = () => {
    if (!activeCell) return;
    const row = activeCell.parentElement as HTMLTableRowElement | null;
    const table = activeCell.closest("table");
    if (!row || !table) return;
    if (table.rows.length <= 1) {
      table.remove();
      hideMenu();
    } else {
      const nextCell = row.nextElementSibling?.querySelector<HTMLTableCellElement>("td, th")
        || row.previousElementSibling?.querySelector<HTMLTableCellElement>("td, th");
      row.remove();
      activeCell = nextCell || null;
      positionMenu();
    }
    syncEditorValue();
  };

  const deleteColumn = () => {
    if (!activeCell) return;
    const table = activeCell.closest("table");
    if (!table) return;
    const cellIndex = activeCell.cellIndex;
    const firstRow = table.rows[0];
    if (!firstRow || firstRow.cells.length <= 1) {
      table.remove();
      hideMenu();
    } else {
      Array.from(table.rows).forEach((row) => row.cells[cellIndex]?.remove());
      activeCell = table.rows[0]?.cells[Math.max(0, cellIndex - 1)] || null;
      positionMenu();
    }
    syncEditorValue();
  };

  const handleMenuMouseDown = (event: MouseEvent) => {
    event.preventDefault();
  };

  const handleMenuClick = (event: MouseEvent) => {
    event.preventDefault();
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button[data-action]") : null;
    const action = target?.dataset.action;
    if (!action) return;

    if (action === "toggle-menu") {
      const open = !menu.classList.contains("is-open");
      menu.classList.toggle("is-open", open);
      trigger?.setAttribute("aria-expanded", String(open));
      positionMenu();
      return;
    }

    if (action === "row-above") insertRow("above");
    if (action === "row-below") insertRow("below");
    if (action === "column-left") insertColumn("left");
    if (action === "column-right") insertColumn("right");
    if (action === "delete-row") deleteRow();
    if (action === "delete-column") deleteColumn();
    menu.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
  };

  const handleDocumentMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (menu.contains(target) || editorElement.contains(target))) return;
    hideMenu();
  };

  editorElement.addEventListener("mouseup", updateFromSelection);
  editorElement.addEventListener("keyup", updateFromSelection);
  editorElement.addEventListener("focusin", updateFromSelection);
  document.addEventListener("selectionchange", updateFromSelection);
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  menu.addEventListener("mousedown", handleMenuMouseDown);
  menu.addEventListener("click", handleMenuClick);
  window.addEventListener("resize", positionMenu);
  window.addEventListener("scroll", positionMenu, true);

  return () => {
    editorElement.removeEventListener("mouseup", updateFromSelection);
    editorElement.removeEventListener("keyup", updateFromSelection);
    editorElement.removeEventListener("focusin", updateFromSelection);
    document.removeEventListener("selectionchange", updateFromSelection);
    document.removeEventListener("mousedown", handleDocumentMouseDown, true);
    menu.removeEventListener("mousedown", handleMenuMouseDown);
    menu.removeEventListener("click", handleMenuClick);
    window.removeEventListener("resize", positionMenu);
    window.removeEventListener("scroll", positionMenu, true);
    menu.remove();
  };
}
