import Vditor from "vditor";

import { positionFloatingMenu } from "./shared";

const TABLE_PICKER_ROWS = 6;
const TABLE_PICKER_COLUMNS = 6;

function buildMarkdownTable(rowCount: number, columnCount: number) {
  const columns = Array.from({ length: columnCount }, (_, index) => `列 ${index + 1}`);
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const bodyRows = Array.from({ length: Math.max(1, rowCount - 1) }, () => `| ${columns.map(() => " ").join(" | ")} |`);
  return ["", header, separator, ...bodyRows, ""].join("\n");
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
