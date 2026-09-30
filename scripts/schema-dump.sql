-- schema-dump.sql — read-only. Emits a deterministic, diffable description of
-- the `public` schema so two Supabase projects can be compared exactly.
--
-- Why this exists: the app reaches the database through PostgREST, which cannot
-- see RLS policies, index definitions or constraint bodies. Those are the parts
-- of a squashed baseline most likely to be wrong, and a wrong policy predicate
-- fails silently. The SQL editor can see all of it, so it is the oracle.
--
-- How to use it:
--   1. Run this whole file in the SQL editor of your PRODUCTION project.
--   2. Run it in a THROWAWAY project that was stood up from
--      supabase/migrations/01..04.
--   3. Save both result sets as text and diff them.
--
-- Expected result on a correct baseline: every line identical except rows that
-- legitimately differ, which are only:
--   * COLUMN public.admin_config.admin_id   (no data, just a uuid default)
--   * anything referencing auth.users
-- There should be no other difference. Any POLICY or FUNCTION difference is a
-- real bug in the baseline.
--
-- Safe to run repeatedly: it only reads.

with dump as (

  -- 1. RLS enabled, per table.
  select
    'RLS'::text as kind,
    c.relname as obj,
    case when c.relrowsecurity then 'enabled' else 'DISABLED' end as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname <> '_migrations'
  union all

  -- 2. Columns: type, nullability, default.
  select
    'COLUMN',
    c.relname || '.' || a.attname,
    format_type(a.atttypid, a.atttypmod)
      || ' null=' || (case when a.attnotnull then 'no' else 'yes' end)
      || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
    and a.attnum > 0 and not a.attisdropped
    and c.relname <> '_migrations'
  union all

  -- 3. Policies. qual / with_check are the predicate bodies -- the part that
  --    PostgREST cannot show and the part most worth diffing.
  select
    'POLICY',
    p.tablename || '.' || p.policyname,
    'cmd=' || p.cmd
      || ' roles=' || p.roles::text
      || ' permissive=' || p.permissive::text
      || ' using=' || coalesce(p.qual, '-')
      || ' check=' || coalesce(p.with_check, '-')
  from pg_policies p
  where p.schemaname = 'public'
  union all

  -- 4. Indexes, including the partial-index predicates.
  select 'INDEX', i.tablename || '.' || i.indexname, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public'
  union all

  -- 5. Constraints (check, unique, foreign key, primary key).
  select
    'CONSTRAINT',
    c.relname || '.' || con.conname,
    con.contype::text || ' ' || pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  union all

  -- 6. Functions: signature, SECURITY DEFINER, search_path, and who may EXECUTE.
  --    Probed with has_*_privilege rather than dumped from acl, because a role
  --    that never received a grant is absent from the acl array and would
  --    otherwise show up as a false "no difference".
  select
    'FUNCTION',
    p.oid::regprocedure::text,
    'security_definer=' || p.prosecdef::text
      || ' volatility=' || p.provolatile::text
      || ' search_path=' || coalesce(
           (select s from unnest(coalesce(p.proconfig, '{}')) s
            where s like 'search\_path=%' limit 1), '-')
      || ' exec_anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
      || ' exec_authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
      || ' exec_service=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  union all

  -- 7. Table privileges for the three Data API roles.
  select
    'GRANT',
    c.relname,
    'select_anon=' || has_table_privilege('anon', c.oid, 'SELECT')::text
      || ' select_auth=' || has_table_privilege('authenticated', c.oid, 'SELECT')::text
      || ' select_service=' || has_table_privilege('service_role', c.oid, 'SELECT')::text
      || ' update_service=' || has_table_privilege('service_role', c.oid, 'UPDATE')::text
      || ' delete_service=' || has_table_privilege('service_role', c.oid, 'DELETE')::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname <> '_migrations'

)
select kind || ' | ' || obj || ' | ' || detail as line
from dump
order by 1;
