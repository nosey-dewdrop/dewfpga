#!/usr/bin/env python3
"""Newsletter lifecycle regressions (001_dewfpga_newsletter.sql) on a private PostgreSQL.

Three bugs, each shown first with the PREVIOUS function body (LEGACY_* below, copied from the
pre-fix 001) so the check is proven to detect it, then with the shipped 001 where it passes:
  1. unsubscribe -> fresh subscribe kept unsubscribe_token (and, with 003, user_id): the old footer
     link / old account controlled consent it was never given.
  2. mark_confirm_sent(id, ledger) marked a NEWER generation (re-request after the mail was built)
     as sent although no mail carried its token; now (id, ledger, confirm_token), stale -> false.
  3. prune deleted a row 7 days after the request even when its confirmation mail (48 h link) had
     just gone out; now a mailed confirmation keeps its promised 48 hours.
Run with 001 alone and with 001+002+003. No Supabase, no network, no mail. Exit 1 on first failure."""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_harness import Cluster, SQL_DIR

PASSED = 0
CLUSTER = None


def ok(cond, what):
    global PASSED
    if not cond:
        print(f"FAIL  {what}")
        if CLUSTER and CLUSTER.last is not None:
            print("last psql stderr:", CLUSTER.last.stderr.strip()[:600])
        sys.exit(1)
    PASSED += 1
    print(f"ok    {what}")


def load(c, names):
    for n in names:
        with open(os.path.join(SQL_DIR, n), encoding="utf-8") as f:
            c.sql(f.read())


ALL = sorted(n for n in os.listdir(SQL_DIR) if n.endswith(".sql"))
BASE = [n for n in ALL if n.startswith("001_")]

# ------------------------------------------------------------ the previous bodies (for the "before" half)
LEGACY_SUBSCRIBE = """
create or replace function public.dewfpga_subscribe(p_email text, p_consent_text_version text, p_source text default 'site')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); r public.dewfpga_subscribers%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('dewfpga_subscribers:' || v_email));
  select * into r from public.dewfpga_subscribers where email = v_email;
  if not found then
    insert into public.dewfpga_subscribers (email, source, consent_text_version) values (v_email, btrim(p_source), btrim(p_consent_text_version));
    return;
  end if;
  if r.confirmed_at is not null and r.unsubscribed_at is null then return; end if;
  if r.unsubscribed_at is null and r.confirm_requested_at > now() - interval '10 minutes' then return; end if;
  update public.dewfpga_subscribers set source = btrim(p_source), consent_text_version = btrim(p_consent_text_version),
    consent_at = now(), confirm_token = gen_random_uuid(), confirm_requested_at = now(), confirm_sent_at = null,
    confirm_ledger_id = null, confirmed_at = null, unsubscribed_at = null where id = r.id;
end $$;"""

LEGACY_MARK = """
create or replace function public.dewfpga_mark_confirm_sent(p_id uuid, p_ledger_id bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.dewfpga_subscribers set confirm_sent_at = now(), confirm_ledger_id = p_ledger_id where id = p_id and confirm_sent_at is null;
  get diagnostics n = row_count; return n = 1;
end $$;
revoke execute on function public.dewfpga_mark_confirm_sent(uuid, bigint) from public, anon, authenticated;
grant execute on function public.dewfpga_mark_confirm_sent(uuid, bigint) to service_role;"""

LEGACY_PRUNE = """
create or replace function public.dewfpga_newsletter_prune()
returns table (pending_deleted integer, unsubscribed_deleted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a integer; b integer;
begin
  delete from public.dewfpga_subscribers where confirmed_at is null and unsubscribed_at is null and confirm_requested_at < now() - interval '7 days';
  get diagnostics a = row_count;
  delete from public.dewfpga_subscribers where unsubscribed_at is not null and unsubscribed_at < now() - interval '30 days';
  get diagnostics b = row_count;
  return query select a, b;
end $$;"""

CONSENT = "2026-10-03"


