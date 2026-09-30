"use client";
import { useRef, useState, useEffect } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Search,
  SearchX,
  FileText,
} from "lucide-react";
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplates,
} from "@/app/dashboard/templates/actions";
import { TEMPLATES_PAGE_SIZE } from "@/lib/types";
import type { MessageTemplate } from "@/lib/types";
import { editorHtmlToTelegramHtml } from "@/lib/telegram/format";
import {
  RichMessageEditor,
  type RichMessageEditorHandle,
} from "@/components/rich-message-editor";
import { Spinner } from "@/components/spinner";
import Input from "./ui/input";
import { EmptyState } from "./ui/empty-state";

type Message = { text: string; error: boolean };

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    dateStyle: "short",
    timeStyle: "short",
  });

export function TemplatesManager() {
  const editor = useRef<RichMessageEditorHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "more" | null>(null);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Message | null>(null);

  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editing) editor.current?.setHTML(editing.editor_html);
    else editor.current?.clear();
  }, [editingId]);

  const resetForm = () => {
    setEditing(null);
    setTitle("");
    setMsg(null);
  };

  const startEdit = (t: MessageTemplate) => {
    setEditing(t);
    setTitle(t.title);
    setMsg(null);
  };

  const reload = async () => {
    const result = await listTemplates(query, 0, TEMPLATES_PAGE_SIZE);
    if (result.ok) {
      setItems(result.items);
      setTotal(result.total);
      setHasMore(result.hasMore);
    } else {
      setMsg({ text: result.error, error: true });
    }
  };

  const save = async () => {
    const html = editor.current?.getHTML() ?? "";
    const response = editorHtmlToTelegramHtml(html).trim();
    if (!title.trim()) {
      setMsg({ text: "اكتب اسمًا للقالب.", error: true });
      return;
    }
    if (!response) {
      setMsg({ text: "اكتب محتوى القالب أولاً.", error: true });
      return;
    }
    setBusy("save");
    const result = editing
      ? await updateTemplate({
          id: editing.id,
          title,
          response,
          editorHtml: html,
        })
      : await createTemplate({ title, response, editorHtml: html });
    if (result.error) {
      setMsg({ text: result.error, error: true });
    } else {
      setMsg({
        text: editing ? "تم تحديث القالب." : "تمت إضافة القالب.",
        error: false,
      });
      resetForm();
      await reload();
    }
    setBusy(null);
  };

  const remove = async (t: MessageTemplate) => {
    if (!window.confirm(`هل تريد حذف القالب "${t.title}"؟`)) return;
    setBusy(`delete:${t.id}`);
    const result = await deleteTemplate(t.id);
    if (result.error) {
      setMsg({ text: result.error, error: true });
    } else {
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      setTotal((n) => Math.max(0, n - 1));
      setMsg({ text: "تم حذف القالب.", error: false });
      if (editing?.id === t.id) resetForm();
    }
    setBusy(null);
  };

  const loadMore = async () => {
    if (mode !== null || draft !== query || !hasMore || !items.length) return;
    setMode("more");
    const result = await listTemplates(query, items.length, TEMPLATES_PAGE_SIZE);
    if (result.ok) {
      setItems((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...result.items.filter((t) => !seen.has(t.id))];
      });
      setTotal(result.total);
      setHasMore(result.hasMore);
    } else {
      setMsg({ text: result.error, error: true });
    }
    setMode(null);
  };

  useEffect(() => {
    if (draft === query) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      setMode("search");
      const result = await listTemplates(draft, 0, TEMPLATES_PAGE_SIZE);
      if (cancelled) return;
      if (result.ok) {
        setItems(result.items);
        setTotal(result.total);
        setHasMore(result.hasMore);
        setQuery(draft);
      } else {
        setMsg({ text: result.error, error: true });
      }
      setMode(null);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [draft, query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listTemplates("", 0, TEMPLATES_PAGE_SIZE);
      if (cancelled) return;
      if (result.ok) {
        setItems(result.items);
        setTotal(result.total);
        setHasMore(result.hasMore);
      } else {
        setMsg({ text: result.error, error: true });
      }
      setInitialLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const target = sentinelRef.current;
    const rootEl = listRef.current;
    if (!target || !rootEl || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: rootEl, rootMargin: "0px 0px 80px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [items.length, hasMore, mode, query, draft]);

  const searching = mode === "search";
  const listEmpty = !items.length && !searching;
  const showEndNote = !hasMore && !!items.length && !searching;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border bg-[var(--card)]">
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">
            {editing ? `تحرير القالب: ${editing.title}` : "قالب جديد"}
          </h2>
        </div>
        <div className="p-5">
          <Input
            label="اسم القالب"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: إعلان عن المنتج الجديد"
          />
        </div>
        <RichMessageEditor
          ref={editor}
          placeholder="اكتب محتوى القالب..."
        />
        <div className="flex items-center justify-between gap-3 border-t p-4">
          <div className="flex items-center gap-3">
            {msg && (
              <span
                className={`text-[15px] ${msg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
              >
                {msg.text}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {editing && (
              <button
                onClick={resetForm}
                disabled={busy === "save"}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[15px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <X size={17} /> إلغاء
              </button>
            )}
            <button
              onClick={save}
              disabled={busy === "save" || !title.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {busy === "save" && <Spinner />}
              {editing ? <Save size={17} /> : <Plus size={17} />}
              {editing ? "حفظ التعديلات" : "إضافة القالب"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-[var(--card)]">
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">
            جميع القوالب {initialLoading ? "" : `(${total})`}
          </h2>
        </div>
        <div className="border-b p-4">
          <div className="relative">
            <Search
              size={18}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            {searching && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
                <Spinner />
              </span>
            )}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="ابحث عن قالب بالاسم..."
              className="w-full rounded-lg border bg-transparent py-2.5 pr-10 pl-10 text-base"
            />
          </div>
        </div>
        <div
          ref={listRef}
          className="max-h-[28rem] overflow-y-auto overscroll-contain"
        >
          {initialLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-[15px] text-[var(--muted)]">
              <Spinner size={20} /> جارٍ التحميل...
            </div>
          ) : listEmpty ? (
            draft.trim() ? (
              <EmptyState
                icon={SearchX}
                title="لا توجد نتائج مطابقة لبحثك"
                hint="جرّب كلمة أخرى، أو امسح البحث لعرض كل القوالب."
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="لا توجد قوالب بعد"
                hint="أضف أول قالب من النموذج، أو احفظ رسالة كقالب من صفحة الإرسال لإعادة استخدامها لاحقًا."
              />
            )
          ) : (
            <div className="divide-y">
              {items.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">
                      {t.title}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--muted)]">
                      آخر تعديل: {dateLabel(t.updated_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      onClick={() => startEdit(t)}
                      disabled={busy === `delete:${t.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                    >
                      <Pencil size={15} /> تحرير
                    </button>
                    <button
                      onClick={() => remove(t)}
                      disabled={busy === `delete:${t.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[15px] text-[var(--danger)] transition-colors disabled:opacity-50"
                    >
                      {busy === `delete:${t.id}` ? (
                        <Spinner />
                      ) : (
                        <Trash2 size={15} />
                      )}
                      حذف
                    </button>
                  </div>
                </div>
              ))}
              {mode === "more" && (
                <div className="flex items-center justify-center gap-2 p-4 text-sm text-[var(--muted)]">
                  <Spinner /> جارٍ تحميل المزيد...
                </div>
              )}
              {showEndNote && (
                <div className="p-4 text-center text-sm text-[var(--muted)]">
                  نهاية النتائج
                </div>
              )}
              <div ref={sentinelRef} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}