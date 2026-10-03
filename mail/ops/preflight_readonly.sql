-- dewfpga activation preflight (operator script, NOT a migration: mail/sql holds only 001-003).
-- What the shared Supabase project looks like BEFORE 001-003 are applied
-- (or after, to confirm). Read-only by construction: the whole file runs inside one
-- `begin transaction read only` ... `rollback`; PostgreSQL refuses every write in it (INSERT, UPDATE,
-- DELETE, DDL, even CREATE TEMP TABLE) and nothing is committed. Verified by mail/tests/test_activation_sql.py.
--
-- Run as the project owner against the project's connection string:
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f mail/ops/preflight_readonly.sql
-- Exit code 0 and a final "ROLLBACK" mean the report is complete. Any error aborts the transaction;
-- nothing is left behind either way.
-- Privileges: no superuser. Everything reads the system catalogs, which every role can read. The only
-- table data read is the exact row count of the dewfpga_ tables (sections 7 and 8a), and only when
-- the connecting role has SELECT on that table; otherwise the cell says 'no select privilege' and the
-- report still completes. Other applications' tables are never read: their size is pg_class.reltuples,
-- the planner's estimate (empty when the table was never analyzed).
--
-- Sections: 1 server and role; 2 pgcrypto; 3 dewfpga_ objects in public (tables, functions, policies,
-- indexes, sequences; counts are 0 on a project that never had dewfpga); 4 the other applications'
-- tables in public and which of them reference auth.users, 4b foreign keys into dewfpga_ tables,
-- 4c other applications' functions whose body names a dewfpga_ object (PostgreSQL does not track
-- these as dependencies); 5 triggers on auth.users; 6 default privileges in public (what new objects
-- automatically grant anon/authenticated/service_role); 7 row counts of the dewfpga_ tables; 8 which
-- parts of 001/002/003 are already present and which dewfpga_ objects are NOT part of 001-003
-- (leftovers of an older version, to be removed by hand).

begin transaction read only;

\echo
\echo '== 1. server, database, role =='
select version();
select current_database() as database, current_user as "current_user", session_user as "session_user",
       r.rolsuper as superuser, r.rolbypassrls as bypass_rls, r.rolcreaterole as create_role, now() as at
from pg_roles r where r.rolname = current_user;
select rolname as supabase_role, rolbypassrls as bypass_rls
from pg_roles where rolname in ('anon', 'authenticated', 'service_role') order by 1;

\echo
\echo '== 2. pgcrypto (001 does "create extension if not exists"; gen_random_uuid needs it on PG < 13) =='
select e.extname, n.nspname as schema, e.extversion as version
from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';

\echo
\echo '== 3a. dewfpga_ tables in public (rls: row level security on; anon_any/auth_any: any table privilege granted) =='
select c.relname as "table", c.relrowsecurity as rls,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       case when exists (select 1 from pg_roles where rolname = 'anon')
            then has_table_privilege('anon', c.oid, 'select,insert,update,delete') end as anon_any,
       case when exists (select 1 from pg_roles where rolname = 'authenticated')
            then has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') end as auth_any,
       case when exists (select 1 from pg_roles where rolname = 'service_role')
            then has_table_privilege('service_role', c.oid, 'select,insert,update,delete') end as service_any,
       pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'dewfpga\_%' order by 1;

\echo '== 3b. dewfpga_ functions in public (secdef: security definer; search_path: pinned config; anon_exec/auth_exec) =='
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as "function",
       p.prosecdef as secdef, p.proconfig as search_path,
       case when exists (select 1 from pg_roles where rolname = 'anon')
            then has_function_privilege('anon', p.oid, 'execute') end as anon_exec,
       case when exists (select 1 from pg_roles where rolname = 'authenticated')
            then has_function_privilege('authenticated', p.oid, 'execute') end as auth_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'dewfpga\_%' order by 1;

\echo '== 3c. policies on dewfpga_ tables =='
select tablename as "table", policyname as policy, cmd, roles, qual as "using"
from pg_policies where schemaname = 'public' and tablename like 'dewfpga\_%' order by 1, 2;

\echo '== 3d. indexes on dewfpga_ tables =='
select tablename as "table", indexname as index, indexdef
from pg_indexes where schemaname = 'public' and tablename like 'dewfpga\_%' order by 1, 2;

\echo '== 3e. dewfpga_ sequences in public =='
select c.relname as sequence, pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'dewfpga\_%' order by 1;

