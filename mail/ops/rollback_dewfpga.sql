-- dewfpga rollback (operator script, NOT a migration: mail/sql holds only 001-003).
-- Removes ONLY what mail/sql/001, 002 and 003 created, in one transaction.
--
-- !!! DATA LOSS. This permanently deletes every dewfpga_ table with its rows: subscribers (addresses,
-- !!! consent records, tokens), the mail ledger and approvals, the account profiles and their links.
-- !!! There is no undo inside the database. Back the dewfpga_ tables up FIRST, and keep the file:
-- !!!   pg_dump "$DB_URL" --no-owner --table='public.dewfpga_*' -f "dewfpga-backup-$(date +%Y%m%d-%H%M%S).sql"
-- !!! (tables, their data, indexes and constraints; the functions are re-created by 001-003).
--
-- Never run automatically. The operator runs it by hand, after reading mail/ops/preflight_readonly.sql's report:
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f mail/ops/rollback_dewfpga.sql
--
-- What it does NOT touch: auth.users and the auth schema (shared identities), the pgcrypto extension
-- (001 only ensures it exists; other applications may use it), roles and their default privileges, and
-- any object that is not one of the dewfpga_ objects named below. There is no CASCADE anywhere.
-- Dependents outside dewfpga, three layers:
--   * the guard below names foreign keys into dewfpga_ tables and views over them, and refuses up front;
--   * every other dependency PostgreSQL tracks (table inheritance, a column DEFAULT on the ledger
--     sequence, an RLS policy or SQL-body function using a dewfpga_ function, a view over a dewfpga_
--     function, a table not named dewfpga_* referencing one) is refused by PostgreSQL at the drop itself,
--     with its own message; ON_ERROR_STOP aborts the single transaction and NOTHING is removed;
--   * what PostgreSQL does NOT track: another application's plpgsql function or trigger function that
--     calls a dewfpga_ RPC by name. The guard looks for those by body text (any non-dewfpga function
--     whose source contains 'dewfpga_', also preflight section 4c) and refuses while one exists. This
--     can be a false positive (a comment mentioning dewfpga_): inspect, then drop or change it by hand.
-- A dewfpga_ object that is not part of 001-003 as they stand (preflight section 8b) is reported at the
-- end and left in place.
-- The optional trigger dewfpga_profile_on_signup on auth.users, a first draft that 003 drops when it
-- applies, is NOT dropped here because it sits on auth.users; if preflight section 5 shows it, drop it
-- by hand (then its function below drops cleanly; until then the function drop refuses, as intended).
--
-- Verified on a private PostgreSQL by mail/tests/test_activation_sql.py: other applications' tables and
-- auth.users rows are byte-identical after this runs; a foreign referrer makes it fail with zero drops;
-- 001-003 apply cleanly afterwards.

begin;

