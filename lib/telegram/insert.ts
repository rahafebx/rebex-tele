// Browser-only helpers for the contenteditable editors. They keep the rich
// blocks pleasant to edit: block inserts place the caret on a fresh line, an
// Enter on an empty last list item exits the list, and right-clicking inside a
// table opens a small edit menu (add/remove rows & columns).

let blockMarkerSeq = 0;

function freshParagraph(): HTMLParagraphElement {
  const p = document.createElement("p");
  p.innerHTML = "<br/>";
  return p;
}

export function placeCaretAtStart(el: HTMLElement) {
  const range = document.createRange();
  range.setStart(el, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// Inserts a block element (table, hr, footer, details, ...) and moves the
// caret into a new empty paragraph right after it, so the admin can continue
// typing on a fresh line instead of ending up inside the inserted block.
export function insertBlock(editor: HTMLElement, html: string) {
  editor.focus();
  const marker = document.createElement("span");
  marker.id = `ed-insert-${Date.now()}-${blockMarkerSeq++}`;
  document.execCommand("insertHTML", false, html + marker.outerHTML);
  const mark = document.getElementById(marker.id);
  if (!mark) return;
  const parent = mark.parentElement ?? editor;
  const anchor = mark.nextSibling;
  mark.remove();
  // Ascend to the top-level block carrying the inserted content so the caret
  // lands right after it (handles insertion inside a paragraph or a cell).
  let root = parent;
  while (
    root !== editor &&
    root.parentElement &&
    root.parentElement !== editor
  ) {
    root = root.parentElement;
  }
  const p = freshParagraph();
  if (root === editor) {
    editor.insertBefore(p, anchor);
  } else {
    root.parentElement?.insertBefore(p, root.nextSibling);
  }
  placeCaretAtStart(p);
}

// Handles Enter pressed while the caret is in the LAST, empty list item:
// removes the item (and the list if it becomes empty) and moves to a new
// paragraph. Returns true when it consumed the key.
export function exitListOnEnter(editor: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const node = sel.anchorNode;
  if (!node) return false;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  if (!el) return false;
  const li = el instanceof HTMLElement ? el.closest("li") : null;
  if (!li || li.nextElementSibling) return false;
  const list = li.parentElement;
  if (!list) return false;
  const tag = list.tagName.toLowerCase();
  if (tag !== "ul" && tag !== "ol") return false;
  if ((li.textContent ?? "").replace(/\u00a0/g, "").trim() !== "") return false;
  const parent = list.parentElement;
  const anchor = list.nextSibling;
  li.remove();
  if (!list.querySelector("li")) list.remove();
  const p = freshParagraph();
  if (parent) parent.insertBefore(p, anchor);
  placeCaretAtStart(p);
  editor.focus();
  return true;
}

// Right-click menu for editing tables inside the editor. Returns true when
// the click happened inside a table cell (and the menu was shown).
export function showTableMenu(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const cell = target.closest("td, th") as HTMLTableCellElement | null;
  if (!cell) return false;
  event.preventDefault();
  const table = cell.closest("table");
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!table || !row || !row.parentElement) return false;
  const colIndex = cell.cellIndex;

  const editCell = (el: HTMLElement) => {
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const rowCount = () => table.rows.length;
  const columnCount = () =>
    Math.max(
      1,
      ...Array.from(table.rows).map((r) => r.cells.length),
    );

  const insertRow = (after: boolean) => {
    const tr = table.insertRow(
      after ? row.rowIndex + 1 : row.rowIndex,
    );
    const header = row.cells[0]?.tagName.toLowerCase() === "th";
    for (let i = 0; i < columnCount(); i++) {
      const cellEl = document.createElement(header ? "th" : "td");
      cellEl.innerHTML = "<br/>";
      tr.appendChild(cellEl);
    }
    editCell(tr.cells[0]);
  };

  const insertColumn = (before: boolean) => {
    for (const r of Array.from(table.rows)) {
      const header = r.cells[0]?.tagName.toLowerCase() === "th";
      const idx = Math.min(
        colIndex + (before ? 0 : 1),
        r.cells.length,
      );
      const cellEl = document.createElement(header ? "th" : "td");
      cellEl.innerHTML = "<br/>";
      r.insertBefore(cellEl, r.cells[idx] ?? null);
    }
    const cells = row.cells;
    const target = cells[Math.min(colIndex + (before ? 0 : 1), cells.length - 1)];
    if (target) editCell(target);
  };

  const deleteRow = () => {
    if (rowCount() <= 1) return;
    const next =
      (row.nextElementSibling as HTMLTableRowElement | null) ??
      (row.previousElementSibling as HTMLTableRowElement | null);
    row.remove();
    if (next?.cells[0]) editCell(next.cells[0]);
  };

  const deleteColumn = () => {
    if (columnCount() <= 1) return;
    for (const r of Array.from(table.rows)) {
      if (r.cells[colIndex]) r.deleteCell(colIndex);
    }
    if (row.cells[0]) editCell(row.cells[0]);
  };

  const deleteTable = () => {
    const parentEl = table.parentElement;
    const p = freshParagraph();
    parentEl?.insertBefore(p, table.nextSibling);
    table.remove();
    placeCaretAtStart(p);
  };

  const dark = document.documentElement.classList.contains("dark");
  const hover = dark ? "var(--color-ink-800)" : "var(--color-ink-50)";

  const menu = document.createElement("div");
  menu.dir = "rtl";
  menu.style.position = "fixed";
  menu.style.zIndex = "1000";
  menu.style.minWidth = "185px";
  menu.style.padding = "4px";
  menu.style.border = "1px solid var(--border)";
  menu.style.borderRadius = "8px";
  menu.style.background = "var(--card)";
  menu.style.boxShadow = "0 8px 24px rgb(0 0 0 / 0.14)";
  menu.style.fontSize = "14px";
  menu.style.lineHeight = "1.5";

  const addAction = (label: string, run: () => void, danger = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.textAlign = "right";
    btn.style.padding = "6px 10px";
    btn.style.border = "0";
    btn.style.background = "transparent";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.color = danger ? "var(--danger)" : "var(--foreground)";
    btn.addEventListener("mouseenter", () => (btn.style.background = hover));
    btn.addEventListener("mouseleave", () => (btn.style.background = "transparent"));
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      run();
      close();
    });
    menu.appendChild(btn);
  };

  const separator = () => {
    const div = document.createElement("div");
    div.style.margin = "4px 8px";
    div.style.borderTop = "1px solid var(--border)";
    menu.appendChild(div);
  };

  addAction("إدراج صف فوق", () => insertRow(false));
  addAction("إدراج صف تحت", () => insertRow(true));
  addAction("إدراج عمود قبل", () => insertColumn(true));
  addAction("إدراج عمود بعد", () => insertColumn(false));
  separator();
  addAction("حذف الصف", deleteRow, true);
  addAction("حذف العمود", deleteColumn, true);
  addAction("حذف الجدول", deleteTable, true);

  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", close);
  };
  const onDocDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const onScroll = () => close();

  document.body.appendChild(menu);
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onKey);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", close);

  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(
    event.clientX,
    window.innerWidth - rect.width - 8,
  )}px`;
  menu.style.top = `${Math.min(
    event.clientY,
    window.innerHeight - rect.height - 8,
  )}px`;
  return true;
}