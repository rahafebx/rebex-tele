"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  connectBot,
  connectWatchBot,
  disconnectWatchBot,
} from "@/app/dashboard/settings/actions";
import { Spinner } from "@/components/spinner";
import Input from "./ui/input";

type Message = { text: string; error: boolean };

export function SettingsForm({
  username,
  watchUsername,
}: {
  username: string | null;
  watchUsername: string | null;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [watchToken, setWatchToken] = useState("");
  const [watchMsg, setWatchMsg] = useState<Message | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData();
    fd.set("token", token);
    const r = await connectBot(fd);
    setMsg(
      r.error
        ? { text: r.error, error: true }
        : { text: `تم الاتصال باسم @${r.username}`, error: false },
    );
    if (!r.error) setToken("");
    setBusy(false);
    router.refresh();
  };

  const submitWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setWatchBusy(true);
    const fd = new FormData();
    fd.set("token", watchToken);
    const r = await connectWatchBot(fd);
    setWatchMsg(
      r.error
        ? { text: r.error, error: true }
        : { text: `تم الاتصال ببوت المراقبة @${r.username}`, error: false },
    );
    if (!r.error) {
      setWatchToken("");
      router.refresh();
    }
    setWatchBusy(false);
  };

  const disconnectWatch = async () => {
    setDisconnecting(true);
    const r = await disconnectWatchBot();
    setWatchMsg(
      r.error
        ? { text: r.error, error: true }
        : { text: "تم فصل بوت المراقبة.", error: false },
    );
    if (!r.error) router.refresh();
    setDisconnecting(false);
  };

  return (
    <div className="mt-8 max-w-xl">
      <form
        onSubmit={submit}
        className="rounded-xl border bg-[var(--card)] p-5"
      >
        <div className="mb-5">
          <p className="text-[15px] font-medium">بوت تيليجرام</p>
          <p className="mt-1 text-[15px] text-[var(--muted)]">
            {username ? (
              <span className="flex gap-2">
                متصل باسم <b dir="ltr">@{username}</b>
              </span>
            ) : (
              "لا يوجد بوت متصل."
            )}
          </p>
        </div>

        <Input
          label="رمز البوت"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="123456:ABC..."
          dir="ltr"
          hint="يُستخدم الرمز فقط في طلبات تيليجرام من جهة الخادم. لا تضعه أبدًا في المتغيّرات."
        />

        <button
          type="submit"
          disabled={busy || !token}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {busy && <Spinner />}
          تحقق واحفظ
        </button>
        {msg && (
          <p
            className={`mt-3 text-[15px] ${msg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
          >
            {msg.text}
          </p>
        )}
      </form>

      <form
        onSubmit={submitWatch}
        className="mt-6 rounded-xl border bg-[var(--card)] p-5"
      >
        <div className="mb-5">
          <p className="text-[15px] font-medium">
            بوت مراقبة المواضيع (اختياري)
          </p>
          <p className="mt-1 text-[15px] text-[var(--muted)]">
            {watchUsername ? (
              <span className="flex gap-2">
                متصل باسم <b dir="ltr">@{watchUsername}</b>
              </span>
            ) : (
              "لا يوجد بوت مراقبة متصل."
            )}
          </p>
        </div>

        <Input
          label="رمز بوت المراقبة"
          value={watchToken}
          onChange={(e) => setWatchToken(e.target.value)}
          type="password"
          placeholder="123456:ABC..."
          dir="ltr"
          hint="بوت ثانٍ من BotFather تضيفه إلى نفس المجموعات. يُستخدم فقط لاستطلاع المواضيع (getUpdates)، فلا يتعارض مع الويب هوك الخاص بالأوامر. لا يُحفظ إلا على الخادم."
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={watchBusy || !watchToken}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {watchBusy && <Spinner />}
            تحقق واحفظ
          </button>
          {watchUsername && (
            <button
              type="button"
              onClick={disconnectWatch}
              disabled={disconnecting}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2.5 text-[15px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--danger)] disabled:opacity-50"
            >
              {disconnecting && <Spinner />}
              فصل بوت المراقبة
            </button>
          )}
        </div>
        {watchMsg && (
          <p
            className={`mt-3 text-[15px] ${watchMsg.error ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
          >
            {watchMsg.text}
          </p>
        )}
      </form>
    </div>
  );
}