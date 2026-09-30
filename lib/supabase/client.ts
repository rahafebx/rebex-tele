import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.TELEX_PUBLIC_SUPABASE_URL!,
    process.env.TELEX_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
