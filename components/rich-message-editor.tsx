"use client";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code2,
  Link as LinkIcon,
  Quote,
  EyeOff,
  Heading2,
  Highlighter,
  List,
  ListOrdered,
  Table2,
  SeparatorHorizontal,
  PanelBottom,
  ChevronDown,
  Pilcrow,
} from "lucide-react";
import { toggleSpoiler, toggleMark, toggleCode } from "@/lib/telegram/spoiler";
import {
  insertBlock,
  showTableMenu,
  exitListOnEnter,
} from "@/lib/telegram/insert";
import { EditViewToggle, type EditView } from "@/components/edit-view-toggle";

function Tool({
  title,
  onClick,
  children,
  active,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active ?? undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded-md p-2 ${active ? "bg-[var(--color-ink-100)] text-[var(--foreground)] dark:bg-[var(--color-ink-800)]" : "text-[var(--muted)] hover:bg-[var(--color-ink-50)] hover:text-[var(--foreground)] dark:hover:bg-[var(--color-ink-800)]"}`}
    >
      {children}
    </button>
  );
}

export type RichMessageEditorHandle = {
  /** Current content, view-aware (source → textarea value; preview → innerHTML). */
  getHTML: () => string;
  /** Replace content in whichever view is active. */
  setHTML: (html: string) => void;
  /** Empty the editor in whichever view is active. */
  clear: () => void;
};

export function RichMessageEditor({
  ref,
  placeholder = "اكتب رسالتك...",
  minHeight = "min-h-44",
}: {
  ref?: Ref<RichMessageEditorHandle>;
  placeholder?: string;
  minHeight?: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditView>("preview");
  const [sourceHtml, setSourceHtml] = useState("");
  const [pendingEditorHtml, setPendingEditorHtml] = useState<string | null>(
    null,
  );
  const [showMarks, setShowMarks] = useState(false);

  const currentHtml = () =>
    view === "source" ? sourceHtml : (editor.current?.innerHTML ?? "");
  const switchView = (next: EditView) => {
    if (next === view) return;
    if (next === "source") setSourceHtml(editor.current?.innerHTML ?? "");
    else setPendingEditorHtml(sourceHtml);
    setView(next);
  };
  useEffect(() => {
    if (pendingEditorHtml !== null && editor.current) {
      editor.current.innerHTML = pendingEditorHtml;
      setPendingEditorHtml(null);
    }
  }, [pendingEditorHtml]);

  const exec = (cmd: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(cmd, false, value);
  };
  const link = () => {
    const url = prompt("URL (https://...)");
    if (url) exec("createLink", url);
  };
  const spoiler = () => {
    if (editor.current) toggleSpoiler(editor.current);
  };
  const highlight = () => {
    if (editor.current) toggleMark(editor.current);
  };
  const code = () => {
    if (editor.current) toggleCode(editor.current);
  };
  const quote = () => {
    exec("formatBlock", "BLOCKQUOTE");
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    if (!anchor) return;
    const el =
      anchor.nodeType === Node.ELEMENT_NODE
        ? (anchor as HTMLElement)
        : anchor.parentElement;
    if (!el || !editor.current) return;
    const bq = el.closest("blockquote");
    if (!bq) return;
    // Add a <br/> right after the quote and move the caret past it, so Enter
    // keeps typing on a normal line instead of nesting inside more quotes.
    const br = document.createElement("br");
    bq.after(br);
    const range = document.createRange();
    range.setStartAfter(br);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.current.focus();
  };
  const insertTable = () => {
    if (!editor.current) return;
    insertBlock(
      editor.current,
      "<table><caption>جدول</caption><tr><th>عنوان</th><th>عنوان</th></tr></table><br/>",
    );
  };
  const divider = () => {
    if (editor.current) insertBlock(editor.current, "<hr/><br/>");
  };
  const footer = () => {
    if (editor.current)
      insertBlock(editor.current, "<footer>تذييل الرسالة</footer>");
  };
  const details = () => {
    if (editor.current)
      insertBlock(
        editor.current,
        "<details open><summary>تفاصيل</summary><div>اكتب المحتوى هنا…</div></details><br/>",
      );
  };
  const editorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      editor.current &&
      exitListOnEnter(editor.current)
    ) {
      e.preventDefault();
    }
  };
  const editorContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    showTableMenu(e.nativeEvent);
  };

  useImperativeHandle(
    ref,
    () => ({
      getHTML: currentHtml,
      setHTML: (html: string) => {
        if (view === "source") setSourceHtml(html);
        else if (editor.current) editor.current.innerHTML = html;
      },
      clear: () => {
        if (view === "source") setSourceHtml("");
        else if (editor.current) editor.current.innerHTML = "";
      },
    }),
    [view, sourceHtml],
  );

  return (
    <>
      <div className="border-b p-2">
        <div className="flex flex-wrap items-center gap-0.5">
          <EditViewToggle view={view} onChange={switchView} />
          {view === "preview" && (
            <>
              <Tool
                title="إظهار علامات التنسيق"
                active={showMarks}
                onClick={() => setShowMarks((v) => !v)}
              >
                <Pilcrow size={18} />
              </Tool>
              <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
              <Tool title="عريض" onClick={() => exec("bold")}>
                <Bold size={18} />
              </Tool>
              <Tool title="مائل" onClick={() => exec("italic")}>
                <Italic size={18} />
              </Tool>
              <Tool title="تسطير" onClick={() => exec("underline")}>
                <Underline size={18} />
              </Tool>
              <Tool title="يتوسطه خط" onClick={() => exec("strikeThrough")}>
                <Strikethrough size={18} />
              </Tool>
              <Tool title="كود سطري" onClick={code}>
                <Code2 size={18} />
              </Tool>
              <Tool title="رابط" onClick={link}>
                <LinkIcon size={18} />
              </Tool>
              <Tool title="اقتباس" onClick={quote}>
                <Quote size={18} />
              </Tool>
              <Tool title="سبويلر" onClick={spoiler}>
                <EyeOff size={18} />
              </Tool>
              <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
              <Tool title="عنوان" onClick={() => exec("formatBlock", "H2")}>
                <Heading2 size={18} />
              </Tool>
              <Tool title="تمييز" onClick={highlight}>
                <Highlighter size={18} />
              </Tool>
              <Tool title="قائمة نقطية" onClick={() => exec("insertUnorderedList")}>
                <List size={18} />
              </Tool>
              <Tool title="قائمة مرقمة" onClick={() => exec("insertOrderedList")}>
                <ListOrdered size={18} />
              </Tool>
              <Tool title="جدول" onClick={insertTable}>
                <Table2 size={18} />
              </Tool>
              <Tool title="فاصل" onClick={divider}>
                <SeparatorHorizontal size={18} />
              </Tool>
              <Tool title="تذييل" onClick={footer}>
                <PanelBottom size={18} />
              </Tool>
              <Tool title="تفاصيل قابلة للطي" onClick={details}>
                <ChevronDown size={18} />
              </Tool>
            </>
          )}
        </div>
      </div>
      {view === "preview" ? (
        <div
          ref={editor}
          contentEditable
          suppressContentEditableWarning
          onKeyDown={editorKeyDown}
          onContextMenu={editorContextMenu}
          className={`msg-editor ${minHeight} p-5 text-base leading-7 focus:outline-none ${showMarks ? "show-marks" : ""}`}
          data-placeholder={placeholder}
        />
      ) : (
        <textarea
          value={sourceHtml}
          onChange={(e) => setSourceHtml(e.target.value)}
          spellCheck={false}
          dir="ltr"
          placeholder="اكتب كود HTML هنا..."
          className={`${minHeight} w-full resize-y p-5 font-mono text-sm leading-7 focus:outline-none`}
        />
      )}
    </>
  );
}