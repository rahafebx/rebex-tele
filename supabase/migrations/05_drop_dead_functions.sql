-- 05_drop_dead_functions.sql — apply to the live database.
--
-- FORWARD MIGRATION. Unlike 01-04 this is not part of the baseline: apply it to
-- an existing database built from the old numbered migrations. On a fresh setup
-- from the baseline it is a harmless no-op, because the baseline never creates
-- these three functions in the first place — which is exactly why it is safe to
-- leave in the sequence rather than special-casing it.
--
-- These were originally described as harmless dead code. They are not, and the
-- reason is a privilege defect rather than deadness. See 06_lock_down_rpc_grants.sql
-- for the measured evidence; the short version:
--
-- No CASCADE, deliberately. These functions have no dependents, and if that ever
-- stops being true the statement should fail loudly rather than silently drop
-- whatever was relying on them.

begin;

drop function if exists public.bot_command_response(text, text);
drop function if exists public.acquire_schedule_lock(bigint);
drop function if exists public.release_schedule_lock(bigint);

commit;