def subscribe(c, email, consent=CONSENT, role="anon", claims=None):
    c.sql(f"select public.dewfpga_subscribe('{email}', '{consent}')", role=role, claims=claims)


def col(c, email, expr):
    return c.value(f"select {expr} from public.dewfpga_subscribers where email = '{email}'")


def mail_and_confirm(c, email, ledger=1):
    """What the sender does: read the pending row, send, mark with (id, ledger, token); then the person clicks."""
    sid, tok = c.rows(f"select id, confirm_token from public.dewfpga_pending_confirmations(20) where email = '{email}'", role="service_role")[0]
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', {ledger}, '{tok}')", role="service_role") == "t", f"{email}: confirmation marked sent")
    ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="anon") == "t", f"{email}: confirmed with the mailed token")


# ------------------------------------------------------------ bug 1: fresh consent, fresh tokens, no inherited link
def consent_generation(c, with_account):
    e = "gen@example.org"
    c.sql(f"delete from public.dewfpga_subscribers where email = '{e}'")
    subscribe(c, e)
    mail_and_confirm(c, e, 11)
    old_unsub = col(c, e, "unsubscribe_token")
    u1 = None
    if with_account:
        u1 = str(uuid.uuid4())
        c.sql(f"insert into auth.users (id, email) values ('{u1}', 'attacker@example.org')")
        cl = '{"sub": "%s", "role": "authenticated"}' % u1
        c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl)
        ok(c.value(f"select public.dewfpga_link_subscription('{old_unsub}')", role="authenticated", claims=cl) == "t", "account A links the subscription via the footer token")
        ok(col(c, e, "user_id") == u1, "linked to A")
    ok(c.value(f"select public.dewfpga_unsubscribe('{old_unsub}')", role="anon") == "t", "unsubscribe via the footer link")
    # fresh consent (a new double opt-in; the 10-minute throttle applies only to pending rows)
    subscribe(c, e, "2026-10-04")
    new_unsub = col(c, e, "unsubscribe_token")
    return old_unsub, new_unsub, u1


def bug1_before(c, with_account):
    old_unsub, new_unsub, u1 = consent_generation(c, with_account)
    e = "gen@example.org"
    ok(old_unsub == new_unsub, "BEFORE: the old unsubscribe token survives the new consent")
    ok(c.value(f"select public.dewfpga_unsubscribe('{old_unsub}')", role="anon") == "t", "BEFORE: the old footer link cancels consent it was never part of")
    if with_account:
        ok(col(c, e, "user_id") == u1, "BEFORE: account A still owns the fresh, unconfirmed consent (export/delete_me reach it)")


def bug1_after(c, with_account):
    old_unsub, new_unsub, u1 = consent_generation(c, with_account)
    e = "gen@example.org"
    ok(old_unsub != new_unsub, "new consent rotates unsubscribe_token")
    ok(c.value(f"select public.dewfpga_unsubscribe('{old_unsub}')", role="anon") == "f", "the old footer link is dead: false, row untouched")
    ok(col(c, e, "unsubscribed_at is null and confirmed_at is null and confirm_token is not null") == "t", "fresh consent still pending, not cancelled")
    if with_account:
        ok(col(c, e, "user_id") == "", "new consent clears the account link (anonymous until re-proven)")
        cl = '{"sub": "%s", "role": "authenticated"}' % u1
        ok(c.value(f"select public.dewfpga_link_subscription('{old_unsub}')", role="authenticated", claims=cl) == "f", "A cannot re-link with the old token")
        ok(c.value("select count(*) from jsonb_array_elements(public.dewfpga_export_me() -> 'newsletter')", role="authenticated", claims=cl) == "0", "A's export no longer lists the address")
        # re-proving: confirm the NEW mail while signed in as A links it again, by token proof
        sid, tok = c.rows(f"select id, confirm_token from public.dewfpga_pending_confirmations(20) where email = '{e}'", role="service_role")[0]
        c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 12, '{tok}')", role="service_role")
        ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="authenticated", claims=cl) == "t", "A confirms the new mail while signed in")
        ok(col(c, e, "user_id") == u1, "...and the link is re-proven by the new token, not inherited")
    # the new footer token works
    ok(c.value(f"select public.dewfpga_unsubscribe('{new_unsub}')", role="anon") == "t", "the new footer link unsubscribes")
    # the pending re-request path (>10 min) rotates too: its footer token was never mailed
    c.sql(f"update public.dewfpga_subscribers set confirm_requested_at = now() - interval '11 minutes' where email = '{e}'")
    before = col(c, e, "unsubscribe_token")
    subscribe(c, e, "2026-10-05")
    ok(col(c, e, "unsubscribe_token") != before, "a re-request after the throttle is a new generation too")
    # idempotency of the migration with the fix: load 001 again on top, nothing breaks
    load(c, BASE)
    ok(True, "001 reloads over itself after the fix (idempotent)")


