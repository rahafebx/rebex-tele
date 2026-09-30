import { SendComposer } from "@/components/send-composer";
import { createClient } from "@/lib/supabase/server";
import type { TelegramTopic } from "@/lib/types";

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { chat } = await searchParams;
  const supabase = await createClient();
  const [{ data: groups }, { data: topics }, { data: templates }] =
    await Promise.all([
      supabase.from("telegram_chats").select("*").order("title"),
      supabase
        .from("telegram_topics")
        .select("*")
        .order("name", { ascending: true, nullsFirst: true }),
      supabase
        .from("message_templates")
        .select("*")
        .order("title", { ascending: true }),
    ]);
  const topicsByChat = (topics ?? []).reduce<Record<string, TelegramTopic[]>>(
    (acc, t) => {
      (acc[t.telegram_chat_id] ??= []).push(t);
      return acc;
    },
    {},
  );
  return (
    <>
      <div>
        <p className="text-[15px] text-[var(--muted)]">تيليجرام</p>
        <h1 className="text-2xl font-semibold">إرسال رسالة</h1>
      </div>
      <SendComposer
        groups={groups ?? []}
        topicsByChat={topicsByChat}
        templates={templates ?? []}
        initialChatId={chat ?? undefined}
      />
    </>
  );
}
