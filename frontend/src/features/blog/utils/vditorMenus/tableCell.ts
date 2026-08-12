import Vditor from "vditor";

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
