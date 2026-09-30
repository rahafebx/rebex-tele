"use client";
import { useEffect, useState } from "react";
import { Trash2, RefreshCw, MessageSquarePlus, Pencil, Users } from "lucide-react";
import {
  addGroup,
  removeGroup,
  refreshChatTopics,
  removeTopic,
  renameTopic,
} from "@/app/dashboard/groups/actions";
import type { TelegramChat, TelegramTopic } from "@/lib/types";
import { Spinner } from "@/components/spinner";
import PageHeading from "./ui/page-heading";
import { Card } from "./ui/card";
import Input from "./ui/input";
import { EmptyState } from "./ui/empty-state";

const topicLabel = (t: TelegramTopic) =>
  t.name ?? `الموضوع ${t.telegram_thread_id}`;

type Message = { text: string; error: boolean };

export function GroupsManager() {
  const [groups, setGroups] = useState<TelegramChat[]>([]);
  const [chatId, setChatId] = useState("");
  const [msg, setMsg] = useState<Message | null>(null);
  const [topicsByChat, setTopicsByChat] = useState<
    Record<string, TelegramTopic[]>
  >({});
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [busyAdd, setBusyAdd] = useState(false);
  const [busyRemoveGroup, setBusyRemoveGroup] = useState<string | null>(null);
  const [busyRefresh, setBusyRefresh] = useState<string | null>(null);
  const [busyRemoveTopic, setBusyRemoveTopic] = useState<string | null>(null);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingTopics, setLoadingTopics] = useState<Record<string, boolean>>({});
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/groups");
      if (!r.ok) throw new Error("request failed");
      setGroups(await r.json());
    } catch {
      setMsg({ text: "تعذّر تحميل المجموعات.", error: true });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const loadTopics = async (tgId: string) => {
    setLoadingTopics((p) => ({ ...p, [tgId]: true }));
    try {
      const r = await fetch(`/api/topics?chat=${encodeURIComponent(tgId)}`);
      if (!r.ok) throw new Error("request failed");
      const data = await r.json();
      setTopicsByChat((p) => ({ ...p, [tgId]: data }));
    } catch {
      setMsg({ text: "تعذّر تحميل المواضيع.", error: true });
    } finally {
      setLoadingTopics((p) => ({ ...p, [tgId]: false }));
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusyAdd(true);
    const fd = new FormData();
    fd.set("chatId", chatId);
    const r = await addGroup(fd);
    setMsg(
      r.error
        ? { text: r.error, error: true }
        : { text: "تمت إضافة المجموعة.", error: false },
    );
    if (!r.error) {
      setChatId("");
      load();
    }
    setBusyAdd(false);
  };
  return (
    <>
      <PageHeading 
        title="المجموعات"
        preTitle="تيليجرام"
      />
      <form
        onSubmit={submit}
        className="mt-8 max-w-xl rounded-xl border bg-[var(--card)] p-5"
      >
        <Input
          label="معرّف محادثة تيليجرام"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="-1001234567890"
          dir="ltr"
          hint="أضف البوت إلى المجموعة أولاً وامنحه صلاحية إرسال الرسائل."
        />
        <button
          type="submit"
          disabled={busyAdd || !chatId.trim()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {busyAdd && <Spinner />}
          إضافة مجموعة
        </button>
        {msg && (
          <p
            className={`mt-3 text-[15px] ${msg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
          >
            {msg.text}
          </p>
        )}
      </form>
      <Card className="mt-8">
        {groups.map((g) => (
          <div key={g.id} className="border-b p-5 last:border-0">
            <div className="flex flex-col gap-3 sm:gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-medium">{g.title}</p>
                <p className="text-sm text-[var(--muted)]" dir="ltr">
                  {g.type} · {g.telegram_chat_id}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                {g.is_forum && (
                  <button
                    onClick={() => {
                      if (openChat === g.telegram_chat_id) {
                        setOpenChat(null);
                        return;
                      }
                      setOpenChat(g.telegram_chat_id);
                      if (!topicsByChat[g.telegram_chat_id])
                        loadTopics(g.telegram_chat_id);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)] dark:text-[var(--color-primary-300)] dark:hover:bg-[var(--color-primary-900)]"
                  >
                    <MessageSquarePlus size={15} /> إدارة المواضيع
                  </button>
                )}
                <button
                  onClick={async () => {
                    setBusyRemoveGroup(g.id);
                    const r = await removeGroup(g.id);
                    setMsg(
                      r.error
                        ? { text: r.error, error: true }
                        : { text: `تم حذف «${g.title}».`, error: false },
                    );
                    if (r.ok) load();
                    setBusyRemoveGroup(null);
                  }}
                  disabled={busyRemoveGroup === g.id}
                  className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--color-ink-25)] hover:text-[var(--danger)] dark:hover:bg-[var(--color-ink-900)] disabled:opacity-50"
                  aria-label="حذف المجموعة"
                >
                  {busyRemoveGroup === g.id ? (
                    <Spinner size={18} />
                  ) : (
                    <Trash2 size={18} />
                  )}
                </button>
              </div>
            </div>
            {g.is_forum && openChat === g.telegram_chat_id && (
              <div className="mt-4 rounded-lg border bg-[var(--color-ink-25)] dark:bg-[var(--color-ink-950)]">
                <div className="flex items-center justify-between border-b px-4 py-2">
                  <p className="text-sm font-medium text-[var(--muted)]">
                    المواضيع المعروفة
                  </p>
                  <button
                    disabled={busyRefresh === g.telegram_chat_id}
                    onClick={async () => {
                      setBusyRefresh(g.telegram_chat_id);
                      const r = await refreshChatTopics(g.telegram_chat_id);
                      setMsg(
                        r.error
                          ? { text: r.error, error: true }
                          : {
                              text: r.scannedWith
                                ? `تم تحديث المواضيع من تيليجرام (باستخدام بوت @${r.scannedWith}).`
                                : "تم تحديث المواضيع من تيليجرام.",
                              error: false,
                            },
                      );
                      if (r.topics)
                        setTopicsByChat((p) => ({
                          ...p,
                          [g.telegram_chat_id]: r.topics,
                        }));
                      setBusyRefresh(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)] disabled:opacity-50 dark:text-[var(--color-primary-300)] dark:hover:bg-[var(--color-primary-900)]"
                  >
                    {busyRefresh === g.telegram_chat_id ? (
                      <Spinner size={14} />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    تحديث من تيليجرام
                  </button>
                </div>
                {loadingTopics[g.telegram_chat_id] ? (
                  <div className="flex items-center justify-center gap-2 p-4 text-sm text-[var(--muted)]">
                    <Spinner size={16} /> جارٍ تحميل المواضيع...
                  </div>
                ) : !topicsByChat[g.telegram_chat_id]?.length ? (
                  <div className="p-4 text-center text-sm text-[var(--muted)]">
                    لم تُسجَّل مواضيع بعد. الرسائل المرسلة إلى موضوع تظهر هنا؛
                    زر &quot;تحديث&quot; يلتقط نشاط المجموعات.
                  </div>
                ) : (
                  topicsByChat[g.telegram_chat_id].map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between border-b px-4 py-2 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        {editingTopicId === t.id ? (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const trimmed = editingName.trim();
                              if (!trimmed) {
                                setEditingTopicId(null);
                                return;
                              }
                              const r = await renameTopic(t.id, trimmed);
                              if (!r.error) {
                                setTopicsByChat((p) => ({
                                  ...p,
                                  [g.telegram_chat_id]: (
                                    p[g.telegram_chat_id] ?? []
                                  ).map((x) =>
                                    x.id === t.id
                                      ? { ...x, name: trimmed, is_manually_named: true }
                                      : x,
                                  ),
                                }));
                              }
                              setEditingTopicId(null);
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape")
                                  setEditingTopicId(null);
                              }}
                              onBlur={async () => {
                                const trimmed = editingName.trim();
                                if (trimmed && trimmed !== t.name) {
                                  const r = await renameTopic(t.id, trimmed);
                                  if (!r.error) {
                                    setTopicsByChat((p) => ({
                                      ...p,
                                      [g.telegram_chat_id]: (
                                        p[g.telegram_chat_id] ?? []
                                      ).map((x) =>
                                        x.id === t.id
                                          ? { ...x, name: trimmed, is_manually_named: true }
                                          : x,
                                      ),
                                    }));
                                  }
                                }
                                setEditingTopicId(null);
                              }}
                              className="min-w-0 flex-1 rounded border bg-transparent px-2 py-0.5 text-[15px] outline-none focus:border-[var(--accent)]"
                            />
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTopicId(t.id);
                              setEditingName(t.name ?? "");
                            }}
                            className="group flex items-center gap-1.5 text-left"
                          >
                            <span className="text-[15px] truncate">
                              {topicLabel(t)}
                            </span>
                            <Pencil
                              size={12}
                              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 text-[var(--muted)]"
                            />
                          </button>
                        )}
                        <p className="text-sm text-[var(--muted)]">
                          الموضوع {t.telegram_thread_id}
                        </p>
                      </div>
                      <button
                        disabled={busyRemoveTopic === t.id}
                        onClick={async () => {
                          setBusyRemoveTopic(t.id);
                          const r = await removeTopic(t.id);
                          setMsg(
                            r.error
                              ? { text: r.error, error: true }
                              : {
                                  text: `تم حذف «${topicLabel(t)}».`,
                                  error: false,
                                },
                          );
                          if (!r.error) loadTopics(g.telegram_chat_id);
                          setBusyRemoveTopic(null);
                        }}
                        className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--color-ink-25)] hover:text-[var(--danger)] dark:hover:bg-[var(--color-ink-900)] disabled:opacity-50"
                        aria-label="حذف الموضوع"
                      >
                        {busyRemoveTopic === t.id ? (
                          <Spinner size={16} />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-[15px] text-[var(--muted)]">
            <Spinner size={20} /> جارٍ تحميل المجموعات...
          </div>
        ) : !groups.length ? (
          <EmptyState
            icon={Users}
            title="لا توجد مجموعات متصلة"
            hint="ألصق معرّف المجموعة في النموذج أعلاه. لا يمكن حصر المجموعات عبر واجهة بوت تيليجرام، لذا يُتحقَّق من كل معرّف يدويًا."
          />
        ) : null}
      </Card>
    </>
  );
}