import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await supabase
    .from("telegram_chats")
    .select("*")
    .order("created_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
