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
import { Button } from "./ui/button";

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

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="mt-4"
          disabled={busy || !token}
        >
          {busy && <Spinner />}
          تحقق واحفظ
        </Button>
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
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={watchBusy || !watchToken}
          >
            {watchBusy && <Spinner />}
            تحقق واحفظ
          </Button>
          {watchUsername && (
            <Button
              size="md"
              dangerOutline
              onClick={disconnectWatch}
              disabled={disconnecting}
            >
              {disconnecting && <Spinner />}
              فصل بوت المراقبة
            </Button>
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