\echo '== 3f. dewfpga_ object counts (all 0 on a project that never had dewfpga) =='
select 'dewfpga_tables' as item,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'dewfpga\_%') as count
union all select 'dewfpga_functions',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'dewfpga\_%')
union all select 'dewfpga_policies',
       (select count(*) from pg_policies where schemaname = 'public' and tablename like 'dewfpga\_%')
union all select 'dewfpga_indexes',
       (select count(*) from pg_indexes where schemaname = 'public' and tablename like 'dewfpga\_%')
union all select 'dewfpga_sequences',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'dewfpga\_%')
union all select 'dewfpga_views',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('v', 'm') and c.relname like 'dewfpga\_%');

\echo
\echo '== 4. other applications: non-dewfpga tables in public; fk_to_auth_users = has a foreign key to auth.users (rollback never touches these) =='
\echo '   rows_estimate is pg_class.reltuples (planner estimate, empty when never analyzed): these tables are not read'
select c.relname as "table", c.relrowsecurity as rls,
       exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
               and k.confrelid = (select u.oid from pg_class u join pg_namespace un on un.oid = u.relnamespace
                                  where un.nspname = 'auth' and u.relname = 'users')) as fk_to_auth_users,
       nullif(c.reltuples, -1)::bigint as rows_estimate,
       pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not like 'dewfpga\_%' order by 1;

\echo '== 4b. foreign keys from any table INTO dewfpga_ tables (a non-dewfpga referrer makes rollback_dewfpga.sql stop) =='
select k.conrelid::regclass as referrer, k.conname as constraint, k.confrelid::regclass as references_dewfpga
from pg_constraint k join pg_class c on c.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace
where k.contype = 'f' and n.nspname = 'public' and c.relname like 'dewfpga\_%'
order by 1, 2;

\echo '== 4c. other applications'' functions whose body names a dewfpga_ object (PostgreSQL tracks no dependency for these; rollback_dewfpga.sql refuses while they exist) =='
select n.nspname as schema, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as "function",
       l.lanname as language, (p.prorettype = 'trigger'::regtype) as trigger_fn
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
  and p.proname not like 'dewfpga\_%' and p.prosrc like '%dewfpga\_%'
order by 1, 2;

\echo
\echo '== 5. triggers on auth.users (dewfpga defines none; 003 drops the first-draft dewfpga_profile_on_signup if it exists) =='
select t.tgname as trigger, t.tgenabled as enabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = (select u.oid from pg_class u join pg_namespace un on un.oid = u.relnamespace where un.nspname = 'auth' and u.relname = 'users')
  and not t.tgisinternal order by 1;
-- (auth.users is found through the catalogs, not by name: a role without USAGE on schema auth may still run this)

\echo
\echo '== 6. default privileges in public (and global): what a NEW table/function/sequence grants automatically =='
select pg_get_userbyid(d.defaclrole) as for_objects_created_by,
       coalesce(n.nspname, '(all schemas)') as in_schema,
       case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence' when 'f' then 'function'
                            when 'T' then 'type' when 'n' then 'schema' else d.defaclobjtype::text end as object,
       d.defaclacl::text[] as acl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where d.defaclnamespace = 0 or n.nspname = 'public' order by 1, 2, 3;

