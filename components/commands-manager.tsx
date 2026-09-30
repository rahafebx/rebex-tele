"use client";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Link2,
  Link2Off,
  Command,
} from "lucide-react";
import {
  listCommands,
  addCommand,
  updateCommand,
  deleteCommand,
  toggleCommand,
  connectWebhook,
  disconnectWebhook,
} from "@/app/dashboard/commands/actions";
import type { TelegramCommand } from "@/lib/types";
import { telegramSavePayload } from "@/lib/telegram/format";
import {
  RichMessageEditor,
  type RichMessageEditorHandle,
} from "@/components/rich-message-editor";
import { Spinner } from "@/components/spinner";
import Input from "./ui/input";
import { EmptyState } from "./ui/empty-state";

type Message = { text: string; error: boolean };

export function CommandsManager({
  botUsername,
  webhookConnected,
}: {
  botUsername: string | null;
  webhookConnected: boolean;
}) {
  const router = useRouter();
  const editor = useRef<RichMessageEditorHandle>(null);
  const [commands, setCommands] = useState<TelegramCommand[]>([]);
  const [loadingCommands, setLoadingCommands] = useState(true);
  const [editing, setEditing] = useState<TelegramCommand | null>(null);
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Message | null>(null);

  const reload = async () => {
    const result = await listCommands();
    if (result.ok) setCommands(result.items);
    else setMsg({ text: result.error, error: true });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listCommands();
      if (cancelled) return;
      if (result.ok) setCommands(result.items);
      else setMsg({ text: result.error, error: true });
      setLoadingCommands(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editing) editor.current?.setHTML(editing.editor_html);
    else editor.current?.clear();
  }, [editingId]);

  const resetForm = () => {
    setEditing(null);
    setCommand("");
    setDescription("");
    setMsg(null);
  };

  const startEdit = (c: TelegramCommand) => {
    setEditing(c);
    setCommand(c.command);
    setDescription(c.description);
    setMsg(null);
  };

  const save = async () => {
    const html = editor.current?.getHTML() ?? "";
    const { response, isRich } = telegramSavePayload(html);
    if (!response) {
      setMsg({ text: "اكتب ردًا للأمر أولاً.", error: true });
      return;
    }
    setBusy("save");
    const result = editing
      ? await updateCommand({
          id: editing.id,
          command,
          description,
          response,
          editorHtml: html,
          isRich,
        })
      : await addCommand({
          command,
          description,
          response,
          editorHtml: html,
          isRich,
        });
    if (result.error) {
      setMsg({ text: result.error, error: true });
    } else {
      setMsg({
        text: editing ? "تم تحديث الأمر." : "تمت إضافة الأمر.",
        error: false,
      });
      resetForm();
      await reload();
    }
    setBusy(null);
  };

  const remove = async (c: TelegramCommand) => {
    if (!window.confirm(`هل تريد حذف الأمر /${c.command}؟`)) return;
    setBusy(`delete:${c.id}`);
    const result = await deleteCommand(c.id);
    setMsg(
      result.error
        ? { text: result.error, error: true }
        : { text: "تم حذف الأمر.", error: false },
    );
    if (!result.error) {
      if (editing?.id === c.id) resetForm();
      await reload();
    }
    setBusy(null);
  };

  const toggle = async (c: TelegramCommand) => {
    setBusy(`toggle:${c.id}`);
    const result = await toggleCommand(c.id, !c.enabled);
    if (result.error) {
      setMsg({ text: result.error, error: true });
    } else {
      setCommands((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, enabled: !x.enabled } : x,
        ),
      );
      setMsg(
        !c.enabled
          ? { text: `تم تفعيل الأمر /${c.command}.`, error: false }
          : { text: `تم إيقاف الأمر /${c.command}.`, error: false },
      );
    }
    setBusy(null);
  };

  const bindWebhook = async () => {
    setBusy("connect");
    const result = await connectWebhook(publicUrl);
    setMsg(
      result.error
        ? { text: result.error, error: true }
        : { text: "تم ربط الويب هوك. البوت يستقبل الأوامر الآن.", error: false },
    );
    if (!result.error) {
      setPublicUrl("");
      router.refresh();
    }
    setBusy(null);
  };

  const unbindWebhook = async () => {
    setBusy("disconnect");
    const result = await disconnectWebhook();
    setMsg(
      result.error
        ? { text: result.error, error: true }
        : { text: "تم فصل الويب هوك.", error: false },
    );
    if (!result.error) router.refresh();
    setBusy(null);
  };

  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_330px]">
      <div className="grid gap-6">
        <section className="rounded-xl border bg-[var(--card)]">
          <div className="border-b p-5">
            <h2 className="text-lg font-semibold">
              {editing ? `تحرير الأمر /${editing.command}` : "أمر جديد"}
            </h2>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">

            <Input
              label="اسم الأمر"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="/start"
              dir="ltr"
            />

            <Input
              label="الوصف (يظهر في قائمة أوامر تيليجرام)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف مختصر للأمر"
              dir="rtl"
            />
          </div>
          <RichMessageEditor
            ref={editor}
            placeholder="اكتب رد الأمر..."
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
                disabled={busy === "save" || !command.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {busy === "save" && <Spinner />}
                {editing ? <Save size={17} /> : <Plus size={17} />}
                {editing ? "حفظ التعديلات" : "إضافة الأمر"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-[var(--card)]">
          <div className="border-b p-5">
            <h2 className="text-lg font-semibold">
              الأوامر {loadingCommands ? "" : `(${commands.length})`}
            </h2>
          </div>
          {loadingCommands ? (
            <div className="flex items-center justify-center gap-2 p-8 text-[15px] text-[var(--muted)]">
              <Spinner size={20} /> جارٍ التحميل...
            </div>
          ) : !commands.length ? (
            <EmptyState
              icon={Command}
              title="لا توجد أوامر بعد"
              hint="أضف أول أمر من النموذج أعلاه. تظهر الأوامر المفعّلة في قائمة أوامر البوت على تيليجرام مباشرة."
            />
          ) : (
            <div className="divide-y">
              {commands.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p dir="ltr" className="font-mono text-[15px]">
                      /{c.command}
                    </p>
                    {c.description && (
                      <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        disabled={busy === `toggle:${c.id}`}
                        onChange={() => toggle(c)}
                        className="size-4"
                      />
                      مفعّل
                    </label>
                    <button
                      onClick={() => startEdit(c)}
                      disabled={busy === `toggle:${c.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                    >
                      <Pencil size={15} /> تحرير
                    </button>
                    <button
                      onClick={() => remove(c)}
                      disabled={busy === `delete:${c.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[15px] text-[var(--danger)] transition-colors disabled:opacity-50"
                    >
                      {busy === `delete:${c.id}` ? <Spinner /> : <Trash2 size={15} />}
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="h-fit rounded-xl border bg-[var(--card)] lg:sticky lg:top-6">
        <div className="border-b p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">استقبال الأوامر</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${webhookConnected ? "bg-[var(--color-primary-50)] text-[var(--color-primary-800)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-200)]" : "bg-[var(--color-ink-50)] text-[var(--muted)] dark:bg-[var(--color-ink-800)]"}`}
            >
              {webhookConnected ? "متصل" : "غير متصل"}
            </span>
          </div>
          <p className="mt-1 text-[15px] text-[var(--muted)]">
            {botUsername ? (
              <>
                البوت <b>@{botUsername}</b> يرد على الأوامر عند وصولها عبر ويب
                هوك.
              </>
            ) : (
              "اربط البوت من صفحة الإعدادات أولاً."
            )}
          </p>
        </div>
        <div className="p-5">
          {!webhookConnected ? (
            <>
              <label className="text-[15px] font-medium">
                الرابط العام لتطبيقك
                <input
                  value={publicUrl}
                  onChange={(e) => setPublicUrl(e.target.value)}
                  placeholder="https://example.com"
                  dir="ltr"
                  className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2.5 text-base text-right"
                />
              </label>
              <button
                onClick={bindWebhook}
                disabled={busy === "connect" || !botUsername || !publicUrl.trim()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {busy === "connect" && <Spinner />}
                <Link2 size={17} /> ربط الويب هوك
              </button>
            </>
          ) : (
            <button
              onClick={unbindWebhook}
              disabled={busy === "disconnect"}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-[15px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--danger)] disabled:opacity-50"
            >
              {busy === "disconnect" && <Spinner />}
              <Link2Off size={17} /> فصل الويب هوك
            </button>
          )}
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            يتطلب تيليجرام رابط HTTPS عام للموقع. الويب هوك يمنع استطلاع
            المواضيع (getUpdates) للبوت نفسه؛ اربط «بوت مراقبة للمواضيع»
            من صفحة الإعدادات ليعمل الإثنان معًا.
          </p>
        </div>
      </section>
    </div>
  );
}