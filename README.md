# Telegram Dashboard

A small Next.js + Supabase admin dashboard for sending Telegram bot messages to groups.

## Stack

Next.js 16 (App Router) + React 19, TypeScript (strict), Tailwind CSS v4, Lucide React, Supabase (Auth + Postgres), Telegram Bot API. The UI is Arabic and RTL.

## What's inside

- **Send** — rich-text messages to any group (and to forum topics) with a preview/source editor.
- **Message templates** — save a draft as a reusable template and load it back into the editor.
- **Scheduled messages** — one-off or repeating sends, driven by `pg_cron → /api/cron` (serverless) or an in-process 60-second ticker (self-hosted).
- **Bot commands** — custom slash commands with rich-text replies, delivered through a Telegram webhook.
- **Forum topics** — a learned cache of topics per forum group (no Bot API method to enumerate them).
- **Security** — TOTP two-factor login, a password-change flow, an audit trail of auth/admin events, and a DB-backed brute-force limiter.

## Setup

1. Create a Supabase project.
2. In Supabase Authentication, create the single admin user.
3. Apply the four files in `supabase/migrations/` — `01_core.sql`, `02_bot_features.sql`, `03_audit.sql`, `04_login_limiter.sql` — **all four, in that order**, in the Supabase SQL editor. (Two further files, `05_` and `06_`, are for databases that predate the baseline and can be skipped on a fresh setup.) There is no migration runner, so each is pasted by hand; each is a single transaction, so a failure rolls the whole file back. Every table-creating file carries the required `grant all … to anon, authenticated, service_role` block, and RLS is what actually restricts access. See `supabase/migrations/README.md`; **do not apply anything in `supabase/migrations/archive/`**.
4. Make sure `admin_config.admin_id` points at your admin user's UUID. `01_core.sql` seeds it from the last/first login, which is a no-op on a project with no users yet, so if it's still blank, insert the UUID manually.
5. In Supabase → Authentication → MFA, enable the **TOTP** factor (required before enrolling from the dashboard).
6. Copy `.env.example` to `.env.local` and fill in the five env vars (see below).
7. `npm install`
8. `npm run dev`
9. Open http://localhost:3000 — the landing page links to `/login`, or go straight to http://localhost:3000/login and sign in.
10. In Settings, paste the bot token from BotFather. It is stored in the `telegram_bot` database row — never in env.
11. Add the bot to your Telegram group and give it permission to send messages.
12. Add the group's chat ID under Groups (validated with `getChat`).
13. Go to **الأمان** (Security) and enroll an authenticator app — see [Two-factor authentication](#two-factor-authentication-totp) and save the secret.
14. **Optional — use commands and topic refresh at the same time:** if you connect bot commands (which requires a webhook, and a webhook blocks `getUpdates` for the same bot), create a *second* bot in BotFather, add it to the same groups, and connect it as the "watch bot" in Settings → بوت مراقبة المواضيع. The refresh button then scans with the watch bot's token instead, so both features work together.

### Env vars

| Variable | Exposure | Used for |
| --- | --- | --- |
| `TELEX_PUBLIC_SUPABASE_URL` | Public (browser) | Supabase client URL |
| `TELEX_PUBLIC_SUPABASE_ANON_KEY` | Public (browser) | Supabase anon key |
| `TELEX_SERVICE_ROLE_KEY` | Server-only | Scheduling + webhook (service-role client) |
| `TELEX_CRON_SECRET` | Server-only | Guards `/api/cron` via the `x-cron-secret` header |
| `TELEX_ENCRYPTION_KEY` | Server-only | Encrypts the stored bot tokens and webhook secret at rest (any string) |

Browser-facing vars use the `REBEX_PUBLIC_` prefix; everything else is kept server-only.

## Important security notes

- **Secrets are encrypted at rest.** The Telegram bot token, watch-bot token, and webhook secret are stored in server-only database columns encrypted with AES-256-GCM (`lib/crypto.ts`, key derived from `TELEX_ENCRYPTION_KEY`) — never in env, never in the browser. Existing plaintext rows keep working (values without the `enc:v1:` prefix pass through untouched, so no migration is needed); after setting the key, re-save the tokens once in Settings/Commands to re-encrypt. Touching `TELEX_ENCRYPTION_KEY` after tokens are encrypted will fail closed with a clear error rather than sending garbage.
- **HTTP security headers + CSP.** `proxy.ts` sets a Content-Security-Policy with a per-request nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Permissions-Policy`, COOP/CORP `same-origin`, HSTS (on https), and `Cache-Control: no-store` on every `/api/*` response.
- **Session cookies are hardened.** The Supabase auth cookie is written with `httpOnly: true, sameSite: "lax", secure: production only` (the `@supabase/ssr` default is `httpOnly: false`). All auth runs server-side.
- **Login is brute-force resistant.** Per-email (10/min) + per-IP (30/min) in-memory limits, *plus* a durable DB-backed limiter (`04_login_limiter.sql`): 5 failed attempts per `(email, IP)` pair per 15 minutes, counted across restarts and serverless instances. Emails and IPs are stored only as SHA-256 hashes, never raw. The DB limiter fails **open** (a DB problem never locks you out of your own dashboard) and the failure is recorded in the audit trail. A generic Arabic error never reveals whether the account exists.
- **MFA is enforced, not optional.** Once a TOTP factor is enrolled, a password-only session is rejected by the `requireAdmin` guard on every page, action, and `/api/*` route — you cannot skip the code by navigating straight to `/dashboard`. The guard fails **closed**: if the MFA state can't be read, access is denied.
- **Audit trail.** Sign-in attempts (success/failure/blocked), MFA enroll/verify/unenroll, password changes, bot + webhook (re)connects, and deletions of commands/templates/groups/topics/schedules are written to an append-only `audit_logs` table. IPs and user agents are SHA-256 hashed, no PII is stored, and rows older than 30 days are purged automatically. Logging never breaks a request — a failed audit write logs a warning and the request continues.
- RLS is admin-only via the SECURITY DEFINER `is_admin()` helper (`01_core.sql`), which checks against the authoritative `admin_config.admin_id` UUID — it does **not** trust "any authenticated user". The history of that tightening, and why the original `001` migration is not safe to apply on its own, is in `supabase/migrations/archive/README.md`.
- Every server action and the in-app `/api/*` routes (`/api/groups`, `/api/topics`) use the `requireAdmin` guard (session + `admin_id`); unauthorized callers get an action `{ error: ... }` (403 for API routes).
- The command webhook rate-limits per IP (60/min) plus per Telegram user (10 commands/min), per chat (30/min), and bot-wide (150/min); a limited bucket sends one Arabic slow-down notice per window, then drops silently. `/api/cron` also rate-limits per IP (10/min) before checking the secret. Buckets are in-memory, so they reset on restart.

## Two-factor authentication (TOTP)

Once enabled, signing in is two steps: email + password, then the 6-digit code from your authenticator app. Enforcement lives in the single admin guard (`requireAdmin`), so **every** page, server action, and `/api/*` route requires the code — you cannot skip it by going straight to `/dashboard`.

### Enabling it

1. Supabase Dashboard → Authentication → **MFA** → enable the **TOTP** factor. (Required: without it the app shows a clear Arabic error instead of a QR code.)
2. In the dashboard open **الأمان** (Security) from the sidebar.
3. Press **تفعيل المصادقة الثنائية**.
4. Scan the QR code with Google Authenticator / Authy / 1Password, **or** type the shown secret manually.
5. **Save the secret somewhere safe now** (see the recovery section below).
6. Enter the 6-digit code from the app to confirm. The session is upgraded to AAL2, and your other sessions are signed out by Supabase.

The same page changes the password: it asks for the current password (verified server-side without touching your session), then signs out every *other* session.

### استعادة الدخول (recovery)

Supabase's Free tier has no recovery codes, so there are exactly three ways back in — in order of preference:

1. **You saved the secret/QR.** Add it to a new phone as a manual entry (or scan the saved QR) and sign in normally. This is why step 5 above is not optional.
2. **You still have a working AAL2 session** (the factor exists but you want to move to a new device): open **الأمان** → **إيقاف المصادقة الثنائية**, then enroll again with the new device. Disabling requires a session that has already proven a code.
3. **Emergency — no working session at all.** Delete the verified factor directly in Supabase (Dashboard → Authentication → Users → the admin → MFA, or with the service-role key):

   ```sql
   delete from auth.mfa_factors
   where user_id = '<admin-auth-uuid>' and status = 'verified';
   ```

   Then sign in with the password and re-enroll from **الأمان**. This deliberately breaks the "MFA cannot be skipped" guarantee — while the factor is gone, the password is the only thing protecting the dashboard. Use it only to recover access, and re-enroll immediately.

## Deploy to Vercel

1. Push this folder to a Git repository and import it in Vercel (or run `npx vercel` from this folder). Framework Preset should auto-detect as **Next.js**, and Root Directory must be the folder containing `package.json`.
2. Add the env vars in Vercel → Project → Settings → Environment Variables:
   - **Public** (baked into the build): `TELEX_PUBLIC_SUPABASE_URL`, `TELEX_PUBLIC_SUPABASE_ANON_KEY`
   - **Server-only** (read at runtime): `TELEX_SERVICE_ROLE_KEY`, `TELEX_CRON_SECRET` (only needed if you use scheduled messages), `TELEX_ENCRYPTION_KEY` (pick a long random string)
   These are the only five env vars this app reads. Changing a public var requires a redeploy.
3. Deploy. If routes 404 ("This page could not be found") on every path, it is almost always one of:
   - Framework Preset is not Next.js — set it and redeploy.
   - Root Directory points at the wrong folder.
   - You redeployed before the env vars were saved (public vars are baked into the build).
4. If `/login` renders but `/` errors: the Supabase env vars are set but the Supabase URL/key don't match the project — check them and redeploy.

## Telegram limitations

A Telegram bot cannot simply enumerate every group it belongs to through the Bot API. This app therefore asks for a chat ID and validates it with `getChat`.

Forum topics are also subject to Telegram Bot API permissions, and the API has no way to enumerate a forum's topics. The app keeps a *learned cache* of topics (`telegram_topics`): sending into a topic auto-captures the chat + thread pair, and the Groups page's "Manage topics" → "Refresh from Telegram" long-polls `getUpdates` to learn thread ids and real names from `forum_topic_created`/`forum_topic_edited` events. Topics the bot has never seen (e.g. created before it joined) won't appear until a refresh observes activity in them. The send screen offers a topic dropdown (defaulting to General) for forum groups.

Caveat: an active bot webhook blocks `getUpdates` long-polling, so the topic refresh fails for that bot while the webhook is connected — a known trade-off of the Telegram API (the same caveat is noted on the Commands page). To keep both features working at once, connect a second "watch bot" (migration `012`): the refresh then scans with the watch bot's token, which has no webhook. The refresh verifies via `getWebhookInfo` that the scanning bot really has no webhook, refuses the same bot in both roles, and translates any 409 `Conflict` into a clear Arabic error — plus it reports which bot did the refresh so misconfiguration is visible. `message_thread_id`s are chat-scoped, so the main bot can still send into topics discovered by the watch bot.

## Rich text editor

The editor (`components/rich-message-editor.tsx`) is a shared `contenteditable` + `document.execCommand` component used by the send composer, message templates, scheduled messages, and bot commands. It has:

- A **preview / source** toggle; the source view lets you edit raw HTML directly.
- Formatting tools: bold, italic, underline, strikethrough, inline code, links, quotes, and spoilers.
- Rich blocks: headings (H2), highlight, bullet/numbered lists, tables (with a right-click menu to add/remove rows and columns), a divider, a footer, and collapsible details.
- A "show formatting marks" toggle (`pilcrow`) for seeing hidden structure.

At save time the HTML is converted client-side (`telegramSavePayload` in `lib/telegram/format.ts`) into a strict allowlist:

- **Classic** Telegram HTML — sent with `parse_mode: "HTML"` (e.g. `b`, `i`, `u`, `s`, `a`, `pre`, `code`, `blockquote`, `<tg-spoiler>`).
- **Rich HTML** — if the message contains rich-only blocks (headings, tables, lists, details, footer, ...) it is marked `is_rich` and sent through the custom `sendRichMessage` method with `rich_message: { html, is_rtl: true }`.

The server never parses HTML — conversion happens in the browser at save time.

**Spoilers:** the toolbar wraps the selection in a `span.spoiler` (or unwraps one), which the converter emits as Telegram's `<tg-spoiler>` tag.

**Bot commands** use the same editor: a command's reply is stored as `response` (Telegram-safe HTML) + `editor_html` (the WYSIWYG source) + `is_rich`. The webhook branches on `is_rich` to reply with `sendRichMessage` or classic HTML, so existing plain commands keep working.

## Commands

```bash
npm install
npm run dev        # dev server on http://localhost:3000
npx tsc --noEmit   # typecheck — the reliable verification gate
npm run build      # production build (needs valid Supabase env + network for Google fonts)
npm run start      # self-hosted; starts the in-process scheduler ticker (requires TELEX_SERVICE_ROLE_KEY)
```

Note: `npm run lint` currently fails due to a broken ESLint flat-config setup — don't treat it as a verification gate.

## Scheduler

Nothing sends a scheduled message except `runDueScheduled()`. It is triggered by:

- **Serverless (Vercel):** `pg_cron` pings `/api/cron` every minute.
- **Self-hosted:** an in-process 60s ticker that starts under `npm run start` (not `npm run dev`) when `TELEX_SERVICE_ROLE_KEY` is set.

Concurrency is safe: each due row is "claimed" with a conditional UPDATE (a 5-minute sentinel on `next_run_at`) so exactly one runner sends it, even when the cron ping and the in-process ticker race. Failures retry with backoff up to 5 consecutive failures, then the row is marked `failed`.

### Supabase scheduled function — step by step

1. **Enable the extensions**

   In the Supabase Dashboard: Database → Extensions, enable **pg_cron** (may be on by default) and **pg_net**.

2. **Generate your cron secret**

   Pick a long random string; you'll use it both in SQL and in the deployment env var `TELEX_CRON_SECRET`. Example: `kf7x9m2pql4v8n1w6j3r5t0y`

3. **Set the env var on your deployment**

   Add `TELEX_CRON_SECRET=<your-secret>` to `.env.local` (self-hosting) or your Vercel / deployment env vars, then redeploy if needed.

4. **Schedule the job**

   Supabase Dashboard → SQL Editor, then run (replace `https://your-app.vercel.app` with your origin and the secret with yours):

   ```sql
   select cron.schedule(
     'rebex-scheduled',
     '* * * * *',
     $$select net.http_post(
       url     := 'https://your-app.vercel.app/api/cron',
       headers := '{"x-cron-secret":"kf7x9m2pql4v8n1w6j3r5t0y"}'::jsonb,
       timeout_milliseconds := 10000
     )$$
   );
   ```

5. **Verify it's scheduled**

   ```sql
   select * from cron.job;
   ```

6. **Test it manually**

   ```bash
   curl -H "x-cron-secret: kf7x9m2pql4v8n1w6j3r5t0y" \
     https://your-app.vercel.app/api/cron
   ```

   Expected response: `{ "ok": true, "processed": 0 }` — `processed: 0` means the runner fired but there were no due messages (correct).

7. **To stop the job later**

   -- pause
   ```sql
   select cron.unschedule('rebex-scheduled');
   ```

   -- delete entirely
   ```sql
   select cron.unschedule(1);
   ```

8. **Check for failed HTTP calls**

   ```sql
   select * from net._http_response
   where status_code >= 400 or error_msg is not null
   order by created desc;
   ```

**Run less often:** the default `* * * * *` runs every minute. If you prefer, use `0 */6 * * *` (every 6 hours) or `0 0 * * *` (once a day at midnight UTC) — but remember messages may then sit up to the interval before being sent. To reschedule, just run `cron.schedule` again with a different pattern — `pg_cron` updates existing jobs by name.