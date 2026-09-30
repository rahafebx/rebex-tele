import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function envForSupabase() {
  const url = process.env.TELEX_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.TELEX_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env is not configured: set TELEX_PUBLIC_SUPABASE_URL and TELEX_PUBLIC_SUPABASE_ANON_KEY before deploying.",
    );
  }
  return { url, anonKey };
}

export async function createClient() {
  const { url, anonKey } = envForSupabase();
  const cookieStore = await cookies();
  // @supabase/ssr defaults the auth cookie to httpOnly:false (readable by
  // JS). Force hard flags so the session token is not exposed to XSS, is not
  // sent cross-site, and only travels over https in production.
  const isProd = process.env.NODE_ENV === "production";
  return createServerClient(url, anonKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: isProd,
              path: "/",
            }),
          );
        } catch {}
      },
    },
  });
}
