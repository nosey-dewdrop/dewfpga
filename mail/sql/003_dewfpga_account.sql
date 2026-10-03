-- dewfpga #26: an account behind a Supabase Auth magic link, "premium coming soon", and the rights
-- table on the account page (enrol, export, delete, link a newsletter subscription).
--
-- SCOPE (the independent review of the first draft found it reaching outside dewfpga; this file is
-- the corrected contract):
--   * Supabase Auth identities (auth.users) are SHARED by every app in the project. The SQL functions
--     here never directly create, change or delete those identities. Normal Auth-managed signup
--     does create a sign-in identity for new users. There is NO dewfpga trigger on auth.users: a person becomes a
--     dewfpga account only by calling dewfpga_enrol_me() while signed in (explicit enrolment, which
--     also works for identities that existed before this migration ran).
--   * dewfpga_delete_me() removes dewfpga-owned rows only: the profile and the newsletter
--     subscriptions LINKED to it. It does not delete the shared identity; deleting that (and so every
--     other app's data hanging off it) is a separate operator process, not reachable from here.
--     A second app's FKs to auth.users (CASCADE or RESTRICT) therefore neither lose data nor block us.
--   * A newsletter subscription is matched to an account only by TOKEN PROOF, never by the session's
--     email claim: either dewfpga_confirm(token) was called while signed in and enrolled (the
--     confirmation token proves the mailbox, the session proves the account), or
--     dewfpga_link_subscription(unsubscribe_token) was called from a mail's manage link while signed
--     in. In a shared project the email claim of a session is only as strong as the weakest sign-up
--     path configured for the whole project (autoconfirm, admin-created users), so it is treated as
--     display text, not as authorisation. Subscriptions made anonymously are not in the export and are
--     not erased by delete_me; the page says so and points to the per-mail unsubscribe link.
--
-- Existing CLI, templates, docs and simulator entry points do not depend on the account layer;
-- optional account pages use scoped RPCs. premium_since is a column nobody can set yet: there is no
-- UPDATE grant for authenticated at all, and no function sets it. When premium exists it will be set
-- by a service_role path, not from the browser.
--
-- Requires the auth schema of a Supabase project (auth.users, auth.uid(), auth.email()). The test
-- harness stubs these three on a private PostgreSQL. Apply after 001 and 002: this file replaces
-- 001's dewfpga_confirm with the linking version (identical for anonymous callers).

create table if not exists public.dewfpga_profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  premium_since  timestamptz
);

alter table public.dewfpga_profiles enable row level security;
revoke all on table public.dewfpga_profiles from public, anon, authenticated;
-- column-level: a signed-in user may read these three columns of their own row (policy below), nothing else
grant select (user_id, created_at, premium_since) on table public.dewfpga_profiles to authenticated;
grant select, insert, update, delete on table public.dewfpga_profiles to service_role;

drop policy if exists dewfpga_profiles_self_select on public.dewfpga_profiles;
create policy dewfpga_profiles_self_select on public.dewfpga_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

-- The first draft had a trigger here. It is removed on purpose; drop it if it was ever applied.
drop trigger if exists dewfpga_profile_on_signup on auth.users;
drop function if exists public.dewfpga_profile_on_signup();

-- A subscription linked to a dewfpga account (token-proven, see header). Goes with the account.
alter table public.dewfpga_subscribers
  add column if not exists user_id uuid references public.dewfpga_profiles (user_id) on delete cascade;
create index if not exists dewfpga_subscribers_user_id on public.dewfpga_subscribers (user_id);

-- ---------------------------------------------------------------- explicit enrolment

-- Called by the account page's "create my dewfpga account" button. Idempotent. Returns the profile.
create or replace function public.dewfpga_enrol_me()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); n integer; p public.dewfpga_profiles%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = 'insufficient_privilege'; end if;
  insert into public.dewfpga_profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  select * into p from public.dewfpga_profiles where user_id = v_uid;
  return jsonb_build_object('user_id', p.user_id, 'created_at', p.created_at, 'premium_since', p.premium_since, 'created', n = 1);
