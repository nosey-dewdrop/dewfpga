-- dewfpga #24/#25: dewfpga's OWN mail allocation, the send ledger and the owner-test gate.
--
-- Scope. This bounds only the mail this repo sends (mail/dewfpga_mail.py, consumer 'dewfpga'). The
-- Resend account may also carry dewsletter's mail and, if Auth's custom SMTP points at it, Supabase
-- Auth's magic links; neither can be made to reserve here, so this ledger does not pretend to bound
-- them and makes no claim about what is left for Auth. The operator gives dewfpga an explicit share
-- (daily_cap, monthly_cap) that leaves the other senders theirs; the effective cap is the smaller of
-- that share and the provider plan minus an inbound slice (dewfpga_mail_limits). An account-wide usage
-- preflight against the provider is a separate, later step outside this file.
--
--   dewfpga_mail_consumers   one row per sender that reserves here. enrolled_at null (never enrolled or
--                            revoked) => no sends. daily_cap or monthly_cap null => no own allocation
--                            => no sends (fail closed).
--   dewfpga_mail_ledger      one row per provider idempotency key, reserved before the provider is
--                            called and settled after. The key is bound to the exact payload hash and
--                            to its logical mail (logical_key; derived keys ':r2', ':r3' share it).
--                            No address is stored, only a sha256 of it.
--   dewfpga_mail_approvals   the #25 gate: a campaign for content X needs the latest sent owner test of
--                            X, a receipt note (provider acceptance is not inbox delivery) and an
--                            unsubscribe measured from that test (or a written attestation).
--
-- Status: reserved = a claim holds the row; sent = provider accepted with a message id; failed = a
-- definite refusal (429) that still counts; released = a validation refusal, not counted; unknown =
-- the provider MAY have accepted. `uncertain` is sticky: once any claim of a row may have reached the
-- provider without a definite answer (unknown, or a claim abandoned past its lease), a later refusal
-- under that key settles `unknown`, not failed/released, and no new key of the same logical mail is
-- minted until the operator resolves it (dewfpga_mail_resolve) or a definite acceptance arrives.
--
-- Counting (rolling 24 h / 30 days): reserved and unknown rows always count (their acceptance may
-- still happen inside the provider's window); settled rows count until 24 h / 30 days after their
-- LATEST activity (created, last claim, settlement), so a mail first tried at 0 h and accepted on a
-- retry at 19 h still counts at 25 h. Released rows do not count. Nothing slides a row out early.
--
-- Fencing: every claim gets a fresh claim_token. Only the current claim may move its row out of
-- reserved; a stale claim's refusal changes nothing (a stale 'unknown' only marks the row uncertain),
-- a stale or concurrent definite acceptance (sent + message id) always converges the row to sent.
-- What the provider does with a repeated Idempotency-Key is documented provider behaviour, modelled in
-- the tests, never live evidence; nothing here is exactly-once delivery. All functions: service_role.

drop function if exists public.dewfpga_mail_budget();
drop function if exists public.dewfpga_mail_budget(text);
drop function if exists public.dewfpga_mail_reserve(text, text, text, text, text, text);
drop function if exists public.dewfpga_mail_reserve(text, text, text, text, text, text, text);
drop function if exists public.dewfpga_mail_lookup(text);
drop function if exists public.dewfpga_mail_settle(bigint, text, text);
drop function if exists public.dewfpga_mail_settle(bigint, uuid, text, text);
drop function if exists public.dewfpga_mail_approve(text, text);
drop function if exists public.dewfpga_mail_approve(text, text, text);
drop function if exists public.dewfpga_mail_campaign_gate(text);

create table if not exists public.dewfpga_mail_consumers (
  name           text primary key check (name ~ '^[a-z_]{1,40}$'),
  enrolled_at    timestamptz,                                -- null: not enrolled or revoked
  daily_cap      integer check (daily_cap >= 0),             -- this consumer's own share; null = closed
  monthly_cap    integer check (monthly_cap >= 0),
  note           text
);
alter table public.dewfpga_mail_consumers drop column if exists required;
alter table public.dewfpga_mail_consumers drop column if exists daily_reserve;
alter table public.dewfpga_mail_consumers add column if not exists monthly_cap integer check (monthly_cap >= 0);

insert into public.dewfpga_mail_consumers (name, note) values
  ('dewfpga', 'this repo, mail/dewfpga_mail.py; reserves every mail here. Enrol with daily_cap and monthly_cap = the share of the Resend account the operator gives dewfpga, leaving dewsletter and Auth mail theirs.')
on conflict (name) do nothing;

create table if not exists public.dewfpga_mail_ledger (
  id               bigint generated always as identity primary key,
  consumer         text not null references public.dewfpga_mail_consumers (name),
  kind             text not null check (kind in ('confirm', 'owner_test', 'campaign', 'bulletin', 'invite', 'other')),
  recipient_hash   text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key  text not null unique check (length(idempotency_key) between 1 and 256),
  payload_hash     text not null check (payload_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the exact request body
  content_hash     text check (content_hash ~ '^[0-9a-f]{64}$'),           -- #25: the patch-notes entry
  message_id       text,
  status           text not null default 'reserved' check (status in ('reserved', 'sent', 'failed', 'released', 'unknown')),
  attempts         integer not null default 0 check (attempts >= 0),      -- claims handed to a sender
  created_at       timestamptz not null default now(),
  first_attempt_at timestamptz not null default now(),                    -- same-key window start; never moved
  last_attempt_at  timestamptz,                                           -- lease: a claim younger than this is in flight
  settled_at       timestamptz,
  note             text                                                    -- operator resolution note
);
alter table public.dewfpga_mail_ledger add column if not exists logical_key text;
alter table public.dewfpga_mail_ledger add column if not exists uncertain boolean not null default false;
alter table public.dewfpga_mail_ledger add column if not exists claim_token uuid;
update public.dewfpga_mail_ledger set logical_key = regexp_replace(idempotency_key, ':r[0-9]+$', '') where logical_key is null;
update public.dewfpga_mail_ledger set uncertain = true where status = 'unknown' and not uncertain;
alter table public.dewfpga_mail_ledger alter column logical_key set not null;
create index if not exists dewfpga_mail_ledger_created_at on public.dewfpga_mail_ledger (created_at);
create index if not exists dewfpga_mail_ledger_logical_key on public.dewfpga_mail_ledger (logical_key);

-- other senders were seeded as required by an earlier version of this file; they are not part of it.
-- Only an UNCONFIGURED seed goes (never enrolled, no share, no ledger row). A row the operator set up by
-- hand (e.g. 'dewsletter' with its own share and no ledger row yet) is theirs and survives a re-apply.
delete from public.dewfpga_mail_consumers c
  where c.name <> 'dewfpga' and c.enrolled_at is null and c.daily_cap is null and c.monthly_cap is null
    and not exists (select 1 from public.dewfpga_mail_ledger l where l.consumer = c.name);

create table if not exists public.dewfpga_mail_approvals (
  content_hash          text primary key check (content_hash ~ '^[0-9a-f]{64}$'),
  owner_test_ledger_id  bigint not null references public.dewfpga_mail_ledger (id),
  approved_at           timestamptz not null default now(),
  note                  text
);
alter table public.dewfpga_mail_approvals add column if not exists owner_recipient_hash text;
alter table public.dewfpga_mail_approvals add column if not exists receipt_note text;
alter table public.dewfpga_mail_approvals add column if not exists unsubscribe_method text check (unsubscribe_method in ('measured', 'attested'));
alter table public.dewfpga_mail_approvals add column if not exists unsubscribe_evidence text;
alter table public.dewfpga_mail_approvals add column if not exists unsubscribe_at timestamptz;

alter table public.dewfpga_mail_consumers enable row level security;
alter table public.dewfpga_mail_ledger enable row level security;
alter table public.dewfpga_mail_approvals enable row level security;
revoke all on table public.dewfpga_mail_consumers, public.dewfpga_mail_ledger, public.dewfpga_mail_approvals
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dewfpga_mail_consumers, public.dewfpga_mail_ledger, public.dewfpga_mail_approvals
  to service_role;
-- Existing Supabase projects grant anon/authenticated ALL on every new sequence in public by default
-- (ALTER DEFAULT PRIVILEGES), so the ledger's identity sequence would leak the send count (last_value)
-- and take nextval(). The identity column draws its ids as the table owner: service_role's insert
-- needs no sequence grant, and the sequence name is read from the catalogue, not assumed.
do $$
declare s text := pg_get_serial_sequence('public.dewfpga_mail_ledger', 'id');
begin
  if s is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', s);
  end if;
end $$;

-- The constants, in one place. Provider numbers: Resend free plan (resend.com/pricing, 2026-10-03).
-- inbound_reserve: Resend counts received mail against the same quota; a slice is kept for it.
-- reuse_window: same-key retries only this long after the first attempt (provider store: 24 h).
create or replace function public.dewfpga_mail_limits()
returns table (provider_day integer, provider_month integer, inbound_reserve_day integer, inbound_reserve_month integer,
               day_cap integer, month_cap integer, reuse_window interval, lease interval, max_claims integer)
language sql immutable security definer set search_path = public, pg_temp as $$
  select 100, 3000, 5, 100, 100 - 5, 3000 - 100, interval '20 hours', interval '5 minutes', 3;
$$;

-- One consumer's allocation as the gate sees it now. Also what `dewfpga_mail.py status` prints.
create or replace function public.dewfpga_mail_budget(p_consumer text default 'dewfpga')
returns table (consumer text, day_used bigint, day_cap integer, day_left bigint,
               month_used bigint, month_cap integer, month_left bigint, blocked text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  c public.dewfpga_mail_consumers%rowtype;
  lim record;
  d bigint;
  m bigint;
  dc integer;
  mc integer;
  why text;
begin
  select * into lim from public.dewfpga_mail_limits();
  select * into c from public.dewfpga_mail_consumers x where x.name = p_consumer;
  if not found or c.enrolled_at is null then
    why := 'not enrolled (or revoked)';
  elsif c.daily_cap is null or c.monthly_cap is null then
    why := 'no own allocation: daily_cap and monthly_cap must both be set';
  end if;
  select count(*) filter (where l.status in ('reserved', 'unknown')
                           or greatest(l.created_at, l.last_attempt_at, l.settled_at) > now() - interval '24 hours'),
         count(*) filter (where l.status in ('reserved', 'unknown')
                           or greatest(l.created_at, l.last_attempt_at, l.settled_at) > now() - interval '30 days')
    into d, m
    from public.dewfpga_mail_ledger l where l.consumer = p_consumer and l.status <> 'released';
  dc := least(coalesce(c.daily_cap, 0), lim.day_cap);
  mc := least(coalesce(c.monthly_cap, 0), lim.month_cap);
  return query select p_consumer, d, dc, dc - d, m, mc, mc - m, why;
end $$;

-- Reserve one key of a logical mail, or re-claim its incomplete row.
--
-- Raises on an identity mismatch (same key or logical key, different consumer/recipient/payload/
-- content), when the consumer is not enrolled, revoked or has no own allocation, or when its
-- allocation is spent. Returns one row with action:
--   send        make provider calls with exactly this key and claim_token, only until seconds_left
--   sent        this mail (this key or a sibling key) is settled sent: nothing to do
--   spent       this key is failed/released, or the logical mail used max_claims keys: no call
--   in_flight   another claim on this row is younger than the lease: no call, re-read later
--   unresolved  this row, or an earlier key of the same logical mail, is uncertain or outside the
--               same-key window or claim bound: NO provider call, NO new key; operator reconciles
-- Every claim passes the gates again; a reused row is already counted and is not counted twice.
create or replace function public.dewfpga_mail_reserve(p_consumer text, p_kind text, p_idempotency_key text,
                                                       p_recipient_hash text, p_payload_hash text,
                                                       p_content_hash text default null,
                                                       p_logical_key text default null)
returns table (ledger_id bigint, status text, message_id text, reused boolean, action text,
               attempts integer, first_attempt_at timestamptz, age_seconds bigint, seconds_left bigint,
               claim_token uuid, uncertain boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  r public.dewfpga_mail_ledger%rowtype;
  s public.dewfpga_mail_ledger%rowtype;
  b record;
  lim record;
  v_logical text := coalesce(p_logical_key, p_idempotency_key);
  v_action text;
  v_reason text;
  v_reused boolean := true;
  self_counted integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('dewfpga_mail_ledger'));
  select * into lim from public.dewfpga_mail_limits();

  <<decide>>
  begin
    select * into r from public.dewfpga_mail_ledger l where l.idempotency_key = p_idempotency_key;
    if found then
      if r.consumer is distinct from p_consumer or r.recipient_hash is distinct from p_recipient_hash
         or r.payload_hash is distinct from p_payload_hash or r.content_hash is distinct from p_content_hash
         or r.logical_key is distinct from v_logical then
        raise exception 'idempotency key % was used for a different mail (identity mismatch)', p_idempotency_key using errcode = 'unique_violation';
      end if;
      if r.status = 'sent' then v_action := 'sent'; exit decide; end if;
      if r.status in ('failed', 'released') then
        v_action := 'spent'; v_reason := 'key settled ' || r.status; exit decide;
      end if;
      self_counted := 1;   -- reserved/unknown rows always count
    else
      -- a new key of a logical mail: only when every earlier key is a proven-safe refusal
      if exists (select 1 from public.dewfpga_mail_ledger l where l.logical_key = v_logical
                 and (l.consumer is distinct from p_consumer or l.recipient_hash is distinct from p_recipient_hash
                      or l.payload_hash is distinct from p_payload_hash or l.content_hash is distinct from p_content_hash)) then
        raise exception 'logical mail % was used for a different mail (identity mismatch)', v_logical using errcode = 'unique_violation';
      end if;
      select * into s from public.dewfpga_mail_ledger l where l.logical_key = v_logical and l.status = 'sent' order by l.id limit 1;
      if found then r := s; v_action := 'sent'; v_reason := 'sent under key ' || s.idempotency_key; exit decide; end if;
      select * into s from public.dewfpga_mail_ledger l where l.logical_key = v_logical
        and (l.status in ('reserved', 'unknown') or l.uncertain) order by l.id limit 1;
      if found then
        r := s; v_action := 'unresolved';
        v_reason := 'an earlier attempt of this mail (key ' || s.idempotency_key || ') is uncertain; no new key until it is resolved';
        exit decide;
      end if;
      select * into s from public.dewfpga_mail_ledger l where l.logical_key = v_logical and l.status = 'released' order by l.id limit 1;
      if found then r := s; v_action := 'spent'; v_reason := 'released under key ' || s.idempotency_key; exit decide; end if;
      if (select count(*) from public.dewfpga_mail_ledger l where l.logical_key = v_logical) >= lim.max_claims then
        select * into r from public.dewfpga_mail_ledger l where l.logical_key = v_logical order by l.id desc limit 1;
        v_action := 'spent'; v_reason := 'logical mail used ' || lim.max_claims || ' keys'; exit decide;
      end if;
    end if;

    -- gates: for a new row and for every re-claim (revocation stops a re-claim too)
    select * into b from public.dewfpga_mail_budget(p_consumer);
    if b.blocked is not null then
      raise exception 'mail budget closed for consumer %: %', coalesce(p_consumer, '(null)'), b.blocked using errcode = 'insufficient_privilege';
    end if;
    if b.day_left + self_counted <= 0 then
      raise exception 'daily mail budget spent for % (% of %)', p_consumer, b.day_used, b.day_cap using errcode = 'program_limit_exceeded';
    end if;
    if b.month_left + self_counted <= 0 then
      raise exception 'monthly mail budget spent for % (% of %)', p_consumer, b.month_used, b.month_cap using errcode = 'program_limit_exceeded';
    end if;

    if r.id is not null then
      if now() - r.first_attempt_at > lim.reuse_window then
        v_action := 'unresolved';
        v_reason := 'same-key window of ' || lim.reuse_window::text || ' passed; operator reconciliation';
        exit decide;
      end if;
      if r.attempts >= lim.max_claims then
        v_action := 'unresolved';
        v_reason := 'claim bound of ' || lim.max_claims || ' reached; operator reconciliation';
        exit decide;
      end if;
      if r.status = 'reserved' and r.last_attempt_at is not null and r.last_attempt_at > now() - lim.lease then
        v_action := 'in_flight';
        v_reason := 'another claim is younger than the lease of ' || lim.lease::text;
        exit decide;
      end if;
      -- an abandoned claim (reserved past its lease) may have reached the provider: the row is uncertain
      update public.dewfpga_mail_ledger l set status = 'reserved', attempts = l.attempts + 1, last_attempt_at = now(),
             claim_token = gen_random_uuid(), uncertain = l.uncertain or l.status = 'reserved'
        where l.id = r.id returning * into r;
      v_action := 'send';
      exit decide;
    end if;

    insert into public.dewfpga_mail_ledger (consumer, kind, recipient_hash, idempotency_key, logical_key, payload_hash,
                                            content_hash, attempts, last_attempt_at, claim_token)
      values (p_consumer, p_kind, p_recipient_hash, p_idempotency_key, v_logical, p_payload_hash,
              p_content_hash, 1, now(), gen_random_uuid())
      returning * into r;
    v_action := 'send';
    v_reused := false;
  end;

  return query select r.id, r.status, r.message_id, v_reused, v_action, r.attempts, r.first_attempt_at,
                      extract(epoch from now() - r.first_attempt_at)::bigint,
                      greatest(0, extract(epoch from r.first_attempt_at + lim.reuse_window - now()))::bigint,
                      case when v_action = 'send' then r.claim_token end, r.uncertain, v_reason;
end $$;

-- Read one row by key.
create or replace function public.dewfpga_mail_lookup(p_idempotency_key text)
returns table (ledger_id bigint, status text, message_id text, attempts integer, first_attempt_at timestamptz,
               last_attempt_at timestamptz, settled_at timestamptz, uncertain boolean, logical_key text)
language sql security definer set search_path = public, pg_temp as $$
  select id, status, message_id, attempts, first_attempt_at, last_attempt_at, settled_at, uncertain, logical_key
  from public.dewfpga_mail_ledger where idempotency_key = p_idempotency_key;
$$;

-- After the provider answered one claim. Returns what the row says afterwards; the caller reports
-- that, never its own guess.
--   sent + message id   converges the row to sent from any other status, whatever claim it comes
--                       from: a definite acceptance is evidence (late or concurrent claims included)
--   current claim       (token matches, row reserved): failed/released become unknown when the row is
--                       uncertain; unknown marks it uncertain
--   stale claim         changes nothing (applied false); a stale 'unknown' only marks the row
--                       uncertain (and reopens a failed/released row as unknown)
create or replace function public.dewfpga_mail_settle(p_ledger_id bigint, p_claim_token uuid, p_status text,
                                                      p_message_id text default null)
returns table (applied boolean, status text, uncertain boolean, message_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  r public.dewfpga_mail_ledger%rowtype;
  v text;
begin
  if p_status is null or p_status not in ('sent', 'failed', 'released', 'unknown') then
    raise exception 'status must be sent, failed, released or unknown' using errcode = 'check_violation';
  end if;
  if p_status = 'sent' and (p_message_id is null or p_message_id = '') then
    raise exception 'sent needs the provider message id' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('dewfpga_mail_ledger'));
  select * into r from public.dewfpga_mail_ledger l where l.id = p_ledger_id for update;
  if not found then
    return query select false, null::text, null::boolean, null::text;
    return;
  end if;
  if p_status = 'sent' then
    if r.status = 'sent' then
      return query select false, r.status, r.uncertain, r.message_id;
      return;
    end if;
    update public.dewfpga_mail_ledger l set status = 'sent', message_id = p_message_id, settled_at = now()
      where l.id = r.id returning * into r;
    return query select true, r.status, r.uncertain, r.message_id;
    return;
  end if;
  if r.claim_token is distinct from p_claim_token or r.status <> 'reserved' then
    if p_status = 'unknown' and r.status <> 'sent' then
      update public.dewfpga_mail_ledger l set uncertain = true,
             status = case when l.status in ('failed', 'released') then 'unknown' else l.status end
        where l.id = r.id returning * into r;
    end if;
    return query select false, r.status, r.uncertain, r.message_id;
    return;
  end if;
  v := case when r.uncertain and p_status in ('failed', 'released') then 'unknown' else p_status end;
  update public.dewfpga_mail_ledger l set status = v, uncertain = l.uncertain or v = 'unknown',
         message_id = coalesce(p_message_id, l.message_id), settled_at = now()
    where l.id = r.id returning * into r;
  return query select true, r.status, r.uncertain, r.message_id;
end $$;

-- Operator reconciliation of an unknown/aged row after checking the provider's log by key.
-- sent: the provider shows the message (give its id). failed: the provider shows no such request;
-- the row keeps counting and is no longer uncertain, so a new key of the mail may pass the gates.
create or replace function public.dewfpga_mail_resolve(p_ledger_id bigint, p_status text, p_note text, p_message_id text default null)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'resolve to sent or failed only' using errcode = 'check_violation';
  end if;
  if p_note is null or length(trim(p_note)) < 8 then
    raise exception 'resolve needs a note saying what was checked' using errcode = 'check_violation';
  end if;
  if p_status = 'sent' and (p_message_id is null or p_message_id = '') then
    raise exception 'sent needs the provider message id' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('dewfpga_mail_ledger'));
  update public.dewfpga_mail_ledger set status = p_status, message_id = coalesce(p_message_id, message_id),
         settled_at = now(), note = p_note, uncertain = false, claim_token = null
    where id = p_ledger_id and status in ('reserved', 'unknown');
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- #25 gate, step 1: the owner approves the latest sent owner test of a content.
-- p_receipt_note: what the owner saw in the inbox (the provider's acceptance is not delivery).
-- Unsubscribe: measured when the owner's address unsubscribed (dewfpga_subscribers, 001) after that
-- owner test was first tried; otherwise p_unsubscribe_attestation, a written statement of the manual
-- check. Neither => refused.
create or replace function public.dewfpga_mail_approve(p_content_hash text, p_receipt_note text,
                                                       p_unsubscribe_attestation text default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.dewfpga_mail_ledger%rowtype;
  v_at timestamptz;
  v_method text;
  v_evidence text;
begin
  select * into r from public.dewfpga_mail_ledger
    where kind = 'owner_test' and content_hash = p_content_hash and status = 'sent'
    order by id desc limit 1;
  if not found then
    raise exception 'no sent owner-test mail for content %', p_content_hash using errcode = 'no_data_found';
  end if;
  if p_receipt_note is null or length(trim(p_receipt_note)) < 8 then
    raise exception 'approve needs a receipt note: what arrived in the inbox (provider acceptance is not delivery)' using errcode = 'check_violation';
  end if;
  select max(s.unsubscribed_at) into v_at from public.dewfpga_subscribers s
    where encode(sha256(convert_to(lower(btrim(s.email)), 'UTF8')), 'hex') = r.recipient_hash
      and s.unsubscribed_at >= r.first_attempt_at;
  if v_at is not null then
    v_method := 'measured';
    v_evidence := 'dewfpga_subscribers.unsubscribed_at after owner test ' || r.id;
  elsif p_unsubscribe_attestation is not null and length(trim(p_unsubscribe_attestation)) >= 8 then
    v_method := 'attested';
    v_evidence := p_unsubscribe_attestation;
  else
    raise exception 'unsubscribe not measured for owner test %: use its unsubscribe link first, or attest the manual check', r.id using errcode = 'check_violation';
  end if;
  insert into public.dewfpga_mail_approvals (content_hash, owner_test_ledger_id, note, owner_recipient_hash, receipt_note,
                                             unsubscribe_method, unsubscribe_evidence, unsubscribe_at)
    values (p_content_hash, r.id, p_receipt_note, r.recipient_hash, p_receipt_note, v_method, v_evidence, v_at)
    on conflict (content_hash) do update set owner_test_ledger_id = excluded.owner_test_ledger_id, approved_at = now(),
      note = excluded.note, owner_recipient_hash = excluded.owner_recipient_hash, receipt_note = excluded.receipt_note,
      unsubscribe_method = excluded.unsubscribe_method, unsubscribe_evidence = excluded.unsubscribe_evidence,
      unsubscribe_at = excluded.unsubscribe_at;
  return r.id;
end $$;

-- #25 gate, step 2: may a campaign with this content go out? Raises if not; returns the approval.
-- The approval must name the LATEST owner test of the content (a newer one, sent or still open,
-- supersedes it), carry a receipt and an unsubscribe check, and be younger than 14 days.
create or replace function public.dewfpga_mail_campaign_gate(p_content_hash text)
returns table (owner_test_ledger_id bigint, owner_test_sent_at timestamptz, approved_at timestamptz, unsubscribe_method text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
    select a.owner_test_ledger_id, l.settled_at, a.approved_at, a.unsubscribe_method
    from public.dewfpga_mail_approvals a
    join public.dewfpga_mail_ledger l on l.id = a.owner_test_ledger_id
    where a.content_hash = p_content_hash and l.kind = 'owner_test' and l.status = 'sent'
      and l.content_hash = p_content_hash and a.approved_at > now() - interval '14 days'
      and a.receipt_note is not null and a.unsubscribe_method is not null
      and l.recipient_hash = a.owner_recipient_hash
      and l.id = (select max(o.id) from public.dewfpga_mail_ledger o
                  where o.kind = 'owner_test' and o.content_hash = p_content_hash and o.status <> 'released');
  if not found then
    raise exception 'campaign gate closed for content %: send the owner test, read it, check unsubscribe, approve it', p_content_hash using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke execute on function public.dewfpga_mail_limits() from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_budget(text) from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_reserve(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_lookup(text) from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_settle(bigint, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_resolve(bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_approve(text, text, text) from public, anon, authenticated;
revoke execute on function public.dewfpga_mail_campaign_gate(text) from public, anon, authenticated;
grant execute on function public.dewfpga_mail_limits() to service_role;
grant execute on function public.dewfpga_mail_budget(text) to service_role;
grant execute on function public.dewfpga_mail_reserve(text, text, text, text, text, text, text) to service_role;
grant execute on function public.dewfpga_mail_lookup(text) to service_role;
grant execute on function public.dewfpga_mail_settle(bigint, uuid, text, text) to service_role;
grant execute on function public.dewfpga_mail_resolve(bigint, text, text, text) to service_role;
grant execute on function public.dewfpga_mail_approve(text, text, text) to service_role;
grant execute on function public.dewfpga_mail_campaign_gate(text) to service_role;
