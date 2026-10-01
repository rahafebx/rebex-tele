-- 07_topic_dismissals.sql — apply to the live database.
--
-- FORWARD MIGRATION. Same shape as 05 and 06: apply it to an existing database,
-- in order, after the baseline 01-04. On a fresh setup it is not a no-op —
-- unlike 05/06 the baseline does not create this table, so 07 is required for
-- the current behaviour. Missing it means removing a topic from the list is
-- silently undone by the next refresh.
--
-- The bug this fixes
-- ------------------
-- refreshChatTopics starts its getUpdates scan at `offset = 0` on every call.
-- A getUpdates offset only marks updates as *confirmed*; they are not removed
-- from the queue for 24 hours. So every refresh replays the whole retained
-- backlog and re-upserts every thread id it finds, guarded only by the
-- manual-name check. removeTopic hard-deleted the row and recorded nothing, so
-- a topic deleted in Telegram came straight back on the next refresh.
--
-- This cannot be fixed by syncing with Telegram: there is no
-- forum_topic_deleted update type, and getChat on a forum does not enumerate
-- topics — which is the entire reason telegram_topics is a learned cache. The
-- app cannot learn that a topic is gone, so it has to be told and must be able
-- to remember.
--
-- Why a separate table, and not a dismissed_at column on telegram_topics
-- -----------------------------------------------------------------------
-- The obvious design is a `dismissed_at` column plus an RLS predicate that
-- hides dismissed rows, which would leave all five read sites untouched. It
-- cannot work: refreshChatTopics reads through the *cookie* client, so RLS
-- applies to it, and a policy that hides dismissed rows also hides the
-- tombstones from the one function that must honour them. Making it work means
-- reading them with the service-role client, which bypasses RLS and would be a
-- new sanctioned call site outside the scheduler/webhook/audit set.
--
-- So deletion stays a real DELETE and a dismissal is its own row. Dismissed
-- topics are *absent* rather than *hidden*, which means there is no filter for
-- a future query to forget.
--
-- Why this is a timestamp, not a permanent ban
-- --------------------------------------------
-- dismissed_at means "ignore what Telegram told me about this topic before
-- right now", compared against each update's own `message.date`. So:
--
--   topic deleted in Telegram  -> every update for it predates the deletion,
--                                  hence the dismissal -> stays gone (correct)
--   topic dismissed by mistake -> the next message in it arrives with a later
--                                  date -> refresh learns it again (self-heals)
--
-- A permanent ban made a mis-click unrecoverable, which is the one failure mode
-- not worth shipping. `name` is carried so a self-healed topic comes back with
-- the title it had rather than as a bare thread id: collectTopics only reads a
-- name off forum_topic_created/edited events, so an ordinary message would
-- otherwise re-learn it as null.
--
-- Two deliberate omissions:
--
--   no foreign key to telegram_chats. telegram_topics cascades on group delete;
--   mirroring that here would let removeGroup wipe every dismissal, so
--   re-adding the group would resurrect exactly what was dismissed. A
--   dismissal is a statement about a thread id, not about the app's record of a
--   group. The cost is a small permanent set of orphan rows.
--
--   no retention, deliberately. This is the one table where a purge job would
--   be a bug: deleting a dismissal re-enables the resurrection. Forum thread
--   ids are never reused, so a row can never go stale in a harmful way.
--
-- No functions are created here, which is worth stating: this file cannot
-- repeat the privilege defect described in 06_lock_down_rpc_grants.sql, because
-- there is nothing to grant EXECUTE on. anon does receive the Data API grant
-- below, as on every table here, and gets zero rows from it.

begin;

create table if not exists public.telegram_topic_dismissals (
  telegram_chat_id text not null,
  telegram_thread_id bigint not null,
  -- Remembered so a self-healed topic returns with its title. Nullable: the
  -- auto-capture path can record a thread id before any name is known.
  name text,
  dismissed_at timestamptz not null default now(),
  primary key (telegram_chat_id, telegram_thread_id)
);

comment on table public.telegram_topic_dismissals is
  'Tombstones for topics removed from the list by the admin, normally after deleting them in Telegram. A row means "ignore what Telegram knew about this thread before dismissed_at" — not a permanent ban: an update newer than dismissed_at revives the topic. Compared against the update''s message.date in refreshChatTopics, with a small margin for clock skew. Never purged; never cascades.';

alter table public.telegram_topic_dismissals enable row level security;

-- Mirrors the shape of every other policy in this schema: admin-only, all
-- commands. No SELECT-through-anon policy, so anon gets nothing regardless of
-- the grant below.
drop policy if exists "admin can manage topic dismissals" on public.telegram_topic_dismissals;

create policy "admin can manage topic dismissals" on public.telegram_topic_dismissals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Data API grant. Required for every new public table since Oct 30, 2026.
grant all on table public.telegram_topic_dismissals to anon, authenticated, service_role;

commit;