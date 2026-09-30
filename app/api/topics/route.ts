import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chat");
  const supabase = await createClient();
  if (!(await requireAdmin(supabase)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const base = supabase
    .from("telegram_topics")
    .select("*")
    .order("name", { ascending: true, nullsFirst: true });
  const query = chatId ? base.eq("telegram_chat_id", chatId) : base;
  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
