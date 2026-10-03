-- dewfpga #24: newsletter with double opt-in, unsubscribe without login, a consent record.
--
-- Runs in the SAME Supabase project as dewsletter (its objects are sightstone_*); everything here is
-- dewfpga_*. Apply in the SQL editor as postgres, or with psql as the project owner. Idempotent.
--
-- Access model (verified by mail/tests/test_sql.py on a private PostgreSQL):
--   anon / authenticated  can only EXECUTE dewfpga_subscribe, dewfpga_confirm, dewfpga_unsubscribe.
--                         They cannot read, insert, update or delete the table: no token, no address,
--                         no "is this address subscribed" oracle leaves the database through them.
--   service_role          (the mailer, mail/dewfpga_mail.py) reads pending confirmations and recipients
--                         through the functions below and marks confirmations as sent.
-- Every function here is SECURITY DEFINER with a pinned search_path; EXECUTE is revoked from PUBLIC
-- first, because PostgreSQL grants EXECUTE to PUBLIC on every new function.

create extension if not exists pgcrypto;

create table if not exists public.dewfpga_subscribers (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null unique
                        check (email = lower(btrim(email)) and length(email) <= 254
                               and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  source                text not null default 'site' check (length(source) between 1 and 40),
  -- the consent record: which consent text the person ticked, and when (the text itself is versioned
  -- in mail/site/newsletter/index.html and mail/README.md; the version string is what is stored).
  consent_text_version  text not null check (length(consent_text_version) between 1 and 40),
  consent_at            timestamptz not null default now(),
  -- double opt-in: the token travels only in the confirmation mail; null once used.
  confirm_token         uuid default gen_random_uuid(),
  confirm_requested_at  timestamptz not null default now(),
  confirm_sent_at       timestamptz,
  confirm_ledger_id     bigint,
  confirmed_at          timestamptz,
  -- unsubscribe: the token is in every mail's footer and List-Unsubscribe header; no login needed.
  unsubscribe_token     uuid not null unique default gen_random_uuid(),
  unsubscribed_at       timestamptz,
  created_at            timestamptz not null default now()
);

alter table public.dewfpga_subscribers enable row level security;
-- No policies on purpose: with RLS on and no policy, a role that can reach the table sees no rows.
-- The grants below make sure anon/authenticated cannot even reach it.
revoke all on table public.dewfpga_subscribers from public, anon, authenticated;
grant select, insert, update, delete on table public.dewfpga_subscribers to service_role;

-- ---------------------------------------------------------------- anon-facing

-- Ask for a subscription. Returns nothing on purpose: the caller learns neither whether the address
-- was new, nor any token. The same address can re-request once every 10 minutes; a confirmed address
-- is left as it is; an unsubscribed address starts a new double opt-in (a new consent record).
--
-- A new consent record is a new generation of the row: confirm_token, unsubscribe_token and (when
-- 003 is applied) the account link user_id are all renewed. Otherwise whoever held the previous
-- unsubscribe token (an old mail footer, an old browser tab) or the previously linked account would
-- keep control over consent they were never given: they could cancel, re-link or export it. The link
-- is re-proven the way 003 proves it in the first place: dewfpga_confirm while signed in and enrolled,
-- or dewfpga_link_subscription with the NEW unsubscribe token from a mail.
create or replace function public.dewfpga_subscribe(p_email text, p_consent_text_version text, p_source text default 'site')
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  r public.dewfpga_subscribers%rowtype;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
    raise exception 'invalid email' using errcode = 'check_violation';
  end if;
  if coalesce(length(btrim(p_consent_text_version)), 0) not between 1 and 40 then
    raise exception 'consent required' using errcode = 'check_violation';
  end if;
  if coalesce(length(btrim(p_source)), 0) not between 1 and 40 then
    raise exception 'invalid source' using errcode = 'check_violation';
  end if;
  -- one row per address, serialised on the address
  perform pg_advisory_xact_lock(hashtext('dewfpga_subscribers:' || v_email));
  select * into r from public.dewfpga_subscribers where email = v_email;
  if not found then
    insert into public.dewfpga_subscribers (email, source, consent_text_version)
      values (v_email, btrim(p_source), btrim(p_consent_text_version));
    return;
  end if;
  if r.confirmed_at is not null and r.unsubscribed_at is null then
    return;                                     -- already subscribed: nothing to do, nothing to say
  end if;
  if r.unsubscribed_at is null and r.confirm_requested_at > now() - interval '10 minutes' then
    return;                                     -- pending and asked again within 10 minutes: throttle
  end if;
  update public.dewfpga_subscribers set
    source = btrim(p_source),
    consent_text_version = btrim(p_consent_text_version),
    consent_at = now(),
    confirm_token = gen_random_uuid(),
    confirm_requested_at = now(),
    confirm_sent_at = null,
    confirm_ledger_id = null,
    confirmed_at = null,
    unsubscribed_at = null,
    unsubscribe_token = gen_random_uuid()       -- the old footer link must not control the new consent
  where id = r.id;
  -- user_id is defined by 003_dewfpga_account.sql (uuid, FK to dewfpga_profiles ON DELETE CASCADE).
  -- It is NOT declared here: "add column if not exists ... references" in 003 would be skipped as a
  -- whole if this file created the column first, and the FK (and the cascade delete_me relies on)
  -- would silently be lost. So this file only clears the link when the column exists, through
  -- dynamic SQL, which is what lets the function load and run with 001 alone.
  if exists (select 1 from pg_attribute
             where attrelid = 'public.dewfpga_subscribers'::regclass and attname = 'user_id' and not attisdropped) then
    execute 'update public.dewfpga_subscribers set user_id = null where id = $1' using r.id;
  end if;
end $$;

-- The link in the confirmation mail. True once per token, within 48 hours of the mail being sent.
-- Creates no account and signs nobody in: it only flips confirmed_at on the subscriber row.
-- NOTE: 003_dewfpga_account.sql replaces this function with one that additionally links the row to
-- the caller's dewfpga account when (and only when) the caller is signed in and enrolled. Apply in order.
create or replace function public.dewfpga_confirm(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_token is null then return false; end if;
  update public.dewfpga_subscribers set
    confirmed_at = now(),
    confirm_token = null
  where confirm_token = p_token
    and confirmed_at is null
    and confirm_sent_at is not null
    and now() < confirm_sent_at + interval '48 hours';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- The link in every mail's footer. No login. Idempotent: a second click is still true.
-- Also cancels a pending confirmation for the same row.
create or replace function public.dewfpga_unsubscribe(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_token is null then return false; end if;
  update public.dewfpga_subscribers set
    unsubscribed_at = coalesce(unsubscribed_at, now()),
    confirm_token = null
  where unsubscribe_token = p_token;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------- mailer (service_role)

-- The service needs the real unsubscribe token even in the confirmation mail.
-- Changing a table return type requires replacing the old function first.
drop function if exists public.dewfpga_pending_confirmations(integer);
create or replace function public.dewfpga_pending_confirmations(p_limit integer default 20)
returns table (id uuid, email text, confirm_token uuid, unsubscribe_token uuid, consent_text_version text, confirm_requested_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select s.id, s.email, s.confirm_token, s.unsubscribe_token, s.consent_text_version, s.confirm_requested_at
  from public.dewfpga_subscribers s
  where s.confirmed_at is null and s.unsubscribed_at is null
    and s.confirm_sent_at is null and s.confirm_token is not null
  order by s.confirm_requested_at
  limit greatest(0, least(coalesce(p_limit, 20), 200));
$$;

-- The mailer reports "this confirmation mail went out" for the generation it actually mailed: the
-- row id AND the confirm token that was in the mail. If the person re-requested in between (a new
-- token, confirm_sent_at reset to null), the stale completion changes nothing and returns false, and
-- the new generation stays in dewfpga_pending_confirmations until its own mail goes out. Without the
-- token (the former 2-argument form, removed below) the stale completion marked the new generation
-- as sent although no mail carried its token: the person could never confirm.
-- A replay of an already recorded completion also returns false and does not move confirm_sent_at
-- (which would silently extend the 48-hour window promised in the mail).
drop function if exists public.dewfpga_mark_confirm_sent(uuid, bigint);
create or replace function public.dewfpga_mark_confirm_sent(p_id uuid, p_ledger_id bigint, p_confirm_token uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_id is null or p_confirm_token is null then return false; end if;
  update public.dewfpga_subscribers set confirm_sent_at = now(), confirm_ledger_id = p_ledger_id
  where id = p_id
    and confirm_token = p_confirm_token
    and confirm_sent_at is null
    and confirmed_at is null
    and unsubscribed_at is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.dewfpga_recipients()
returns table (id uuid, email text, unsubscribe_token uuid)
language sql security definer set search_path = public, pg_temp as $$
  select s.id, s.email, s.unsubscribe_token
  from public.dewfpga_subscribers s
  where s.confirmed_at is not null and s.unsubscribed_at is null
  order by s.confirmed_at, s.id;
$$;

-- Retention of rows nobody confirmed. Two promises are made to the person and both are kept:
--   * the confirmation mail says the link works for 48 hours after the mail was sent;
--   * an unconfirmed request becomes eligible for cleanup after seven days.
-- So an unconfirmed, not unsubscribed row is deleted once 7 days have passed since the request AND,
-- if a confirmation mail was actually sent, 48 hours have passed since it was sent. Real retention
-- eligibility is therefore after 7 days for a request that was never mailed, and at least 48 hours
-- after a late send (a mail sent on day 6 keeps its link alive until day 8; the old rule deleted the
-- row on day 7 while the link in the inbox was still valid). An unsubscribed address is deleted after
-- 30 days. confirm_sent_at is written once per generation (mark_confirm_sent), so nothing here can be
-- stretched by replaying a completion.
-- There is no scheduler: this runs only when the mailer (mail/dewfpga_mail.py, live run) calls it,
-- so in practice rows live until the next live run after the dates above.
-- Returns (pending deleted, unsubscribed deleted).
create or replace function public.dewfpga_newsletter_prune()
returns table (pending_deleted integer, unsubscribed_deleted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a integer; b integer;
begin
  delete from public.dewfpga_subscribers
    where confirmed_at is null and unsubscribed_at is null
      and confirm_requested_at < now() - interval '7 days'
      and (confirm_sent_at is null or confirm_sent_at < now() - interval '48 hours');
  get diagnostics a = row_count;
  delete from public.dewfpga_subscribers
    where unsubscribed_at is not null and unsubscribed_at < now() - interval '30 days';
  get diagnostics b = row_count;
  return query select a, b;
end $$;

-- ---------------------------------------------------------------- grants

revoke execute on function public.dewfpga_subscribe(text, text, text) from public, anon, authenticated;
revoke execute on function public.dewfpga_confirm(uuid) from public, anon, authenticated;
revoke execute on function public.dewfpga_unsubscribe(uuid) from public, anon, authenticated;
revoke execute on function public.dewfpga_pending_confirmations(integer) from public, anon, authenticated;
revoke execute on function public.dewfpga_mark_confirm_sent(uuid, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.dewfpga_recipients() from public, anon, authenticated;
revoke execute on function public.dewfpga_newsletter_prune() from public, anon, authenticated;

grant execute on function public.dewfpga_subscribe(text, text, text) to anon, authenticated, service_role;
grant execute on function public.dewfpga_confirm(uuid) to anon, authenticated, service_role;
grant execute on function public.dewfpga_unsubscribe(uuid) to anon, authenticated, service_role;
grant execute on function public.dewfpga_pending_confirmations(integer) to service_role;
grant execute on function public.dewfpga_mark_confirm_sent(uuid, bigint, uuid) to service_role;
grant execute on function public.dewfpga_recipients() to service_role;
grant execute on function public.dewfpga_newsletter_prune() to service_role;
