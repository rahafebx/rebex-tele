-- 02_bot_features.sql — baseline: scheduled messages.
-- Requires: 01_core.sql (for is_admin() and the telegram_chats it references).
-- Apply after it, before 03_audit.sql.

begin;

-- ---------------------------------------------------------------------------
-- One row per scheduled send. The bot is never involved in a "hook" here: an
-- outbound trigger (a cron pinger hitting /api/cron, or the in-process ticker
-- on self-hosted `next start`) reads the due rows and calls sendMessage through
-- the Bot API. lib/scheduler/run.ts is the only thing that writes next_run_at
-- while a send is in flight.
--
-- Concurrency is handled by a per-row optimistic claim, not an advisory lock:
-- the claim UPDATE only matches if next_run_at is still what the runner just
-- selected, so of two concurrent runners exactly one wins and the loser skips.
-- See lib/scheduler/schedule.ts for CLAIM_WINDOW_MS.
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null references public.telegram_chats(telegram_chat_id) on delete cascade,
  telegram_thread_id bigint,
  schedule_type text not null check (schedule_type in ('once','daily','weekly','monthly','yearly')),
  send_at timestamptz not null,
  repeat_until timestamptz,
  status text not null default 'active' check (status in ('active','paused','failed','done')),
  -- Display title, so an admin can tell schedules apart at a glance in a list
  -- that otherwise shows nothing but timestamps.
  title text not null default 'جدولة جديدة',
  response text not null,
  editor_html text not null default '',
  -- When true, `response` is rich-HTML and the scheduler sends it through
  -- sendRichMessage({ html, is_rtl: true }) instead of parse_mode HTML.
  is_rich boolean not null default false,
  link_preview boolean not null default true,
  -- The next time this row is due. Also the claim token: a runner moves it
  -- into the future to claim the row, so a concurrent runner's conditional
  -- UPDATE matches nothing.
  next_run_at timestamptz not null,
  sent_count integer not null default 0,
  consecutive_failed integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.scheduled_messages is
  'Scheduled sends. Fired by /api/cron or the in-process ticker via runDueScheduled(); next_run_at doubles as the claim token.';

-- Partial index over due rows only: the runner's hot query is always
-- `status = 'active' and next_run_at <= now()`, and it batches at 25.
create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (status, next_run_at)
  where status = 'active';

alter table public.scheduled_messages enable row level security;

drop policy if exists "admin can manage scheduled messages" on public.scheduled_messages;
create policy "admin can manage scheduled messages" on public.scheduled_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Data API grants (required for new public tables since Oct 30, 2026).
grant all on table public.scheduled_messages to anon, authenticated, service_role;

commit;

-- ===========================================================================
-- Runtime note — nothing below is schema. How the table above actually gets
-- fired on a deployment with no always-on process (Vercel, or any serverless
-- host). Requires the pg_cron and pg_net extensions in the SQL editor:
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
--   select cron.schedule(
--     'rebex-scheduled',
--     '* * * * *',
--     $$select net.http_post(
--       url     := 'https://YOUR-ORIGIN/api/cron',
--       headers := '{"x-cron-secret":"YOUR_SECRET"}'::jsonb,
--       timeout_milliseconds := 10000
--     )$$
--   );
--
-- /api/cron is rate-limited per IP and gated on the x-cron-secret header.
-- On a self-hosted `next start` the in-process ticker runs instead and the
-- claim protocol makes running both at once safe. Any uptime pinger works too.
-- ===========================================================================
