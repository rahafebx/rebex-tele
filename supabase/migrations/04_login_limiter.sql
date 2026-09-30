-- 04_login_limiter.sql — baseline: the durable sign-in attempt ledger.
--
-- Self-contained: this file does not depend on 01_core.sql and may be applied
-- in any order relative to it, but keep the 01-04 sequence anyway so a fresh
-- setup stays a single predictable pass.
--
-- What this replaces: lib/rate-limit.ts keeps an in-memory bucket per process,
-- which resets on every restart and is not shared between instances. Sign-in
-- is the one surface where that is not good enough, so the durable limit lives
-- here. See the function comment for the deliberate (email, ip) pair keying and
-- for why it fails OPEN.

begin;

-- ---------------------------------------------------------------------------
-- Every sign-in attempt, successful or not. Emails and IPs are stored as
-- SHA-256 hashes, never raw values.
--
-- RLS is enabled with NO policies at all, so anon and authenticated can reach
-- zero rows. The Data API grants below are still required (Supabase stopped
-- auto-granting on Oct 30, 2026) and are harmless precisely because RLS has
-- no policy to satisfy; service_role bypasses RLS for the server-side writes.
-- ---------------------------------------------------------------------------
create table if not exists public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip_hash text,
  email_hash text not null,
  success boolean not null
);

create index if not exists login_attempts_email_created_idx
  on public.login_attempts (email_hash, created_at desc);
create index if not exists login_attempts_ip_created_idx
  on public.login_attempts (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists login_attempts_created_idx
  on public.login_attempts (created_at desc);

alter table public.login_attempts enable row level security;

grant all on table public.login_attempts to anon, authenticated, service_role;

-- Returns TRUE when the pair should be blocked (>= attempt_limit FAILED
-- attempts inside the window). Only failures count: a successful login must
-- never extend a block.
--
-- The key is the (email, ip) PAIR, deliberately. A per-email-only cap would
-- let anyone lock the admin out with 5 failures from a throwaway IP, which on
-- a single-admin app is a self-inflicted DoS. When p_ip_hash is null the IP
-- predicate is skipped and only the email is counted, so a host that sends no
-- IP header (self-hosted behind no proxy) is still limited rather than
-- unlimited. Rows with a null ip_hash are NOT counted toward an IP-bearing
-- request — otherwise no-IP requests could inflate every IP's counter.
-- Trade-off: rotating IPs gets one window's worth of attempts per IP.
--
-- It fails OPEN. A missing table, a bad grant or a database outage returns
-- false, i.e. "not blocked". Locking the single admin out of their own
-- dashboard is worse than allowing one extra guess, so every error path
-- resolves to "allow" and is recorded as an app.login_limiter.error audit row.
create or replace function public.count_login_attempts(
  p_email_hash text,
  p_ip_hash text default null,
  p_window_minutes integer default 15,
  p_attempt_limit integer default 5
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_blocked boolean := false;
begin
  select count(*) >= greatest(coalesce(p_attempt_limit, 5), 1)
    into v_blocked
  from public.login_attempts a
  where a.success = false
    and a.email_hash = p_email_hash
    and a.created_at > now() - make_interval(mins => greatest(coalesce(p_window_minutes, 15), 1))
    and (p_ip_hash is null or a.ip_hash = p_ip_hash);

  return v_blocked;
exception
  when others then
    return false; -- fail open: never brick sign-in on a limiter error
end;
$$;

-- Execute is granted to `service_role` ONLY. With `authenticated` also granted,
-- the browser could call this RPC with a guessed email hash and learn whether
-- that account has recent failures — an account-enumeration oracle, and the
-- hashes are not secret (plain SHA-256 of a known address). The app only ever
-- calls it through the service-role client.
--
-- `anon` is revoked by name as well as `public`: revoking only from `public`
-- leaves Supabase's default-privilege grant in place, and this was measured —
-- the function answered a request carrying only the anon key. See
-- 06_lock_down_rpc_grants.sql.
revoke all on function public.count_login_attempts(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.count_login_attempts(text, text, integer, integer)
  to service_role;

commit;