\echo
\echo '== 7. row counts of dewfpga_ tables (empty when there are none; exact count only where this role has SELECT; RLS hides rows from a non-owner) =='
select c.relname as "table",
       case when has_table_privilege(current_user, c.oid, 'select')
            then (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
            else 'no select privilege' end as "rows",
       case when has_table_privilege(current_user, c.oid, 'select') and c.relrowsecurity
                 and c.relowner <> me.oid and not me.rolbypassrls
            then 'rls applies to this role: count may be 0' end as note
from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_roles me on me.rolname = current_user
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'dewfpga\_%' order by 1;

\echo
\echo '== 8a. which parts of 001/002/003 are already present (present = t; empty = this role cannot read the table that would tell, or RLS hides it) =='
with col as (
  select n.nspname, c.relname, a.attname, a.attnotnull
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where a.attnum > 0 and not a.attisdropped and n.nspname = 'public'
), consumers as (   -- can this role see the rows of dewfpga_mail_consumers at all?
  select c.oid, has_table_privilege(current_user, c.oid, 'select')
         and not (c.relrowsecurity and c.relowner <> me.oid and not me.rolbypassrls) as readable
  from pg_class c join pg_roles me on me.rolname = current_user
  where c.oid = to_regclass('public.dewfpga_mail_consumers')
)
select * from (values
  ('001', 'table dewfpga_subscribers',                       to_regclass('public.dewfpga_subscribers') is not null),
  ('001', 'dewfpga_subscribers: row level security on',      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.dewfpga_subscribers')), false)),
  ('001', 'dewfpga_subscribe(text,text,text)',               to_regprocedure('public.dewfpga_subscribe(text,text,text)') is not null),
  ('001', 'dewfpga_confirm(uuid)',                           to_regprocedure('public.dewfpga_confirm(uuid)') is not null),
  ('001', 'dewfpga_unsubscribe(uuid)',                       to_regprocedure('public.dewfpga_unsubscribe(uuid)') is not null),
  ('001', 'dewfpga_pending_confirmations(integer)',          to_regprocedure('public.dewfpga_pending_confirmations(integer)') is not null),
  ('001', 'dewfpga_mark_confirm_sent(uuid,bigint,uuid)',     to_regprocedure('public.dewfpga_mark_confirm_sent(uuid,bigint,uuid)') is not null),
  ('001', 'dewfpga_recipients()',                            to_regprocedure('public.dewfpga_recipients()') is not null),
  ('001', 'dewfpga_newsletter_prune()',                      to_regprocedure('public.dewfpga_newsletter_prune()') is not null),
  ('002', 'table dewfpga_mail_consumers',                    to_regclass('public.dewfpga_mail_consumers') is not null),
  ('002', 'dewfpga_mail_consumers.monthly_cap',              exists (select 1 from col where relname = 'dewfpga_mail_consumers' and attname = 'monthly_cap')),
  ('002', 'dewfpga_mail_consumers row ''dewfpga'' seeded',   case when to_regclass('public.dewfpga_mail_consumers') is null then false
                                                              when not (select readable from consumers) then null
                                                              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.dewfpga_mail_consumers where name = ''dewfpga''', false, true, '')))[1]::text::int > 0 end),
  ('002', 'table dewfpga_mail_ledger',                       to_regclass('public.dewfpga_mail_ledger') is not null),
  ('002', 'dewfpga_mail_ledger.logical_key not null',        exists (select 1 from col where relname = 'dewfpga_mail_ledger' and attname = 'logical_key' and attnotnull)),
  ('002', 'dewfpga_mail_ledger.uncertain',                   exists (select 1 from col where relname = 'dewfpga_mail_ledger' and attname = 'uncertain')),
  ('002', 'dewfpga_mail_ledger.claim_token',                 exists (select 1 from col where relname = 'dewfpga_mail_ledger' and attname = 'claim_token')),
  ('002', 'index dewfpga_mail_ledger_logical_key',           to_regclass('public.dewfpga_mail_ledger_logical_key') is not null),
  ('002', 'table dewfpga_mail_approvals',                    to_regclass('public.dewfpga_mail_approvals') is not null),
  ('002', 'dewfpga_mail_approvals.unsubscribe_method',       exists (select 1 from col where relname = 'dewfpga_mail_approvals' and attname = 'unsubscribe_method')),
  ('002', 'dewfpga_mail_limits()',                           to_regprocedure('public.dewfpga_mail_limits()') is not null),
  ('002', 'dewfpga_mail_budget(text)',                       to_regprocedure('public.dewfpga_mail_budget(text)') is not null),
  ('002', 'dewfpga_mail_reserve(7 x text)',                  to_regprocedure('public.dewfpga_mail_reserve(text,text,text,text,text,text,text)') is not null),
  ('002', 'dewfpga_mail_lookup(text)',                       to_regprocedure('public.dewfpga_mail_lookup(text)') is not null),
  ('002', 'dewfpga_mail_settle(bigint,uuid,text,text)',      to_regprocedure('public.dewfpga_mail_settle(bigint,uuid,text,text)') is not null),
  ('002', 'dewfpga_mail_resolve(bigint,text,text,text)',     to_regprocedure('public.dewfpga_mail_resolve(bigint,text,text,text)') is not null),
  ('002', 'dewfpga_mail_approve(text,text,text)',            to_regprocedure('public.dewfpga_mail_approve(text,text,text)') is not null),
  ('002', 'dewfpga_mail_campaign_gate(text)',                to_regprocedure('public.dewfpga_mail_campaign_gate(text)') is not null),
  ('003', 'table dewfpga_profiles',                          to_regclass('public.dewfpga_profiles') is not null),
  ('003', 'policy dewfpga_profiles_self_select',             exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'dewfpga_profiles_self_select')),
  ('003', 'dewfpga_subscribers.user_id',                     exists (select 1 from col where relname = 'dewfpga_subscribers' and attname = 'user_id')),
  ('003', 'fk dewfpga_subscribers.user_id -> dewfpga_profiles', exists (select 1 from pg_constraint where contype = 'f'
                                                                  and conrelid = to_regclass('public.dewfpga_subscribers')
                                                                  and confrelid = to_regclass('public.dewfpga_profiles'))),
  ('003', 'index dewfpga_subscribers_user_id',               to_regclass('public.dewfpga_subscribers_user_id') is not null),
  ('003', 'dewfpga_confirm(uuid) is the 003 (linking) version', coalesce((select prosrc like '%v_link%' from pg_proc where oid = to_regprocedure('public.dewfpga_confirm(uuid)')), false)),
  ('003', 'dewfpga_enrol_me()',                              to_regprocedure('public.dewfpga_enrol_me()') is not null),
  ('003', 'dewfpga_link_subscription(uuid)',                 to_regprocedure('public.dewfpga_link_subscription(uuid)') is not null),
  ('003', 'dewfpga_export_me()',                             to_regprocedure('public.dewfpga_export_me()') is not null),
  ('003', 'dewfpga_delete_me()',                             to_regprocedure('public.dewfpga_delete_me()') is not null)
) as parts (migration, part, present) order by migration, part;

\echo '== 8b. dewfpga_ objects in public that are NOT part of 001-003 as they stand (older versions; rollback_dewfpga.sql drops only the known ones) =='
select kind, name from (
  select 'table' as kind, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and c.relname like 'dewfpga\_%'
    and c.relname not in ('dewfpga_subscribers', 'dewfpga_mail_consumers', 'dewfpga_mail_ledger', 'dewfpga_mail_approvals', 'dewfpga_profiles')
  union all
  select 'sequence', c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'dewfpga\_%'
    and c.relname not in ('dewfpga_mail_ledger_id_seq')
  union all
  select 'index', indexname from pg_indexes
  where schemaname = 'public' and tablename like 'dewfpga\_%'
    and indexname not in ('dewfpga_subscribers_pkey', 'dewfpga_subscribers_email_key', 'dewfpga_subscribers_unsubscribe_token_key',
                          'dewfpga_subscribers_user_id', 'dewfpga_mail_consumers_pkey', 'dewfpga_mail_ledger_pkey',
                          'dewfpga_mail_ledger_idempotency_key_key', 'dewfpga_mail_ledger_created_at', 'dewfpga_mail_ledger_logical_key',
                          'dewfpga_mail_approvals_pkey', 'dewfpga_profiles_pkey')
  union all
  select 'policy', policyname from pg_policies
  where schemaname = 'public' and tablename like 'dewfpga\_%' and policyname not in ('dewfpga_profiles_self_select')
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'dewfpga\_%'
    and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' not in (
      'dewfpga_subscribe(p_email text, p_consent_text_version text, p_source text)',
      'dewfpga_confirm(p_token uuid)', 'dewfpga_unsubscribe(p_token uuid)',
      'dewfpga_pending_confirmations(p_limit integer)', 'dewfpga_mark_confirm_sent(p_id uuid, p_ledger_id bigint, p_confirm_token uuid)',
      'dewfpga_recipients()', 'dewfpga_newsletter_prune()',
      'dewfpga_mail_limits()', 'dewfpga_mail_budget(p_consumer text)',
      'dewfpga_mail_reserve(p_consumer text, p_kind text, p_idempotency_key text, p_recipient_hash text, p_payload_hash text, p_content_hash text, p_logical_key text)',
      'dewfpga_mail_lookup(p_idempotency_key text)', 'dewfpga_mail_settle(p_ledger_id bigint, p_claim_token uuid, p_status text, p_message_id text)',
      'dewfpga_mail_resolve(p_ledger_id bigint, p_status text, p_note text, p_message_id text)',
      'dewfpga_mail_approve(p_content_hash text, p_receipt_note text, p_unsubscribe_attestation text)',
      'dewfpga_mail_campaign_gate(p_content_hash text)',
      'dewfpga_enrol_me()', 'dewfpga_link_subscription(p_token uuid)', 'dewfpga_export_me()', 'dewfpga_delete_me()')
) as unexpected order by 1, 2;

\echo
\echo '== end of preflight: rolling back (nothing was written) =='
rollback;
