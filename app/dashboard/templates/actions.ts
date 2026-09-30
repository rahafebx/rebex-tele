"use server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ADMIN_ERROR } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { TEMPLATES_PAGE_SIZE } from "@/lib/types";
import type { MessageTemplate } from "@/lib/types";

type TemplateInput = {
  title: string;
  response: string;
  editorHtml: string;
};

export type TemplateListing =
  | { ok: true; items: MessageTemplate[]; total: number; hasMore: boolean }
  | { ok: false; error: string };

export async function listTemplates(
  query: string,
  offset: number,
  limit: number = TEMPLATES_PAGE_SIZE,
): Promise<TemplateListing> {
  const supabase = await createClient();
  if (!(await requireAdmin(supabase)))
    return { ok: false, error: ADMIN_ERROR };
  const q = `%${query.trim()}%`;
  const [{ count }, { data, error }] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id", { count: "exact", head: true })
      .ilike("title", q),
    supabase
      .from("message_templates")
      .select("*", { count: "exact" })
      .ilike("title", q)
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1),
  ]);
  if (error) return { ok: false, error: error.message };
  const items = (data ?? []) as MessageTemplate[];
  return {
    ok: true,
    items,
    total: count ?? items.length,
    hasMore: (count ?? items.length) > offset + items.length,
  };
}

function validate(input: TemplateInput): string | null {
  if (!input.title.trim()) return "اكتب اسمًا للقالب.";
  if (!input.response.trim()) return "اكتب محتوى القالب أولاً.";
  return null;
}

export async function createTemplate(input: TemplateInput) {
  const message = validate(input);
  if (message) return { error: message };
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { error } = await supabase.from("message_templates").insert({
    title: input.title.trim(),
    response: input.response.trim(),
    editor_html: input.editorHtml,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/send");
  return { ok: true };
}

export async function updateTemplate(input: TemplateInput & { id: string }) {
  const message = validate(input);
  if (message) return { error: message };
  const supabase = await createClient();
  if (!(await requireAdmin(supabase))) return { error: ADMIN_ERROR };
  const { error } = await supabase
    .from("message_templates")
    .update({
      title: input.title.trim(),
      response: input.response.trim(),
      editor_html: input.editorHtml,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/send");
  return { ok: true };
}

export async function deleteTemplate(id: string) {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if (!admin) return { error: ADMIN_ERROR };
  const { error } = await supabase
    .from("message_templates")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  await logAudit(
    "admin.template.deleted",
    {},
    { source: await headers(), actorId: admin.user.id },
  );
  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/send");
  return { ok: true };
}