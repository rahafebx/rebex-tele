// Browser-only helper for the contenteditable editors: wraps the current
// selection in a `.spoiler` span (or unwraps an existing one). The span is
// converted to Telegram's `<tg-spoiler>` by editorHtmlToTelegramHtml.
export function toggleSpoiler(editor: HTMLElement) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  let node: Node | null =
    common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  let existing: HTMLElement | null = null;
  while (node && node !== editor) {
    if (node instanceof HTMLElement && node.classList.contains("spoiler")) {
      existing = node;
      break;
    }
    node = node.parentElement;
  }
  if (existing) {
    const parent = existing.parentElement;
    const anchor = existing.nextSibling;
    while (existing.firstChild)
      parent?.insertBefore(existing.firstChild, anchor);
    parent?.removeChild(existing);
  } else {
    const span = document.createElement("span");
    span.className = "spoiler";
    try {
      range.surroundContents(span);
    } catch {
      const text = sel
        .toString()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      if (text)
        document.execCommand(
          "insertHTML",
          false,
          `<span class="spoiler">${text}</span>`,
        );
    }
  }
  sel.removeAllRanges();
}

// Same wrapping helper for highlight: wraps the selection in a `<mark>` tag
// (or unwraps an existing one). Converted to Telegram's rich-HTML `<mark>`.
export function toggleMark(editor: HTMLElement) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  let node: Node | null =
    common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  let existing: HTMLElement | null = null;
  while (node && node !== editor) {
    if (
      node instanceof HTMLElement &&
      node.tagName.toLowerCase() === "mark"
    ) {
      existing = node;
      break;
    }
    node = node.parentElement;
  }
  if (existing) {
    const parent = existing.parentElement;
    const anchor = existing.nextSibling;
    while (existing.firstChild)
      parent?.insertBefore(existing.firstChild, anchor);
    parent?.removeChild(existing);
  } else {
    const mark = document.createElement("mark");
    try {
      range.surroundContents(mark);
    } catch {
      const text = sel
        .toString()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      if (text) document.execCommand("insertHTML", false, `<mark>${text}</mark>`);
    }
  }
  sel.removeAllRanges();
}

// Inline code: wraps the selection in a `<code>` tag (or unwraps an existing
// one). Chrome's execCommand("formatBlock", "CODE") is a silent no-op because
// formatBlock only accepts block-level tags, so the wrap is done manually here.
// `<code>` is part of BOTH Telegram HTML allowlists (classic and rich).
export function toggleCode(editor: HTMLElement) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  let node: Node | null =
    common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  let existing: HTMLElement | null = null;
  while (node && node !== editor) {
    if (
      node instanceof HTMLElement &&
      node.tagName.toLowerCase() === "code"
    ) {
      existing = node;
      break;
    }
    node = node.parentElement;
  }
  if (existing) {
    const parent = existing.parentElement;
    const anchor = existing.nextSibling;
    while (existing.firstChild)
      parent?.insertBefore(existing.firstChild, anchor);
    parent?.removeChild(existing);
  } else {
    const code = document.createElement("code");
    try {
      range.surroundContents(code);
    } catch {
      const text = sel
        .toString()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      if (text)
        document.execCommand("insertHTML", false, `<code>${text}</code>`);
    }
  }
  sel.removeAllRanges();
}