-- 06_lock_down_rpc_grants.sql — apply to the live database.
--
-- Fixes a real, measured authorization defect. Not a fresh-setup concern: the
-- baseline files already grant correctly, so on a new project this is a no-op.
--
-- THE DEFECT
-- Every SECURITY DEFINER function here was meant to be reachable only by
-- `service_role`, and each was locked down with:
--
--     revoke all on function X from public;
--     grant execute on function X to service_role;
--
-- That is not sufficient on Supabase. The platform applies ALTER DEFAULT
-- PRIVILEGES that grant EXECUTE on newly created functions in the `public`
-- schema to `anon` and `authenticated` **by name**. `REVOKE ... FROM public`
-- removes only the grant inherited from the PUBLIC pseudo-role, so the explicit
-- anon/authenticated grants survive it. Every "lock down" in this schema's
-- history was written the ineffective way.
--
-- IMPACT. Under the single-admin model with public sign-ups disabled, an
-- unauthenticated caller still cannot read a single table row: RLS holds, and it
-- was verified to hold. So this is a defence-in-depth failure rather than a
-- direct data breach — except for bot_command_response, which is a genuine
-- unauthenticated credential-disclosure path the moment a webhook secret exists.
-- It also hands out the bot token verbatim: bot_token and watch_bot_token are
-- stored as PLAINTEXT on this project (measured), because REBEX_ENCRYPTION_KEY
-- was introduced after those rows were written and lib/crypto.ts passes
-- non-enc:v1: values through untouched. Re-encrypting them is an app-side action
-- rather than a migration, since the AES key is derived from
-- REBEX_ENCRYPTION_KEY in lib/crypto.ts; do it by re-saving the tokens in
-- Settings. Until then, revoking anon from bot_command_response — or dropping
-- it, in 05 — is what stands between an attacker and the token.
--
-- THE FIX
-- Revoke from the two roles by name as well as from `public`. `anon` gets
-- nothing. `authenticated` keeps EXECUTE on is_admin() only, because RLS
-- policies evaluate as the querying role and must be allowed to call it.
--
-- `revoke` is a no-op when the privilege was never granted, so this is safe to
-- re-run and safe on a database that was already correct.

begin;

-- The audit writer. service_role only.
revoke all on function public.insert_audit_log(text, uuid, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.insert_audit_log(text, uuid, jsonb, text, text)
  to service_role;

-- Audit retention. service_role only.
revoke all on function public.purge_audit_logs_older_than(integer)
  from public, anon, authenticated;
grant execute on function public.purge_audit_logs_older_than(integer)
  to service_role;

-- Sign-in attempt counter. service_role only — granting it to anon or
-- authenticated turns it into an account-enumeration oracle.
revoke all on function public.count_login_attempts(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.count_login_attempts(text, text, integer, integer)
  to service_role;

-- RLS helper. authenticated needs this (policies call it as the querying role).
-- anon does not: no table has an anon-facing policy.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

commit;

-- bot_command_response, acquire_schedule_lock and release_schedule_lock are
-- anon-reachable for the same reason and are dropped by
-- 05_drop_dead_functions.sql rather than revoked here. Apply 05 before 06, or
-- at least alongside it — revoking an unreferenced function is pointless, and
-- bot_command_response is the one that matters.

-- ===========================================================================
-- Verify after applying. Every row should read exec_anon = false; only
-- is_admin should read exec_authenticated = true.
-- ===========================================================================
--
--   select p.oid::regprocedure::text as function,
--          has_function_privilege('anon',         p.oid, 'execute') as exec_anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as exec_auth,
--          has_function_privilege('service_role',  p.oid, 'execute') as exec_service
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--   order by 1;
--
-- The same three columns are part of scripts/schema-dump.sql, so a throwaway
-- project can be diffed against production on this too.
--
-- Note that PostgREST cannot confirm this on its own. An RPC returning PGRST202
-- means "no cached function matched this name and argument names", which is
-- indistinguishable from the function being absent — an argument named p_key
-- against a real function taking `key` reports exactly the same PGRST202 as a
-- function that does not exist. The SQL above is the only reliable check.
-- ===========================================================================
