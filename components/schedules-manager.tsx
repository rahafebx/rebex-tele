"use client";
import { useRef, useState, useEffect } from "react";
import {
  Pencil,
  Trash2,
  Save,
  X,
  Play,
  Pause,
  CalendarClock,
} from "lucide-react";
import {
  createScheduled,
  updateScheduled,
  deleteScheduled,
  toggleScheduled,
  listScheduled,
} from "@/app/dashboard/schedule/actions";
import type { ScheduledListItem } from "@/app/dashboard/schedule/actions";
import {
  SCHED_PAGE_SIZE,
  SCHEDULE_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
} from "@/lib/types";
import type {
  TelegramChat,
  TelegramTopic,
  MessageTemplate,
  ScheduleType,
} from "@/lib/types";
import { telegramSavePayload } from "@/lib/telegram/format";
import {
  RichMessageEditor,
  type RichMessageEditorHandle,
} from "@/components/rich-message-editor";
import { Spinner } from "@/components/spinner";
import Input from "./ui/input";
import { Dropdown } from "./ui/dropdown";
import { EmptyState } from "./ui/empty-state";
import { Button } from "./ui/button";

const topicLabel = (t: TelegramTopic) =>
  t.name ?? `الموضوع ${t.telegram_thread_id}`;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    dateStyle: "short",
    timeStyle: "short",
  });

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fromLocalInput = (value: string) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