# ------------------------------------------------------------ bug 2: stale completion vs newer generation
def two_generations(c):
    e = "race@example.org"
    c.sql(f"delete from public.dewfpga_subscribers where email = '{e}'")
    subscribe(c, e)
    sid, t1 = c.rows(f"select id, confirm_token from public.dewfpga_pending_confirmations(20) where email = '{e}'", role="service_role")[0]
    # the sender built and sent the T1 mail; before it reports back, the person re-requests (>10 min)
    c.sql(f"update public.dewfpga_subscribers set confirm_requested_at = now() - interval '11 minutes' where email = '{e}'")
    subscribe(c, e, "2026-10-04")
    t2 = col(c, e, "confirm_token")
    ok(t1 != t2 and col(c, e, "confirm_sent_at") == "", "re-request made generation T2; T1 is no longer the row's token")
    return e, sid, t1, t2


def bug2_before(c):
    e, sid, t1, t2 = two_generations(c)
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 1)", role="service_role") == "t", "BEFORE: the stale T1 completion is accepted by id alone")
    ok(col(c, e, "confirm_sent_at is not null") == "t", "BEFORE: T2 is marked sent although no mail carried T2")
    ok(c.rows(f"select id from public.dewfpga_pending_confirmations(20) where email = '{e}'", role="service_role") == [], "BEFORE: T2 never reaches the sender again")
    ok(c.value(f"select public.dewfpga_confirm('{t1}')", role="anon") == "f", "BEFORE: the T1 link in the inbox is dead")
    ok(c.value(f"select public.dewfpga_confirm('{t2}')", role="anon") == "t", "BEFORE: only T2 would work, and nobody has it: the address can never confirm")


def bug2_after(c):
    e, sid, t1, t2 = two_generations(c)
    ok(c.fails(f"select public.dewfpga_mark_confirm_sent('{sid}', 1)", "does not exist", role="service_role"), "the 2-argument mark_confirm_sent is gone")
    ok(c.value("select count(*) from pg_proc where proname = 'dewfpga_mark_confirm_sent'") == "1", "exactly one mark_confirm_sent (uuid, bigint, uuid)")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 1, '{t1}')", role="service_role") == "f", "stale T1 completion is refused")
    ok(col(c, e, "confirm_sent_at is null and confirm_ledger_id is null") == "t", "T2 is untouched: not sent")
    pend = c.rows(f"select confirm_token from public.dewfpga_pending_confirmations(20) where email = '{e}'", role="service_role")
    ok(pend == [[t2]], "T2 stays queueable for the next confirmations run")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 2, '{t2}')", role="service_role") == "t", "T2 completion with the matching token is recorded")
    sent = col(c, e, "confirm_sent_at")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 2, '{t2}')", role="service_role") == "f", "a replayed completion is false")
    ok(col(c, e, "confirm_sent_at") == sent, "...and does not move confirm_sent_at (no expiry refresh)")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 3, '{uuid.uuid4()}')", role="service_role") == "f", "a wrong token is false")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 3, null)", role="service_role") == "f", "a null token is false")
    ok(c.value(f"select public.dewfpga_confirm('{t1}')", role="anon") == "f" and c.value(f"select public.dewfpga_confirm('{t2}')", role="anon") == "t", "T1 is dead, T2 (the mailed one) confirms")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 4, '{t2}')", role="service_role") == "f", "after confirmation nothing is markable")
    # access model for the new signature
    for role in ("anon", "authenticated"):
        ok(c.fails(f"select public.dewfpga_mark_confirm_sent('{sid}', 1, '{t2}')", "permission denied", role=role), f"{role} cannot execute mark_confirm_sent(uuid, bigint, uuid)")
    # unsubscribed row: completion refused too
    e2 = "race2@example.org"
    c.sql(f"delete from public.dewfpga_subscribers where email = '{e2}'")
    subscribe(c, e2)
    sid2, tk2 = c.rows(f"select id, confirm_token from public.dewfpga_pending_confirmations(20) where email = '{e2}'", role="service_role")[0]
    c.value(f"select public.dewfpga_unsubscribe('{col(c, e2, 'unsubscribe_token')}')", role="anon")
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid2}', 5, '{tk2}')", role="service_role") == "f", "completion for a row unsubscribed in between is refused")


