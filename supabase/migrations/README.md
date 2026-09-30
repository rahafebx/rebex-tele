# Database migrations

Four baseline files. Apply **all four, in this order**, in the Supabase SQL
editor. There is no migration runner in this project, so each file is pasted by
hand.

| # | file | what it creates |
|---|---|---|
| 1 | `01_core.sql` | `telegram_bot`, `telegram_chats`, `telegram_topics`, `admin_last_login`, `admin_config`, `telegram_commands`, `message_templates`, `is_admin()`, all RLS policies |
| 2 | `02_bot_features.sql` | `scheduled_messages` (depends on `is_admin()` and `telegram_chats`) |
| 3 | `03_audit.sql` | `audit_logs`, `insert_audit_log()`, `purge_audit_logs_older_than()` |
| 4 | `04_login_limiter.sql` | `login_attempts`, `count_login_attempts()` |

Each file is a single `begin` / `commit` transaction, so a failure rolls the
whole file back instead of leaving half a schema behind.

## Files 5 and 6 — only for databases that predate the baseline

Both are **no-ops on a fresh setup**, because the baseline never creates the
objects they touch and never mis-grants them. Apply them only to an existing
database built from the old numbered migrations.

| # | file | what it does |
|---|---|---|
| 5 | `05_drop_dead_functions.sql` | Drops `bot_command_response`, `acquire_schedule_lock`, `release_schedule_lock`. Three unreferenced functions the old migrations created. One of them returns `bot_token`, so this is a security fix, not hygiene |
| 6 | `06_lock_down_rpc_grants.sql` | **Apply this one.** Revokes `anon` and `authenticated` EXECUTE on the four remaining SECURITY DEFINER functions. Fixes a measured defect, described below |

Apply `05` before `06`. A `has_function_privilege` verification query is at the
bottom of `06`.

### Why files 5 and 6 exist

Every SECURITY DEFINER function here is meant to be reachable only by
`service_role`, and each was locked down with `revoke ... from public` followed
by `grant execute ... to service_role`. **That idiom does not work on Supabase.**
The platform applies `ALTER DEFAULT PRIVILEGES` that grant EXECUTE on newly
created functions in the `public` schema to `anon` and `authenticated` *by
name*. `REVOKE ... FROM public` removes only the grant inherited from the PUBLIC
pseudo-role, so the explicit per-role grants survive it.

Probed against the live project with nothing but the public anon key, before the
fix: `insert_audit_log` accepted a write, `count_login_attempts` answered,
`purge_audit_logs_older_than` answered, and `bot_command_response` answered —
including the function whose `007` comment says it revoked that grant. RLS itself
was verified intact in the same probe (anon read 0 rows from all six RLS-enabled
tables), so this is a function-grant defect rather than an open database. The fix
is to revoke from the two roles by name as well. `01_core.sql`, `03_audit.sql`
and `04_login_limiter.sql` all do that, so fresh setups are correct by
construction.

`authenticated` keeps EXECUTE on `is_admin()` only, because RLS policies
evaluate as the querying role and must be allowed to call it. `anon` gets
nothing: no table in this schema has an anon-facing policy.

`bot_command_response` is dropped rather than revoked because nothing calls it,
and it is the most dangerous of the three — it returns `bot_token` verbatim,
bypassing RLS, gated only on the webhook secret.

## Seeding the admin id

Afterwards, seed your admin UUID if the `admin_config` row came out blank (it
seeds itself from `auth.users`, which is empty on a brand-new project):

```sql
insert into public.admin_config (singleton, admin_id)
values (true, '<your-admin-auth-uuid>');
```

## The baseline files are immutable

Once a real database has been stood up from them, editing them silently forks
that database from the next one, with nothing to detect it. **Do not change the
schema by editing `01`-`04`.** Add a new numbered file instead, so the intent is
legible and replayable.

The same applies to the `grant all on table ... to anon, authenticated,
service_role;` block that follows every table. It is still required: the Supabase
Data API stopped auto-granting on new public tables on Oct 30, 2026. RLS is what
actually restricts access; those grants only keep the tables reachable.

## Replayability

Every statement in the baseline is safe to run twice:

- `create table if not exists`, `create index if not exists`
- `create or replace function` for all four functions
- `grant` / `revoke`, which are naturally idempotent (revoking a privilege that
  was never granted is a no-op, not an error)
- each `create policy` immediately preceded by its own `drop policy if exists`:
  that pairing is the only way to make a policy re-creatable, and it is the only
  `drop` in the baseline. It is not history cleanup

The one statement that used to break a re-run, `add column title` in the old
`009`, no longer exists: every column is declared in its parent `create table`.

## Verifying a fresh setup against an existing database

`scripts/schema-dump.sql` emits a deterministic, diffable description of the
`public` schema — RLS flags, columns, **policy predicate bodies**, indexes,
constraints, function security attributes, and the three Data API roles'
privileges. Run it in both projects and diff the two outputs.

The policy predicates are the part worth checking: they are invisible through
PostgREST, and a wrong one fails silently. The `exec_anon` column is the part
worth checking after applying file 6: every row should read `false` except
`is_admin`, which should read `false` for anon and `true` for authenticated.