end $$;

-- ---------------------------------------------------------------- linking a subscription

-- Replaces 001's dewfpga_confirm. Same contract for anonymous callers (true once per token, within
-- 48 hours of the mail being sent, creates no account). When the caller is signed in AND enrolled,
-- the confirmed subscription is linked to that account.
create or replace function public.dewfpga_confirm(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
  v_uid uuid := auth.uid();
  v_link boolean := v_uid is not null and exists (select 1 from public.dewfpga_profiles where user_id = v_uid);
begin
  if p_token is null then return false; end if;
  update public.dewfpga_subscribers set
    confirmed_at = now(),
    confirm_token = null,
    user_id = case when v_link then v_uid else user_id end
  where confirm_token = p_token
    and confirmed_at is null
    and confirm_sent_at is not null
    and now() < confirm_sent_at + interval '48 hours';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- From a mail's manage/unsubscribe link, while signed in and enrolled: link that subscription to the
-- account (so it appears in the export and goes with delete_me). Possession of the unsubscribe token
-- is the proof; the email claim plays no part. Re-linking moves it to the calling account.
create or replace function public.dewfpga_link_subscription(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.dewfpga_profiles where user_id = v_uid) then
    raise exception 'not enrolled' using errcode = 'insufficient_privilege';
  end if;
  if p_token is null then return false; end if;
  update public.dewfpga_subscribers set user_id = v_uid
  where unsubscribe_token = p_token and unsubscribed_at is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------- rights table

-- "access / portability": everything dewfpga holds about the signed-in person, as JSON.
-- account: the profile or null (not enrolled). signed_in_email: the session's claim, display only.
-- newsletter: the LINKED subscriptions (token-proven); tokens are not exported.
create or replace function public.dewfpga_export_me()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'signed_in_email', auth.email(),
    'account', (select jsonb_build_object('user_id', p.user_id, 'created_at', p.created_at, 'premium_since', p.premium_since)
                from public.dewfpga_profiles p where p.user_id = v_uid),
    'newsletter', coalesce((select jsonb_agg(jsonb_build_object(
                     'email', s.email, 'source', s.source, 'consent_text_version', s.consent_text_version,
                     'consent_at', s.consent_at, 'confirmed_at', s.confirmed_at, 'unsubscribed_at', s.unsubscribed_at,
                     'created_at', s.created_at) order by s.created_at)
                   from public.dewfpga_subscribers s where s.user_id = v_uid), '[]'::jsonb),
    'newsletter_note', 'Only subscriptions linked to this account by a confirmation or manage link are listed. '
                       'A subscription made without signing in is not linked and is not shown or erased here; '
                       'use the unsubscribe link in any newsletter mail.');
end $$;

-- "erasure" of dewfpga-owned data: the linked subscriptions and the profile. Returns true when a
-- profile was deleted. Does NOT touch auth.users (shared identity; see header).
create or replace function public.dewfpga_delete_me()
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = 'insufficient_privilege'; end if;
  delete from public.dewfpga_subscribers where user_id = v_uid;
  delete from public.dewfpga_profiles where user_id = v_uid;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------- grants

revoke execute on function public.dewfpga_enrol_me() from public, anon;
revoke execute on function public.dewfpga_confirm(uuid) from public, anon, authenticated;
revoke execute on function public.dewfpga_link_subscription(uuid) from public, anon;
revoke execute on function public.dewfpga_export_me() from public, anon;
revoke execute on function public.dewfpga_delete_me() from public, anon;
grant execute on function public.dewfpga_enrol_me() to authenticated, service_role;
grant execute on function public.dewfpga_confirm(uuid) to anon, authenticated, service_role;
grant execute on function public.dewfpga_link_subscription(uuid) to authenticated, service_role;
grant execute on function public.dewfpga_export_me() to authenticated, service_role;
grant execute on function public.dewfpga_delete_me() to authenticated, service_role;
