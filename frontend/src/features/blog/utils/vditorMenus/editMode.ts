import Vditor from "vditor";

import { expandBlankLines, preserveBlankLines } from "../markdownBlankLines";

import { positionFloatingMenu } from "./shared";

type VditorOptions = NonNullable<ConstructorParameters<typeof Vditor>[1]>;
type VditorI18n = NonNullable<VditorOptions["i18n"]>;

export function getEditorI18n(): VditorI18n {
  return {
    ...(window as typeof window & { VditorI18n: VditorI18n }).VditorI18n,
    splitView: "源码模式",
  };
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
    }).vditor?.wysiwyg?.element?.querySelector<HTMLElement>(".vditor-reset");
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