# ------------------------------------------------------------ bug 3: retention keeps the promised 48 hours
def late_mail(c):
    e = "late@example.org"
    c.sql(f"delete from public.dewfpga_subscribers where email in ('{e}', 'never@example.org', 'stale@example.org')")
    subscribe(c, e)
    sid, tok = c.rows(f"select id, confirm_token from public.dewfpga_pending_confirmations(20) where email = '{e}'", role="service_role")[0]
    ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 21, '{tok}')", role="service_role") == "t", "mail sent")
    # requested 7 days + 1 h ago, the mail went out 1 hour ago (6 d 23 h after the request)
    c.sql(f"update public.dewfpga_subscribers set confirm_requested_at = now() - interval '7 days 1 hour', confirm_sent_at = now() - interval '1 hour' where email = '{e}'")
    # controls: never mailed and 8 days old -> delete; mailed 49 h ago and 9 days old -> delete
    subscribe(c, "never@example.org")
    c.sql("update public.dewfpga_subscribers set confirm_requested_at = now() - interval '8 days' where email = 'never@example.org'")
    subscribe(c, "stale@example.org")
    c.sql("update public.dewfpga_subscribers set confirm_requested_at = now() - interval '9 days', confirm_sent_at = now() - interval '49 hours' where email = 'stale@example.org'")
    return e, tok


def bug3_before(c):
    e, tok = late_mail(c)
    pr = c.rows("select * from public.dewfpga_newsletter_prune()", role="service_role")
    ok(pr[0][0] == "3", f"BEFORE: prune deletes the row whose link was mailed an hour ago: {pr}")
    ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="anon") == "f", "BEFORE: the 48-hour link in the inbox is dead after one hour")


def bug3_after(c):
    e, tok = late_mail(c)
    pr = c.rows("select * from public.dewfpga_newsletter_prune()", role="service_role")
    ok(pr[0][0] == "2", f"prune deletes the never-mailed 8-day row and the 49-hour-old mailed row, keeps the live link: {pr}")
    ok(col(c, e, "count(*)") == "1", "the row with a live 48-hour link survives day 7")
    # a replayed completion cannot stretch the window: confirm_sent_at stays
    sid = col(c, e, "id")
    c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 21, '{tok}')", role="service_role")
    ok(col(c, e, "confirm_sent_at < now() - interval '59 minutes'") == "t", "replayed completion did not refresh confirm_sent_at")
    ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="anon") == "t", "the promised link still confirms")
    # once the 48 hours are over, prune takes an unconfirmed late-mailed row
    c.sql(f"update public.dewfpga_subscribers set confirmed_at = null, confirm_token = gen_random_uuid(), confirm_sent_at = now() - interval '48 hours 1 minute' where email = '{e}'")
    pr = c.rows("select * from public.dewfpga_newsletter_prune()", role="service_role")
    ok(pr[0][0] == "1" and col(c, e, "count(*)") == "0", f"after the 48 hours the unconfirmed row is deleted: {pr}")
    # within 7 days nothing is pruned, mailed or not
    subscribe(c, "young@example.org")
    c.sql("update public.dewfpga_subscribers set confirm_requested_at = now() - interval '6 days 23 hours' where email = 'young@example.org'")
    ok(c.rows("select * from public.dewfpga_newsletter_prune()", role="service_role")[0][0] == "0", "a 6 d 23 h unmailed request is kept")