const futureLocalInput = (hours = 1) => {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const mm = Math.ceil(d.getMinutes() / 5) * 5;
  d.setMinutes(mm <= 59 ? mm : 59);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Message = { text: string; error: boolean };

const statusClass: Record<string, string> = {
  active: "bg-[var(--success)]/10 text-[var(--success)]",
  paused: "bg-[var(--warn)]/10 text-[var(--warn)]",
  failed: "bg-[var(--danger)]/10 text-[var(--danger)]",
  done: "bg-[var(--color-ink-50)] text-[var(--muted)] dark:bg-[var(--color-ink-800)]",
};

export function SchedulesManager({
  groups,
  topicsByChat,
  templates,
}: {
  groups: TelegramChat[];
  topicsByChat: Record<string, TelegramTopic[]>;
  templates: MessageTemplate[];
}) {
  const editor = useRef<RichMessageEditorHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ScheduledListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msg, setMsg] = useState<Message | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<ScheduledListItem | null>(null);
  const [title, setTitle] = useState("");
  const [chatId, setChatId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("once");
  const [sendAt, setSendAt] = useState(futureLocalInput(1));
  const [repeatUntil, setRepeatUntil] = useState("");
  const [tplId, setTplId] = useState("");
  const [preview, setPreview] = useState(true);

  const chat = groups.find((g) => g.telegram_chat_id === chatId);
  const topics = chat?.is_forum ? (topicsByChat[chatId] ?? []) : [];
  const isRepeat = scheduleType !== "once";

  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editing) editor.current?.setHTML(editing.editor_html);
    else editor.current?.clear();
  }, [editingId]);

  const resetForm = () => {
    setEditing(null);
    setTitle("");
    setChatId("");
    setTopicId("");
    setScheduleType("once");
    setSendAt(futureLocalInput(1));
    setRepeatUntil("");
    setTplId("");
    setMsg(null);
  };

  const startEdit = (item: ScheduledListItem) => {
    setEditing(item);
    setTitle(item.title);
    setChatId(item.telegram_chat_id);
    setTopicId(item.telegram_thread_id ? String(item.telegram_thread_id) : "");
    setScheduleType(item.schedule_type);
    setSendAt(toLocalInput(item.send_at));
    setRepeatUntil(item.repeat_until ? toLocalInput(item.repeat_until) : "");
    setPreview(item.link_preview);
    setMsg(null);
  };

  const reload = async () => {
    const result = await listScheduled(0, SCHED_PAGE_SIZE);
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
    const { response, isRich } = telegramSavePayload(html);
    const sendAtIso = fromLocalInput(sendAt);
    const untilIso = isRepeat ? fromLocalInput(repeatUntil) : "";
    if (!chatId) {
      setMsg({ text: "اختر مجموعة.", error: true });
      return;
    }
    if (!response) {
      setMsg({ text: "اكتب محتوى الرسالة أولاً.", error: true });
      return;
    }
    if (!sendAtIso) {
      setMsg({ text: "حدد وقت الإرسال.", error: true });
      return;
    }
    if (
      untilIso &&
      new Date(untilIso).getTime() <= new Date(sendAtIso).getTime()
    ) {
      setMsg({ text: "وقت الانتهاء يجب أن يكون بعد وقت البدء.", error: true });
      return;
    }
    setBusy("save");
    const input = {
      title: title.trim(),
      telegramChatId: chatId,
      telegramThreadId: topicId ? Number(topicId) : null,
      scheduleType,
      sendAt: sendAtIso,
      repeatUntil: isRepeat ? untilIso || null : null,
      response,
      editorHtml: html,
      linkPreview: preview,
      isRich,
    };
    const result = editing
      ? await updateScheduled(editing.id, input)
      : await createScheduled(input);
    if (result.error) {
      setMsg({ text: result.error, error: true });
    } else {
      setMsg({
        text: editing ? "تم تحديث الجدولة." : "تمت إضافة الجدولة.",
        error: false,
      });
      resetForm();
      await reload();
    }
    setBusy(null);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const result = await listScheduled(items.length, SCHED_PAGE_SIZE);
    if (result.ok) {
      setItems((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...result.items.filter((s) => !seen.has(s.id))];
      });
      setTotal(result.total);
      setHasMore(result.hasMore);
    } else {
      setMsg({ text: result.error, error: true });
    }
    setLoadingMore(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listScheduled(0, SCHED_PAGE_SIZE);
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
  }, [items.length, hasMore, loadingMore]);

  const listEmpty = !items.length && !initialLoading;

  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-2">
      <section className="rounded-xl border bg-[var(--card)]">
        <div className="flex items-center justify-between border-b p-5">
          <h2 className="text-lg font-semibold">
            {editing ? "تحرير الجدولة" : "جدولة جديدة"}
          </h2>
          {editing && (
            <Button
              size="sm"
              onClick={resetForm}
            >
              <X size={15} /> إلغاء
            </Button>
          )}
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="عنوان الجدولة"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="جدولة جديدة"
              maxLength={120}
              dir="rtl"
            />
          </div>
          <Dropdown
            name="group"
            label="المجموعة"
            options={groups.map((g) => ({
              value: g.telegram_chat_id,
              label: g.title,
            }))}
            value={chatId}
            onChange={(value) => {
              setChatId(value);
              setTopicId("");
            }}
            allLabel="اختر المجموعة"
          />
          {chat?.is_forum ? (
            <Dropdown
              name="topic"
              label="الموضوع"
              options={topics.map((t) => ({
                value: String(t.telegram_thread_id),
                label: topicLabel(t),
              }))}
              value={topicId}
              onChange={(value) => setTopicId(value)}
              allLabel="عام"
            />
          ) : (
            <Input
              label="الموضوع"
              value=""
              onChange={() => {}}
              dir="rtl"
              disabled={true}
              placeholder={
                chat
                  ? "ليست مجموعة نقاش (المواضيع معطّلة)"
                  : "اختر مجموعة أولاً"
              }
            />
          )}
          <Dropdown
            name="schedule-type"
            label="التكرار"
            options={(Object.keys(SCHEDULE_TYPE_LABELS) as ScheduleType[]).map(
              (t) => ({
                value: t,
                label: SCHEDULE_TYPE_LABELS[t],
              }),
            )}
            value={scheduleType}
            onChange={(value) => setScheduleType(value as ScheduleType)}
          />
          <Input
            label="وقت الإرسال"
            type="datetime-local"
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
            dir="ltr"
          />
          {isRepeat && (
            <label className="text-[15px] font-medium sm:col-span-2">
              حتى تاريخ (زمنيًا)
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={repeatUntil}
                  onChange={(e) => setRepeatUntil(e.target.value)}
                  dir="ltr"
                  className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2.5 text-base text-right"
                />
                {repeatUntil && (
                  <Button
                    size="sm"
                    className="mt-1.5 px-3 py-2"
                    onClick={() => setRepeatUntil("")}
                  >
                    بلا حد
                  </Button>
                )}
              </div>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                اتركه فارغًا للتكرار إلى ما لا نهاية.
              </span>
            </label>
          )}
        </div>
        <div className="grid grid-col-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_auto] items-end gap-4 border-b p-5">
          <Dropdown
            name="template-select"
            label="القالب"
            options={templates.map((t) => ({
              value: t.id,
              label: t.title,
            }))}
            value={tplId}
            onChange={(value) => {
              setTplId(value);
              const tpl = templates.find((t) => t.id === value);
              if (tpl) editor.current?.setHTML(tpl.editor_html);
              setTplId("");
            }}
            allLabel="تحميل قالب..."
          />
          <label className="ml-auto flex items-center gap-2 text-[15px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={preview}
              onChange={(e) => setPreview(e.target.checked)}
              className="size-4"
            />{" "}
            معاينة الرابط
          </label>
        </div>
        <RichMessageEditor ref={editor} placeholder="اكتب محتوى الرسالة..." />
        <div className="flex items-center justify-between gap-3 border-t p-4">
          <div className="min-h-5">
            {msg && (
              <span
                className={`text-[15px] ${msg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
              >
                {msg.text}
              </span>
            )}
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={save}
            disabled={busy === "save" || !chatId}
          >
            {busy === "save" && <Spinner />}
            {editing ? <Save size={17} /> : <CalendarClock size={17} />}
            {editing ? "حفظ التعديلات" : "جدولة الإرسال"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-[var(--card)]">
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">
            الجداول المقررة {initialLoading ? "" : `(${total})`}
          </h2>
        </div>
        <div
          ref={listRef}
          className="max-h-[36rem] overflow-y-auto overscroll-contain"
        >
          {initialLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-[15px] text-[var(--muted)]">
              <Spinner size={20} /> جارٍ التحميل...
            </div>
          ) : listEmpty ? (
            <EmptyState
              icon={CalendarClock}
              title="لا توجد جداول بعد"
              hint="أنشئ أول جدولة من النموذج. يُرسلها مشغّل خارجي مرة واحدة في موعدها بالضبط، ولا تتكرر في حال تعذّر الإرسال."
            />
          ) : (
            <div className="divide-y">
              {items.map((s) => (
                <div key={s.id} className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">
                        {s.title}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                        {s.chat_title}
                        {s.topic_name && <span> ← {s.topic_name}</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--muted)]">
                        {SCHEDULE_TYPE_LABELS[s.schedule_type]}
                        {s.repeat_until
                          ? ` · حتى ${dateLabel(s.repeat_until)}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass[s.status]}`}
                    >
                      {SCHEDULE_STATUS_LABELS[s.status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                    <span>
                      {s.status === "active" || s.status === "paused"
                        ? `الإرسال القادم: ${dateLabel(s.next_run_at)}`
                        : `وقت الإرسال: ${dateLabel(s.send_at)}`}
                    </span>
                    <span>أُرسلت: {s.sent_count}</span>
                    {s.consecutive_failed > 0 && (
                      <span className="text-[var(--danger)]">
                        فشل متكرر: {s.consecutive_failed}
                      </span>
                    )}
                  </div>
                  {s.last_error && (
                    <p
                      className="truncate text-xs text-[var(--danger)]"
                      dir="ltr"
                    >
                      {s.last_error}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {s.status === "active" ? (
                      <Button
                        size="sm"
                        className="text-[15px]"
                        onClick={async () => {
                          setBusy(`toggle:${s.id}`);
                          const r = await toggleScheduled(s.id);
                          if (r.error) {
                            setMsg({ text: r.error, error: true });
                          } else {
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === s.id ? { ...x, status: "paused" } : x,
                              ),
                            );
                          }
                          setBusy(null);
                        }}
                        disabled={busy === `toggle:${s.id}`}
                      >
                        {busy === `toggle:${s.id}` ? (
                          <Spinner />
                        ) : (
                          <Pause size={15} />
                        )}
                        إيقاف مؤقت
                      </Button>
                    ) : s.status === "paused" ? (
                      <Button
                        size="sm"
                        className="text-[15px]"
                        onClick={async () => {
                          setBusy(`toggle:${s.id}`);
                          const r = await toggleScheduled(s.id);
                          if (r.error) {
                            setMsg({ text: r.error, error: true });
                          } else {
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === s.id
                                  ? { ...x, status: "active", last_error: null }
                                  : x,
                              ),
                            );
                          }
                          setBusy(null);
                        }}
                        disabled={busy === `toggle:${s.id}`}
                      >
                        {busy === `toggle:${s.id}` ? (
                          <Spinner />
                        ) : (
                          <Play size={15} />
                        )}
                        استئناف
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      className="text-[15px]"
                      onClick={() => startEdit(s)}
                      disabled={busy === `delete:${s.id}`}
                    >
                      <Pencil size={15} /> تحرير
                    </Button>
                    <Button
                      size="sm"
                      dangerOutline
                      className="text-[15px]"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `هل تريد حذف هذه الجدولة "${s.chat_title}"؟`,
                          )
                        )
                          return;
                        setBusy(`delete:${s.id}`);
                        const r = await deleteScheduled(s.id);
                        if (r.error) {
                          setMsg({ text: r.error, error: true });
                        } else {
                          setItems((prev) => prev.filter((x) => x.id !== s.id));
                          setTotal((n) => Math.max(0, n - 1));
                          if (editing?.id === s.id) resetForm();
                        }
                        setBusy(null);
                      }}
                      disabled={busy === `delete:${s.id}`}
                    >
                      {busy === `delete:${s.id}` ? (
                        <Spinner />
                      ) : (
                        <Trash2 size={15} />
                      )}
                      حذف
                    </Button>
                  </div>
                </div>
              ))}
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 p-4 text-sm text-[var(--muted)]">
                  <Spinner /> جارٍ تحميل المزيد...
                </div>
              )}
              {!hasMore && !!items.length && !loadingMore && (
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
