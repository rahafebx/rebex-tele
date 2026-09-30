-- 03_audit.sql — baseline: the audit trail and its retention.
--
-- Requires: 01_core.sql (for is_admin()).
--

begin;

-- ---------------------------------------------------------------------------
-- Append-only trail of auth, MFA and sensitive admin events.
--
-- Two properties are load-bearing:
--   1. There is NO INSERT policy. Rows can only be written by
--      insert_audit_log() below, which is SECURITY DEFINER and granted to
--      service_role alone. A browser session therefore cannot forge or spam
--      audit rows, which is the entire reason the INSERT policy is absent.
--   2. IPs and user agents are stored as SHA-256 hashes, never raw. The hashes
--      are not secret (plain SHA-256 of a known address) which is exactly why
--      count_login_attempts() in 04 is not granted to authenticated: it would
--      otherwise be an account-enumeration oracle.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  event text not null,
  -- Booleans, enums and counts only. Never PII.
  meta jsonb not null default '{}'::jsonb,
  ip_hash text,
  ua_hash text,
  -- Whitelist, mirrored by the event check in lib/audit.ts: a typo in an event
  -- name is a dropped audit row, not a silent no-op. `%` is the LIKE wildcard,
  -- so each line matches "<prefix>.<anything>".
  constraint audit_logs_event_whitelist check (
    event like 'auth.%'
    or event like 'admin.%'
    or event like 'media.%'
    or event like 'contact.%'
    or event like 'settings.%'
    or event like 'telegram.%'
    or event like 'ai.%'
    or event like 'security.%'
    or event like 'app.%'
    or event like 'maintenance.%'
  )
);

-- Retention queries scan by age; the dashboard reads recent rows in order.
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_event_idx
  on public.audit_logs (event);
create index if not exists audit_logs_actor_id_idx
  on public.audit_logs (actor_id)
  where actor_id is not null;

alter table public.audit_logs enable row level security;

-- Data API grants (required for new public tables since Oct 30, 2026). The
-- grants are broad; the RLS policies below are what actually restrict access.
grant all on table public.audit_logs to anon, authenticated, service_role;

-- Read so the dashboard can show a trail; delete as a manual escape hatch
-- (automated retention goes through the service-role function below). No
-- INSERT or UPDATE policy: insert_audit_log() is the only writer.
drop policy if exists "admin can read audit logs" on public.audit_logs;
drop policy if exists "admin can delete audit logs" on public.audit_logs;
create policy "admin can read audit logs" on public.audit_logs
  for select to authenticated using (public.is_admin());
create policy "admin can delete audit logs" on public.audit_logs
  for delete to authenticated using (public.is_admin());

-- Best-effort writer. Execute is granted to `service_role` ALONE: this function
-- is SECURITY DEFINER, so also granting `authenticated` would let anyone
-- signed in POST to /rest/v1/rpc/insert_audit_log with a spoofed actor_id and
-- forge the trail. It never raises — a failed audit must not fail the request
-- that triggered it.
--
-- p_event is the only required parameter, and Postgres requires non-defaulted
-- parameters to come first — hence the order. Callers use named arguments, so
-- the order is invisible to them.
create or replace function public.insert_audit_log(
  p_event text,
  p_actor_id uuid default null,
  p_meta jsonb default '{}'::jsonb,
  p_ip_hash text default null,
  p_ua_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, event, meta, ip_hash, ua_hash)
  values (
    p_actor_id,
    p_event,
    coalesce(p_meta, '{}'::jsonb),
    p_ip_hash,
    p_ua_hash
  );
exception
  when others then
    null; -- swallow: auditing is never allowed to break a request
end;
$$;

-- Revoke from `public` AND from anon/authenticated by name. See the note in
-- 01_core.sql: revoking only from `public` leaves Supabase's default-privilege
-- grants to anon and authenticated intact, and this function is SECURITY
-- DEFINER, so a surviving anon grant is a direct unauthenticated write to the
-- audit trail. Measured, not assumed — see 06_lock_down_rpc_grants.sql.
revoke all on function public.insert_audit_log(text, uuid, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.insert_audit_log(text, uuid, jsonb, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Retention. Audit rows are append-only evidence, so they have to be trimmed
-- on a fixed window or the table grows forever. There is no cron: the app
-- calls this on dashboard page loads (best effort, fire-and-forget, at most
-- once an hour per process) so retention piggybacks on real admin traffic.
--
-- Applied = trimmed, with a floor of 1 day so a bad argument can never wipe
-- the trail, and it never raises: retention must not break a page render.
--
-- service_role ALONE (see the header note). SECURITY DEFINER, because the
-- caller bypasses the RLS delete policy above via the service role anyway, but
-- the function is the only supported entry point and is kept narrow on purpose.
-- ---------------------------------------------------------------------------
create or replace function public.purge_audit_logs_older_than(
  p_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.audit_logs
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
exception
  when others then
    return 0; -- best effort: retention must never break a page render
end;
$$;

revoke all on function public.purge_audit_logs_older_than(integer)
  from public, anon, authenticated;
grant execute on function public.purge_audit_logs_older_than(integer)
  to service_role;

commit;