-- guard: name every non-dewfpga dependent up front (the drops below would refuse anyway, one at a time)
do $$
declare dependents text;
begin
  select string_agg(d, E'\n  ') into dependents from (
    select format('foreign key %s on %s references %s', k.conname, k.conrelid::regclass, k.confrelid::regclass) as d
    from pg_constraint k join pg_class c on c.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace
         join pg_class rc on rc.oid = k.conrelid
    where k.contype = 'f' and n.nspname = 'public' and c.relname like 'dewfpga\_%' and rc.relname not like 'dewfpga\_%'
    union all
    select format('view %s depends on %s', v.oid::regclass, c.oid::regclass)
    from pg_depend dp join pg_rewrite rw on rw.oid = dp.objid and dp.classid = 'pg_rewrite'::regclass
         join pg_class v on v.oid = rw.ev_class
         join pg_class c on c.oid = dp.refobjid and dp.refclassid = 'pg_class'::regclass
         join pg_namespace n on n.oid = c.relnamespace
    where dp.deptype = 'n' and n.nspname = 'public' and c.relname like 'dewfpga\_%' and v.oid <> c.oid
      and v.relname not like 'dewfpga\_%'
    union all
    -- untracked by PostgreSQL: a plpgsql/trigger function of another application calling a dewfpga_ RPC
    select format('function %I.%I(%s) names a dewfpga_ object in its body (PostgreSQL tracks no dependency for this): inspect, then drop or change it by hand',
                  n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
      and p.proname not like 'dewfpga\_%' and p.prosrc like '%dewfpga\_%'
  ) x;
  if dependents is not null then
    raise exception E'rollback refused: objects outside dewfpga depend on or name dewfpga_ objects; nothing was dropped. Inspect each, then drop or change it by hand and run this again:\n  %', dependents;
  end if;
end $$;

-- 003: policy, account functions, the link column's index (the column and its FK go with the table)
drop policy if exists dewfpga_profiles_self_select on public.dewfpga_profiles;
drop function if exists public.dewfpga_enrol_me();
drop function if exists public.dewfpga_link_subscription(uuid);
drop function if exists public.dewfpga_export_me();
drop function if exists public.dewfpga_delete_me();
drop function if exists public.dewfpga_profile_on_signup();        -- first draft; refuses while its trigger exists on auth.users
drop index if exists public.dewfpga_subscribers_user_id;

-- 002: ledger functions (current and the superseded signatures 002 itself drops)
drop function if exists public.dewfpga_mail_campaign_gate(text);
drop function if exists public.dewfpga_mail_approve(text, text, text);
drop function if exists public.dewfpga_mail_approve(text, text);
drop function if exists public.dewfpga_mail_resolve(bigint, text, text, text);
drop function if exists public.dewfpga_mail_settle(bigint, uuid, text, text);
drop function if exists public.dewfpga_mail_settle(bigint, text, text);
drop function if exists public.dewfpga_mail_lookup(text);
drop function if exists public.dewfpga_mail_reserve(text, text, text, text, text, text, text);
drop function if exists public.dewfpga_mail_reserve(text, text, text, text, text, text);
drop function if exists public.dewfpga_mail_budget(text);
drop function if exists public.dewfpga_mail_budget();
drop function if exists public.dewfpga_mail_limits();

-- 001: newsletter functions (current and the superseded signatures 001 itself drops)
drop function if exists public.dewfpga_newsletter_prune();
drop function if exists public.dewfpga_recipients();
drop function if exists public.dewfpga_mark_confirm_sent(uuid, bigint, uuid);
drop function if exists public.dewfpga_mark_confirm_sent(uuid, bigint);
drop function if exists public.dewfpga_pending_confirmations(integer);
drop function if exists public.dewfpga_unsubscribe(uuid);
drop function if exists public.dewfpga_confirm(uuid);
drop function if exists public.dewfpga_subscribe(text, text, text);

-- tables, referrers first (subscribers -> profiles; approvals -> ledger -> consumers). No CASCADE.
drop table if exists public.dewfpga_subscribers;        -- includes 003's user_id column, its FK and index
drop table if exists public.dewfpga_profiles;           -- its FK to auth.users goes with it; auth.users is untouched
drop table if exists public.dewfpga_mail_approvals;
drop table if exists public.dewfpga_mail_ledger;        -- its identity sequence dewfpga_mail_ledger_id_seq goes with it
drop table if exists public.dewfpga_mail_consumers;

-- what, if anything, is left: only objects 001-003 never created (left in place on purpose)
do $$
declare leftover text;
begin
  select string_agg(d, ', ') into leftover from (
    select c.relkind::text || ' ' || c.relname as d
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'dewfpga\_%' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'i')
    union all
    select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'dewfpga\_%'
  ) x;
  if leftover is null then
    raise notice 'rollback_dewfpga: no dewfpga_ object remains in public';
  else
    raise warning 'rollback_dewfpga: dewfpga_ objects NOT created by 001-003 remain (not touched): %', leftover;
  end if;
end $$;

commit;
