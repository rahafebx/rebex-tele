-- 01_core.sql — baseline: bot config, chats, topics, commands, templates, admin identity.
--
-- Apply order: this file, then 02_bot_features.sql, 03_audit.sql,
-- 04_login_limiter.sql — all four, in order, in the Supabase SQL editor.
-- Each file is a single transaction, so a failure rolls the whole file back
-- rather than leaving half a schema behind.

begin;

-- gen_random_uuid() for the uuid primary keys below.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Bot configuration. Singleton table: `singleton` is a boolean with a
-- unique check, which allows at most one row (it cannot be false, and no two
-- rows can be true).
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_bot (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  bot_token text not null,
  bot_id bigint not null,
  bot_username text,
  -- Random token handed to setWebhook() as secret_token. The webhook route
  -- authorizes on it alone (it is unauthenticated by design), so it is the
  -- only thing standing between the public internet and this bot.
  webhook_secret text,
  -- Optional second bot, added to the same groups and never given a webhook.
  -- A registered webhook blocks getUpdates for that bot, which would break
  -- forum-topic discovery; the refresh scans with this token instead so topic
  -- discovery and the command webhook can both work at once.
  watch_bot_token text,
  watch_bot_id bigint,
  watch_bot_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.telegram_bot.bot_token is
  'BotFather token, encrypted at rest by lib/crypto.ts (AES-256-GCM) as enc:v1:<iv>:<tag>:<ct>. Set via the Settings page, never via env.';
comment on column public.telegram_bot.watch_bot_token is
  'Second bot used only for getUpdates topic discovery. refreshChatTopics falls back to bot_token when null.';

-- ---------------------------------------------------------------------------
-- Groups the bot can post to. Added manually: the Bot API cannot enumerate the
-- groups a bot is a member of, so each id is validated with getChat on entry.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_chats (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null unique,
  title text not null,
  username text,
  type text not null,
  -- Whether this chat is a forum (has topics). Backfilled on add/edit/refresh.
  is_forum boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Forum topics — a LEARNED CACHE, not a source of truth. The Bot API has no
-- method to enumerate topics, so rows arrive two ways: auto-captured when a
-- message is sent into a thread, and harvested by refreshChatTopics from
-- getUpdates. Both paths can discover a thread before its name is known.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_topics (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null references public.telegram_chats(telegram_chat_id) on delete cascade,
  telegram_thread_id bigint not null,
  -- Nullable on purpose: auto-capture on send records the thread id before
  -- any name has been learned, so a non-null name here would drop real topics.
  name text,
  -- Set by renameTopic. A refresh must never overwrite a name a human chose.
  is_manually_named boolean not null default false,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_thread_id)
);

comment on table public.telegram_topics is
  'Learned cache of forum topics. Not enumerable via the Bot API; populated by send auto-capture and refreshChatTopics.';

-- ---------------------------------------------------------------------------
-- Single-row table, not a log: the admin's most recent sign-in. Upserted by
-- app/login/actions.ts and shown in the dashboard sidebar.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_last_login (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  email text not null,
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The authoritative admin identity. requireAdmin() and every RLS policy below
-- resolve "who is the admin" from this one row, so it is the app's entire
-- authorization boundary.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_config (
  singleton boolean primary key default true check (singleton),
  admin_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.admin_config is
  'Authoritative admin user id. The only authorization boundary in the app: requireAdmin() and is_admin() both read this row.';

-- ---------------------------------------------------------------------------
-- Bot commands. `response` is the Telegram-safe HTML the bot actually sends
-- (parse_mode HTML); `editor_html` is the raw WYSIWYG source so the admin can
-- re-edit it. Same two-column shape as message_templates.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_commands (
  id uuid primary key default gen_random_uuid(),
  command text not null unique,
  description text not null default '',
  response text not null,
  editor_html text not null default '',
  enabled boolean not null default true,
  -- When true, `response` is rich-HTML and the webhook sends it through
  -- sendRichMessage({ html, is_rtl: true }) instead of parse_mode HTML.
  -- Existing rows default to false and keep the classic path.
  is_rich boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Saved message templates. Same response/editor_html pair as commands, loaded
-- into the send composer via a dropdown and reusable across chats.
-- ---------------------------------------------------------------------------
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  response text not null,
  editor_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS. Enabled on every table; there are no SELECT-through-anon policies, so
-- the anon role gets nothing regardless of the Data API grants below.
-- ---------------------------------------------------------------------------
alter table public.telegram_bot enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.telegram_topics enable row level security;
alter table public.admin_last_login enable row level security;
alter table public.admin_config enable row level security;
alter table public.telegram_commands enable row level security;
alter table public.message_templates enable row level security;

-- Read by every policy below. SECURITY DEFINER because a policy has to be
-- allowed to call it; it only ever reads admin_config, and it leaks nothing
-- (a boolean).
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_config c
    where c.singleton and c.admin_id = auth.uid()
  )
$$;

-- Revoke from `public` AND from the two Data API roles by name. Revoking only
-- from `public` is not sufficient: Supabase applies ALTER DEFAULT PRIVILEGES
-- that grant EXECUTE on new public functions to anon and authenticated
-- directly, and revoking the PUBLIC-derived grant does not remove those
-- explicit per-role grants. Measured against a live project, `revoke … from
-- public` alone left every SECURITY DEFINER function in this schema callable
-- with the anon key.
--
-- `authenticated` keeps EXECUTE because RLS policies evaluate as the querying
-- role and have to be allowed to call this. `anon` gets nothing: there is no
-- anon-facing policy on any table.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Every policy is preceded by its own drop. This is not history cleanup — it
-- is what makes a policy re-creatable, so the whole file can be re-applied.
drop policy if exists "read admin id" on public.admin_config;
drop policy if exists "admin can update admin config" on public.admin_config;
drop policy if exists "admin can read bot" on public.telegram_bot;
drop policy if exists "admin can insert bot" on public.telegram_bot;
drop policy if exists "admin can update bot" on public.telegram_bot;
drop policy if exists "admin can manage chats" on public.telegram_chats;
drop policy if exists "admin can manage topics" on public.telegram_topics;
drop policy if exists "admin can manage last login" on public.admin_last_login;
drop policy if exists "admin can manage commands" on public.telegram_commands;
drop policy if exists "admin can manage templates" on public.message_templates;

-- Any signed-in user may read the admin id: the server-side route guards
-- verify against it. Only the admin may change it.
create policy "read admin id" on public.admin_config
  for select to authenticated using (true);
create policy "admin can update admin config" on public.admin_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin can read bot" on public.telegram_bot
  for select to authenticated using (public.is_admin());
create policy "admin can insert bot" on public.telegram_bot
  for insert to authenticated with check (public.is_admin());
create policy "admin can update bot" on public.telegram_bot
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin can manage chats" on public.telegram_chats
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin can manage topics" on public.telegram_topics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin can manage last login" on public.admin_last_login
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin can manage commands" on public.telegram_commands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin can manage templates" on public.message_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Data API grants. Required for every new public table since Oct 30, 2026 —
-- the Data API no longer auto-grants. anon is included because the Next.js
-- browser client may reach these tables; RLS is what actually restricts them.
grant all on table public.telegram_bot to anon, authenticated, service_role;
grant all on table public.telegram_chats to anon, authenticated, service_role;
grant all on table public.telegram_topics to anon, authenticated, service_role;
grant all on table public.admin_last_login to anon, authenticated, service_role;
grant all on table public.admin_config to anon, authenticated, service_role;
grant all on table public.telegram_commands to anon, authenticated, service_role;
grant all on table public.message_templates to anon, authenticated, service_role;

-- Seed the admin id from the account that last logged in, falling back to the
-- earliest created user. Harmless on a brand-new project: auth.users is empty,
-- so this inserts nothing. If your admin row is still blank afterwards, run:
--   insert into public.admin_config (singleton, admin_id)
--   values (true, '<your-admin-auth-uuid>');
insert into public.admin_config (singleton, admin_id)
select true, u.id
from auth.users u
left join public.admin_last_login l on l.email = u.email
order by (l.email is not null) desc, u.created_at asc
limit 1
on conflict (singleton) do nothing;

commit;