# ------------------------------------------------------------ contracts that must not move
def contracts(c):
    sigs = c.rows("""select p.proname, pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('dewfpga_subscribe','dewfpga_confirm','dewfpga_unsubscribe','dewfpga_mark_confirm_sent',
                     'dewfpga_pending_confirmations','dewfpga_recipients','dewfpga_newsletter_prune') order by 1""")
    ok(sigs == [["dewfpga_confirm", "p_token uuid"], ["dewfpga_mark_confirm_sent", "p_id uuid, p_ledger_id bigint, p_confirm_token uuid"],
                ["dewfpga_newsletter_prune", ""], ["dewfpga_pending_confirmations", "p_limit integer"], ["dewfpga_recipients", ""],
                ["dewfpga_subscribe", "p_email text, p_consent_text_version text, p_source text"], ["dewfpga_unsubscribe", "p_token uuid"]],
       f"public signatures unchanged, service signature is the 3-argument one: {sigs}")
    leaked = c.value("""select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname like 'dewfpga_%' and has_function_privilege('anon', p.oid, 'execute')
                       and p.proname not in ('dewfpga_subscribe','dewfpga_confirm','dewfpga_unsubscribe')""")
    ok(leaked == "", f"anon still executes only subscribe/confirm/unsubscribe (leaked: {leaked!r})")
    nondef = c.value("""select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname like 'dewfpga_%' and (not p.prosecdef or p.proconfig is null)""")
    ok(nondef == "", f"every dewfpga_ function is security definer with a pinned search_path (bad: {nondef!r})")


def run(names, label):
    global CLUSTER
    with_account = any(n.startswith("003_") for n in names)
    with Cluster() as c:
        CLUSTER = c
        load(c, names)
        load(c, names)
        ok(True, f"[{label}] migrations load twice (idempotent)")
        if with_account:
            ok(c.value("select confdeltype from pg_constraint where conrelid = 'public.dewfpga_subscribers'::regclass and contype = 'f' and conkey = (select array_agg(attnum) from pg_attribute where attrelid = 'public.dewfpga_subscribers'::regclass and attname = 'user_id')") == "c",
               f"[{label}] 003's user_id FK with ON DELETE CASCADE is intact (001 did not pre-create the column)")
        else:
            ok(c.value("select count(*) from pg_attribute where attrelid = 'public.dewfpga_subscribers'::regclass and attname = 'user_id' and not attisdropped") == "0",
               f"[{label}] 001 alone defines no user_id column (003 owns it)")

        print(f"--- [{label}] before: previous function bodies")
        c.sql(LEGACY_SUBSCRIBE); c.sql(LEGACY_MARK); c.sql(LEGACY_PRUNE)
        bug1_before(c, with_account)
        bug2_before(c)
        bug3_before(c)

        print(f"--- [{label}] after: shipped 001 reapplied")
        c.sql("drop function if exists public.dewfpga_mark_confirm_sent(uuid, bigint, uuid)")  # so the 3-arg create is exercised from scratch
        load(c, names)
        bug1_after(c, with_account)
        bug2_after(c)
        bug3_after(c)
        contracts(c)


def main():
    run(BASE, "001 alone")
    run(ALL, "+".join(n[:3] for n in ALL))
    print(f"\npassed {PASSED}, failed 0")


if __name__ == "__main__":
    main()
