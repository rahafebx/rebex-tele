import { SettingsForm } from "@/components/settings-form";
import PageHeading from "@/components/ui/page-heading";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_username, watch_bot_username")
    .maybeSingle();
  return (
    <>
      <PageHeading
        title="الإعدادات"
        preTitle="التكوين"
      />
      <SettingsForm
        username={bot?.bot_username ?? null}
        watchUsername={bot?.watch_bot_username ?? null}
      />
    </>
  );
}
