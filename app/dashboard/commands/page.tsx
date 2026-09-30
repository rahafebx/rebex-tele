import { CommandsManager } from "@/components/commands-manager";
import PageHeading from "@/components/ui/page-heading";
import { createClient } from "@/lib/supabase/server";

export default async function CommandsPage() {
  const supabase = await createClient();
  const { data: bot } = await supabase
    .from("telegram_bot")
    .select("bot_username, webhook_secret")
    .maybeSingle();
  return (
    <>
      <PageHeading
        preTitle="الردود التلقائية"
        title="أوامر البوت"
        />
      <CommandsManager
        botUsername={bot?.bot_username ?? null}
        webhookConnected={Boolean(bot?.webhook_secret)}
      />
    </>
  );
}