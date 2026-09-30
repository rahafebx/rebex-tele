import { SchedulesManager } from "@/components/schedules-manager";
import PageHeading from "@/components/ui/page-heading";
import { createClient } from "@/lib/supabase/server";
import type { TelegramTopic } from "@/lib/types";

export default async function SchedulePage() {
  const supabase = await createClient();
  const [{ data: groups }, { data: topics }, { data: templates }] =
    await Promise.all([
      supabase.from("telegram_chats").select("*").order("title"),
      supabase.from("telegram_topics").select("*").order("name"),
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
      <PageHeading 
        title="جدولة الرسائل"
        preTitle="تيليجرام"
      />
      <SchedulesManager
        groups={groups ?? []}
        topicsByChat={topicsByChat}
        templates={templates ?? []}
      />
    </>
  );
}