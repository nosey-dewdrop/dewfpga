#!/usr/bin/env python3
"""mail/sql on a private PostgreSQL: access model, double opt-in, dewfpga's own mail allocation, the account.

Runs the three migrations twice (idempotent), then every check below as the role PostgREST would use.
No Supabase project, no network, no mail. Exit 1 on the first failure."""
import concurrent.futures, hashlib, json, os, subprocess, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_harness import Cluster

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


H = "a" * 64  # a recipient/content hash shape
P = "e" * 64  # a payload hash shape


def sha(email):
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()


def main():
    global CLUSTER
    with Cluster() as c:
        CLUSTER = c
        c.load_migrations()
        c.load_migrations()
        ok(True, "migrations load twice without error (idempotent)")

        # ---------------------------------------------------------------- access model
        anon_sel = c.run("select * from public.dewfpga_subscribers", role="anon")
        ok(anon_sel.returncode != 0 and "permission denied" in anon_sel.stderr, "anon cannot select dewfpga_subscribers")
        ok(c.fails("select * from public.dewfpga_subscribers", "permission denied", role="authenticated"), "authenticated cannot select dewfpga_subscribers")
        ok(c.fails("insert into public.dewfpga_subscribers (email, consent_text_version) values ('x@y.zz','v1')", "permission denied", role="anon"), "anon cannot insert dewfpga_subscribers")
        for fn in ["dewfpga_pending_confirmations()", "dewfpga_recipients()", "dewfpga_newsletter_prune()",
                   "dewfpga_mark_confirm_sent(gen_random_uuid(), 1, gen_random_uuid())", "dewfpga_mail_limits()", "dewfpga_mail_budget()",
                   f"dewfpga_mail_reserve('dewfpga','confirm','k','{H}','{P}')", "dewfpga_mail_lookup('k')",
                   "dewfpga_mail_settle(1, gen_random_uuid(), 'sent', 'm')", "dewfpga_mail_resolve(1, 'failed', 'checked the log')",
                   f"dewfpga_mail_approve('{H}', 'arrived in inbox')", f"dewfpga_mail_campaign_gate('{H}')"]:
            ok(c.fails(f"select * from public.{fn}", "permission denied", role="anon"), f"anon cannot execute {fn}")
            ok(c.fails(f"select * from public.{fn}", "permission denied", role="authenticated"), f"authenticated cannot execute {fn}")
        for t in ["dewfpga_mail_ledger", "dewfpga_mail_consumers", "dewfpga_mail_approvals"]:
            ok(c.fails(f"select * from public.{t}", "permission denied", role="anon"), f"anon cannot select {t}")
        # RLS is on with no policy: even a role with a direct grant would see nothing
        ok(c.value("select relrowsecurity from pg_class where relname = 'dewfpga_subscribers'") == "t", "RLS enabled on dewfpga_subscribers")
        ok(c.value("select count(*) from pg_policies where tablename = 'dewfpga_subscribers'") == "0", "no RLS policy on dewfpga_subscribers (functions only)")
        # no function is executable by PUBLIC
        leaked = c.value("""select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname like 'dewfpga_%'
                           and has_function_privilege('anon', p.oid, 'execute')
                           and p.proname not in ('dewfpga_subscribe','dewfpga_confirm','dewfpga_unsubscribe')""")
        ok(leaked == "", f"anon can execute only subscribe/confirm/unsubscribe (leaked: {leaked!r})")
        nondef = c.value("""select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname like 'dewfpga_%' and (not p.prosecdef or p.proconfig is null)""")
        ok(nondef == "", f"every dewfpga_ function is security definer with pinned search_path (bad: {nondef!r})")

        # ---------------------------------------------------------------- subscribe (anon, via rpc)
        ok(c.fails("select public.dewfpga_subscribe('not-an-email', '2026-10-03')", "invalid email", role="anon"), "subscribe rejects an invalid address")
        ok(c.fails("select public.dewfpga_subscribe('a@b.co', '')", "consent required", role="anon"), "subscribe without consent text version is refused")
        ok(c.fails("select public.dewfpga_subscribe('a@b.co', null)", "consent required", role="anon"), "subscribe with null consent is refused")
        c.sql("select public.dewfpga_subscribe('  Student@Example.ORG ', '2026-10-03', 'site')", role="anon")
        row = c.rows("select email, source, consent_text_version, confirmed_at is null, confirm_sent_at is null, confirm_token is not null from public.dewfpga_subscribers")
        ok(row == [["student@example.org", "site", "2026-10-03", "t", "t", "t"]], f"subscribe stores a normalised address, consent version, pending state: {row}")
        ok(c.value("select count(*) from auth.users") == "0", "subscribe creates no auth user")
        # the token never leaves the database through the anon path: subscribe returns void
        ok(c.value("select pg_get_function_result('public.dewfpga_subscribe'::regproc)") == "void", "subscribe returns nothing (token not exposed to the browser)")
        # repeat within 10 minutes: same token, no new request (throttle)
        tok1 = c.value("select confirm_token from public.dewfpga_subscribers")
        c.sql("select public.dewfpga_subscribe('student@example.org', '2026-10-03')", role="anon")
        ok(c.value("select confirm_token from public.dewfpga_subscribers") == tok1, "second subscribe within 10 minutes keeps the token (no mail flood)")
        ok(c.value("select count(*) from public.dewfpga_subscribers") == "1", "second subscribe does not duplicate the row")

        # ---------------------------------------------------------------- confirm
        ok(c.value(f"select public.dewfpga_confirm('{tok1}')", role="anon") == "f", "confirm before the mail was sent is refused (token not yet live)")
        pend = c.rows("select id, email, confirm_token from public.dewfpga_pending_confirmations(20)", role="service_role")
        ok(len(pend) == 1 and pend[0][2] == tok1, "service_role sees the pending confirmation")
        sid = pend[0][0]
        ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 1, '{tok1}')", role="service_role") == "t", "mark_confirm_sent")
        ok(c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 2, '{tok1}')", role="service_role") == "f", "mark_confirm_sent is one-shot")
        ok(c.rows("select * from public.dewfpga_pending_confirmations(20)", role="service_role") == [], "sent confirmation leaves the pending list")
        ok(c.value(f"select public.dewfpga_confirm('{uuid.uuid4()}')", role="anon") == "f", "confirm with an unknown token is false")
        ok(c.value("select public.dewfpga_confirm(null)", role="anon") == "f", "confirm with null is false, no error")
        # expiry: 48 h after confirm_sent_at
        c.sql("update public.dewfpga_subscribers set confirm_sent_at = now() - interval '49 hours'")
        ok(c.value(f"select public.dewfpga_confirm('{tok1}')", role="anon") == "f", "confirm after 48 h is refused")
        c.sql("update public.dewfpga_subscribers set confirm_sent_at = now() - interval '47 hours'")
        ok(c.value(f"select public.dewfpga_confirm('{tok1}')", role="anon") == "t", "confirm within 48 h succeeds")
        ok(c.value(f"select public.dewfpga_confirm('{tok1}')", role="anon") == "f", "confirm replay is refused (token consumed)")
        ok(c.value("select confirm_token is null and confirmed_at is not null from public.dewfpga_subscribers") == "t", "confirmed row: token cleared, confirmed_at set")
        ok(c.value("select count(*) from auth.users") == "0", "confirm grants no account (no auth user)")
        ok(c.value("select count(*) from public.dewfpga_profiles") == "0", "confirm creates no profile")
        rec = c.rows("select email from public.dewfpga_recipients()", role="service_role")
        ok(rec == [["student@example.org"]], "confirmed address is a recipient")
        # subscribing again while confirmed is a silent no-op
        c.sql("select public.dewfpga_subscribe('student@example.org', '2026-10-03')", role="anon")
        ok(c.value("select confirm_token is null and confirmed_at is not null from public.dewfpga_subscribers") == "t", "re-subscribe of a confirmed address changes nothing")

        # ---------------------------------------------------------------- unsubscribe (no login)
        utok = c.value("select unsubscribe_token from public.dewfpga_subscribers")
        ok(c.value(f"select public.dewfpga_unsubscribe('{uuid.uuid4()}')", role="anon") == "f", "unsubscribe with an unknown token is false")
        ok(c.value(f"select public.dewfpga_unsubscribe('{utok}')", role="anon") == "t", "unsubscribe as anon (no login) succeeds")
        ok(c.value(f"select public.dewfpga_unsubscribe('{utok}')", role="anon") == "t", "unsubscribe is idempotent")
        ok(c.rows("select * from public.dewfpga_recipients()", role="service_role") == [], "unsubscribed address is no recipient")
        # the newsletter token cannot be used as the unsubscribe token or vice versa
        ok(c.value(f"select public.dewfpga_confirm('{utok}')", role="anon") == "f", "unsubscribe token does not confirm")
        # re-subscribe after unsubscribe: new double opt-in, consent recorded again
        c.sql("update public.dewfpga_subscribers set confirm_requested_at = now() - interval '11 minutes'")
        c.sql("select public.dewfpga_subscribe('student@example.org', '2026-10-04')", role="anon")
        st = c.rows("select unsubscribed_at is null, confirmed_at is null, confirm_token is not null, consent_text_version from public.dewfpga_subscribers")
        ok(st == [["t", "t", "t", "2026-10-04"]], f"re-subscribe after unsubscribe restarts double opt-in with the new consent version: {st}")

        # ---------------------------------------------------------------- prune
        c.sql("select public.dewfpga_subscribe('old@pending.example', '2026-10-03')", role="anon")
        c.sql("update public.dewfpga_subscribers set confirm_requested_at = now() - interval '8 days' where email = 'old@pending.example'")
        c.sql("select public.dewfpga_subscribe('gone@example.net', '2026-10-03')", role="anon")
        c.sql("update public.dewfpga_subscribers set confirmed_at = now(), confirm_token = null, unsubscribed_at = now() - interval '31 days' where email = 'gone@example.net'")
        pr = c.rows("select * from public.dewfpga_newsletter_prune()", role="service_role")
        ok(pr == [["1", "1"]], f"prune deletes 7-day-old pending and 30-day-old unsubscribed rows: {pr}")
        ok(c.value("select count(*) from public.dewfpga_subscribers") == "1", "prune keeps the live row")

        # ---------------------------------------------------------------- mail allocation: dewfpga's own, fail closed
        def res(key, logical=None, rh=H, ph=P, kind="confirm", ch=None, consumer="dewfpga"):
            args = f"'{consumer}','{kind}','{key}','{rh}','{ph}'," + (f"'{ch}'" if ch else "null") + "," + (f"'{logical}'" if logical else "null")
            return f"select ledger_id, status, message_id, reused, action, claim_token, uncertain, coalesce(reason,'') from public.dewfpga_mail_reserve({args})"

        def settle(lid, tok, st, mid=None):
            m = f"'{mid}'" if mid else "null"
            return c.rows(f"select applied, status, uncertain from public.dewfpga_mail_settle({lid}, '{tok}', '{st}', {m})", role="service_role")[0]

        ok(c.value("select string_agg(name, ',') from public.dewfpga_mail_consumers") == "dewfpga",
           "only dewfpga is a consumer: no dewsletter or supabase_auth enrolment is required or claimed")
        ok(c.fails(res("k1"), "not enrolled", role="service_role"), "reserve refused while dewfpga is not enrolled")
        c.sql("update public.dewfpga_mail_consumers set enrolled_at = now() where name = 'dewfpga'")
        ok(c.fails(res("k1"), "no own allocation", role="service_role"), "enrolled without its own daily/monthly share: refused (fail closed)")
        c.sql("update public.dewfpga_mail_consumers set daily_cap = 500, monthly_cap = 99999 where name = 'dewfpga'")
        b = c.rows("select day_cap, month_cap from public.dewfpga_mail_budget()", role="service_role")
        ok(b == [["95", "2900"]], f"a share above the plan is cut to plan minus the inbound slice (100-5, 3000-100): {b}")
        c.sql("update public.dewfpga_mail_consumers set daily_cap = 40, monthly_cap = 1000 where name = 'dewfpga'")
        b = c.rows("select consumer, day_used, day_cap, day_left, month_used, month_cap, month_left, coalesce(blocked,'') from public.dewfpga_mail_budget()", role="service_role")
        ok(b == [["dewfpga", "0", "40", "40", "0", "1000", "1000", ""]], f"budget is dewfpga's own share, nothing about other senders: {b}")
        ok(c.fails(res("k1", consumer="nobody"), "not enrolled", role="service_role"), "unknown consumer refused")
        ok(c.fails(res("k1", kind="spam"), "check", role="service_role"), "unknown kind refused")
        ok(c.fails(res("k1", rh="plain@address.example"), "check", role="service_role"), "recipient must be a hash, not an address")
        ok(c.fails(res("k1", ph="not-a-hash"), "check", role="service_role"), "payload must be a sha256 hash")

        # ---------------------------------------------------------------- reserve, fencing, settle
        r1 = c.rows(res("dewfpga:confirm:1"), role="service_role")[0]
        ok(r1[1:5] == ["reserved", "", "f", "send"] and r1[5] != "" and r1[6] == "f", f"first reserve: send with a claim token: {r1}")
        lid, tok1 = r1[0], r1[5]
        r2 = c.rows(res("dewfpga:confirm:1"), role="service_role")[0]
        ok(r2[0] == lid and r2[3:6] == ["t", "in_flight", ""], f"same key inside the lease: in_flight, no token, no second row: {r2}")
        ok(c.value("select count(*) from public.dewfpga_mail_ledger") == "1", "one ledger row after the retry")
        ok(c.fails(res("dewfpga:confirm:1", rh="b" * 64), "different mail", role="service_role"), "same key with another recipient is an error")
        ok(c.fails(res("dewfpga:confirm:1", ph="f" * 64), "different mail", role="service_role"), "same key with another payload is an error")
        ok(settle(lid, uuid.uuid4(), "failed") == ["f", "reserved", "f"], "a refusal from a claim that does not hold the row changes nothing")
        ok(c.fails(f"select * from public.dewfpga_mail_settle({lid}, '{tok1}', 'sent')", "message id", role="service_role"), "sent without the provider message id is refused")
        ok(settle(lid, tok1, "sent", "msg-1") == ["t", "sent", "f"], "settle sent")
        ok(settle(lid, tok1, "failed") == ["f", "sent", "f"], "settle after sent is a no-op")
        r3 = c.rows(res("dewfpga:confirm:1"), role="service_role")[0]
        ok(r3[1:6] == ["sent", "msg-1", "t", "sent", ""], f"retry after send: action sent, message id, no token: {r3}")
        ok(c.fails(f"select * from public.dewfpga_mail_settle({lid}, '{tok1}', 'bogus')", "status must be", role="service_role"), "settle rejects unknown status")
        rl = c.rows(res("rel"), role="service_role")[0]
        settle(rl[0], rl[5], "released")
        ok(c.value("select day_used from public.dewfpga_mail_budget()", role="service_role") == "1", "released row does not count against the budget")
        ok(c.rows(res("rel"), role="service_role")[0][4] == "spent", "a released key is spent: no call")
        # abandoned claim: past its lease the next claim gets a new token and the row is uncertain
        ab = c.rows(res("ab"), role="service_role")[0]
        c.sql("update public.dewfpga_mail_ledger set last_attempt_at = last_attempt_at - interval '6 minutes' where idempotency_key = 'ab'")
        ab2 = c.rows(res("ab"), role="service_role")[0]
        ok(ab2[4] == "send" and ab2[5] not in ("", ab[5]) and ab2[6] == "t", f"re-claim past the lease: new token, uncertain: {ab2}")
        ok(settle(ab[0], ab[5], "sent", "msg-late") == ["t", "sent", "t"], "a late acceptance from the abandoned claim still converges the row to sent")
        ok(settle(ab[0], ab2[5], "failed") == ["f", "sent", "t"], "...and the current claim's later refusal cannot undo it")
        # uncertainty: no new key until resolved; resolve needs a note
        un = c.rows(res("unk"), role="service_role")[0]
        ok(settle(un[0], un[5], "unknown") == ["t", "unknown", "t"], "settle unknown marks the row uncertain")
        ok(c.rows(res("unk:r2", "unk"), role="service_role")[0][4] == "unresolved", "a new key of an uncertain mail is unresolved (no call)")
        ok(c.fails(f"select public.dewfpga_mail_resolve({un[0]}, 'failed', 'no')", "note", role="service_role"), "resolve needs a note")
        ok(c.value(f"select public.dewfpga_mail_resolve({un[0]}, 'failed', 'provider log shows no request for key unk')", role="service_role") == "t", "operator resolves the unknown row as failed")
        un2 = c.rows(res("unk:r2", "unk"), role="service_role")[0]
        ok(un2[4] == "send" and un2[6] == "f", f"after a proven-safe refusal a new key may go: {un2}")
        settle(un2[0], un2[5], "released")
        # aged row: outside the same-key window, nothing is sent
        ag = c.rows(res("aged"), role="service_role")[0]
        settle(ag[0], ag[5], "unknown")
        c.sql("update public.dewfpga_mail_ledger set first_attempt_at = first_attempt_at - interval '21 hours' where idempotency_key = 'aged'")
        ok(c.rows(res("aged"), role="service_role")[0][4] == "unresolved", "an unknown row past the 20 h same-key window: unresolved, no claim")
        # revocation stops re-claims as well as new keys
        c.sql("update public.dewfpga_mail_ledger set first_attempt_at = now() where idempotency_key = 'aged'")
        c.sql("update public.dewfpga_mail_consumers set enrolled_at = null where name = 'dewfpga'")
        ok(c.fails(res("aged"), "not enrolled", role="service_role"), "revoked: re-claim of an existing row refused")
        ok(c.fails(res("new-after-revoke"), "not enrolled", role="service_role"), "revoked: new key refused")
        c.sql("update public.dewfpga_mail_consumers set enrolled_at = now() where name = 'dewfpga'")
        c.sql("select public.dewfpga_mail_resolve((select id from public.dewfpga_mail_ledger where idempotency_key = 'aged'), 'failed', 'test cleanup: no request')", role="service_role")

        # ---------------------------------------------------------------- counting window
        used = int(c.value("select day_used from public.dewfpga_mail_budget()", role="service_role"))
        c.sql(f"""insert into public.dewfpga_mail_ledger (consumer, kind, recipient_hash, idempotency_key, logical_key, payload_hash, status,
                                                          created_at, first_attempt_at, last_attempt_at, settled_at, message_id)
                  values ('dewfpga','confirm','{H}','early','early','{P}','sent', now()-interval '25 hours', now()-interval '25 hours', now()-interval '6 hours', now()-interval '6 hours', 'm-e'),
                         ('dewfpga','confirm','{H}','stuck','stuck','{P}','reserved', now()-interval '25 hours', now()-interval '25 hours', now()-interval '25 hours', null, null),
                         ('dewfpga','confirm','{H}','old','old','{P}','sent', now()-interval '26 hours', now()-interval '26 hours', now()-interval '26 hours', now()-interval '25 hours', 'm-o')""")
        ok(int(c.value("select day_used from public.dewfpga_mail_budget()", role="service_role")) == used + 2,
           "first tried at -25 h but accepted at -6 h still counts; a stuck reserved row counts; a row settled 25 h ago does not")
        c.sql("delete from public.dewfpga_mail_ledger where idempotency_key in ('early','stuck','old')")

        # ---------------------------------------------------------------- concurrent reserve: exactly day_left succeed
        left = int(c.value("select day_left from public.dewfpga_mail_budget()", role="service_role"))
        ok(0 < left < 40, f"day_left before the race: {left}")
        n = left + 20

        def one(i):
            return c.run(res(f"race:{i}", kind="campaign"), role="service_role").returncode

        with concurrent.futures.ThreadPoolExecutor(max_workers=24) as ex:
            codes = list(ex.map(one, range(n)))
        succ = codes.count(0)
        ok(succ == left, f"{n} parallel reserves: exactly {left} succeed, {succ} did")
        ok(c.value("select count(*) from public.dewfpga_mail_ledger where idempotency_key like 'race:%'") == str(left), "ledger holds exactly the winners")
        ok(c.fails(res("more"), "daily mail budget spent", role="service_role"), "dewfpga's own share stops it")
        c.sql("""update public.dewfpga_mail_ledger set status = 'sent', message_id = 'm', created_at = created_at - interval '25 hours',
                 first_attempt_at = first_attempt_at - interval '25 hours', last_attempt_at = last_attempt_at - interval '25 hours',
                 settled_at = now() - interval '25 hours' where idempotency_key like 'race:%'""")
        ok(int(c.value("select day_left from public.dewfpga_mail_budget()", role="service_role")) == left, "24 h window rolls")
        mu = c.value("select month_used from public.dewfpga_mail_budget()", role="service_role")
        c.sql(f"update public.dewfpga_mail_consumers set monthly_cap = {mu} where name = 'dewfpga'")
        ok(c.fails(res("m1"), "monthly mail budget spent", role="service_role"), "monthly share spent fails closed while the day still has room")
        c.sql("update public.dewfpga_mail_consumers set monthly_cap = 1000 where name = 'dewfpga'")

        # ---------------------------------------------------------------- #25 gate: owner test, receipt, unsubscribe
        CH, CH2, CH3 = "c" * 64, "d" * 64, "f" * 64
        OWN = "owner@example.org"
        ok(c.fails(f"select * from public.dewfpga_mail_campaign_gate('{CH}')", "gate closed", role="service_role"), "campaign gate closed with no owner test")
        ok(c.fails(f"select public.dewfpga_mail_approve('{CH}', 'arrived in inbox')", "no sent owner-test", role="service_role"), "approve refused with no owner test")
        o1 = c.rows(res("ot:1", kind="owner_test", ch=CH), role="service_role")[0]
        ok(c.fails(f"select public.dewfpga_mail_approve('{CH}', 'arrived in inbox')", "no sent owner-test", role="service_role"), "approve refused while the owner test is only reserved")
        settle(o1[0], o1[5], "failed")
        ok(c.fails(f"select public.dewfpga_mail_approve('{CH}', 'arrived in inbox')", "no sent owner-test", role="service_role"), "approve refused when the owner test failed")
        o2 = c.rows(res("ot:2", kind="owner_test", ch=CH), role="service_role")[0]
        settle(o2[0], o2[5], "sent", "msg-ot")
        ok(c.fails(f"select * from public.dewfpga_mail_campaign_gate('{CH}')", "gate closed", role="service_role"), "gate still closed: sent but not approved")
        ok(c.fails(f"select public.dewfpga_mail_approve('{CH}', 'ok')", "receipt note", role="service_role"), "approve without a receipt note is refused (acceptance is not delivery)")
        ok(c.fails(f"select public.dewfpga_mail_approve('{CH}', 'arrived in inbox')", "unsubscribe not measured", role="service_role"), "approve without an unsubscribe check is refused")
        ok(c.value(f"select public.dewfpga_mail_approve('{CH}', 'arrived in inbox', 'clicked unsubscribe, page confirmed')", role="service_role") == o2[0], "approve with an attestation records the sent owner test")
        g = c.rows(f"select owner_test_ledger_id, unsubscribe_method from public.dewfpga_mail_campaign_gate('{CH}')", role="service_role")
        ok(g == [[o2[0], "attested"]], f"gate open, method attested: {g}")
        ok(c.fails(f"select * from public.dewfpga_mail_campaign_gate('{'9'*64}')", "gate closed", role="service_role"), "gate is per content hash: changed content needs a new owner test")
        o3 = c.rows(res("ot:3", kind="owner_test", ch=CH), role="service_role")[0]
        ok(c.fails(f"select * from public.dewfpga_mail_campaign_gate('{CH}')", "gate closed", role="service_role"), "a newer owner test (still open) supersedes the approval")
        settle(o3[0], o3[5], "released")
        ok(c.rows(f"select owner_test_ledger_id from public.dewfpga_mail_campaign_gate('{CH}')", role="service_role") == [[o2[0]]], "a released newer test does not supersede")
        c.sql("update public.dewfpga_mail_approvals set approved_at = now() - interval '15 days'")
        ok(c.fails(f"select * from public.dewfpga_mail_campaign_gate('{CH}')", "gate closed", role="service_role"), "approval expires after 14 days")
        # measured: the owner's own address unsubscribed after the owner test was first tried
        c.sql(f"insert into public.dewfpga_subscribers (email, consent_text_version, confirm_token, confirmed_at) values ('{OWN}', 'v1', null, now())")
        o4 = c.rows(res("ot:4", kind="owner_test", ch=CH2, rh=sha(OWN)), role="service_role")[0]
        settle(o4[0], o4[5], "sent", "msg-ot4")
        ut = c.value(f"select unsubscribe_token from public.dewfpga_subscribers where email = '{OWN}'")
        ok(c.value(f"select public.dewfpga_unsubscribe('{ut}')", role="anon") == "t", "owner uses the test mail's unsubscribe link")
        c.value(f"select public.dewfpga_mail_approve('{CH2}', 'arrived in inbox')", role="service_role")
        g = c.rows(f"select unsubscribe_method from public.dewfpga_mail_campaign_gate('{CH2}')", role="service_role")
        ok(g == [["measured"]], f"unsubscribe measured from the subscriber table: {g}")
        o5 = c.rows(res("ot:5", kind="owner_test", ch=CH3, rh=sha(OWN)), role="service_role")[0]
        settle(o5[0], o5[5], "sent", "msg-ot5")
        ok(c.fails(f"select public.dewfpga_mail_approve('{CH3}', 'arrived in inbox')", "unsubscribe not measured", role="service_role"),
           "an unsubscribe from before this owner test does not count")
        c.sql(f"update public.dewfpga_mail_approvals set owner_recipient_hash = '{H}' where content_hash = '{CH2}'")
        ok(c.fails(f"select * from public.dewfpga_mail_campaign_gate('{CH2}')", "gate closed", role="service_role"), "approval whose owner differs from the test's recipient: gate closed")
        c.sql(f"delete from public.dewfpga_subscribers where email = '{OWN}'")

        # ---------------------------------------------------------------- account (#26)
        # Scope contract (after the independent review of the first draft, cases A1-A8 in
        # .review-artifacts/repro_a_scope.py): auth.users is shared by every app in the project.
        # Second-app fixtures the way Supabase docs prescribe app data: CASCADE and NO ACTION FKs.
        c.sql("""
          create table public.otherapp_profiles (id uuid primary key references auth.users on delete cascade, display_name text);
          create table public.otherapp_notes (id bigint generated always as identity primary key,
                                              user_id uuid not null references auth.users (id) on delete cascade, body text not null);
          create table public.otherapp_orders (id bigint generated always as identity primary key,
                                               user_id uuid not null references auth.users (id), total numeric not null);""")
        u1, u2, u3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        c.sql(f"insert into auth.users (id, email) values ('{u1}', 'student@example.org'), ('{u2}', 'other@example.org')")
        ok(c.value("select count(*) from public.dewfpga_profiles") == "0", "A3: a new auth user gets no dewfpga row (no trigger on auth.users)")
        ok(c.value("select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal") == "0", "no dewfpga trigger on auth.users at all")
        cl1 = f'{{"sub":"{u1}","email":"student@example.org","role":"authenticated"}}'
        cl2 = f'{{"sub":"{u2}","email":"other@example.org","role":"authenticated"}}'
        cl3 = f'{{"sub":"{u3}","email":"third@example.org","role":"authenticated"}}'
        # A5: another app's signup is independent of dewfpga's table even when that table is broken
        c.sql("alter table public.dewfpga_profiles add constraint k7_break check (false) not valid")
        ok(c.run(f"insert into auth.users (id, email) values ('{u3}', 'third@example.org')").returncode == 0, "A5: another app's signup succeeds while dewfpga_profiles refuses inserts")
        ok(c.fails("select public.dewfpga_enrol_me()", "k7_break", role="authenticated", claims=cl3), "the broken table only breaks dewfpga's own enrolment")
        c.sql("alter table public.dewfpga_profiles drop constraint k7_break")
        # explicit enrolment, also for a pre-existing identity (u1 existed before any dewfpga call)
        ok(c.fails("select public.dewfpga_enrol_me()", "permission denied", role="anon"), "anon cannot enrol")
        ok(c.fails("select public.dewfpga_enrol_me()", "not signed in", role="authenticated"), "enrol without a jwt is refused")
        e = c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl1)
        ok(f'"user_id": "{u1}"' in e and '"created": true' in e and '"premium_since": null' in e, "A4: an existing identity enrols explicitly and gets a profile")
        e = c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl1)
        ok('"created": false' in e, "enrol is idempotent")
        c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl2)
        ok(c.value("select count(*) from public.dewfpga_profiles") == "2", "two enrolled, the third identity (never used dewfpga) has no row")
        ok(c.rows("select user_id from public.dewfpga_profiles", role="authenticated", claims=cl1) == [[str(u1)]], "RLS: a user sees only their own profile")
        ok(c.rows("select user_id from public.dewfpga_profiles", role="authenticated", claims=cl2) == [[str(u2)]], "RLS: the other user sees only theirs")
        ok(c.rows("select user_id from public.dewfpga_profiles", role="authenticated") == [], "authenticated role without claims sees nothing")
        ok(c.fails("select * from public.dewfpga_profiles", "permission denied", role="anon"), "anon cannot read profiles")
        ok(c.fails("update public.dewfpga_profiles set premium_since = now()", "permission denied", role="authenticated", claims=cl1), "a user cannot set premium_since (no update grant)")
        ok(c.fails(f"insert into public.dewfpga_profiles (user_id, premium_since) values ('{u1}', now())", "permission denied", role="authenticated", claims=cl1), "a user cannot insert a profile directly")
        ok(c.fails("delete from public.dewfpga_profiles", "permission denied", role="authenticated", claims=cl1), "a user cannot delete a profile row directly")
        ok(c.value("select premium_since is null from public.dewfpga_profiles", role="authenticated", claims=cl1) == "t", "premium is not granted to anyone")
        # export / delete for a signed-in but not enrolled identity
        ok(c.fails("select public.dewfpga_export_me()", "permission denied", role="anon"), "anon cannot export")
        ok(c.fails("select public.dewfpga_export_me()", "not signed in", role="authenticated"), "export without a jwt is refused")
        exp3 = json.loads(c.value("select public.dewfpga_export_me()", role="authenticated", claims=cl3))
        ok(exp3["account"] is None and exp3["newsletter"] == [] and exp3["signed_in_email"] == "third@example.org", "export for a not-enrolled identity: no account, no newsletter, says who is signed in")
        ok(c.value("select public.dewfpga_delete_me()", role="authenticated", claims=cl3) == "f", "delete_me for a not-enrolled identity deletes nothing and says so")
        ok(c.value(f"select count(*) from auth.users where id = '{u3}'") == "1", "...and the shared identity is untouched")
        # A6/A7: the session's email claim must not reach a stranger's anonymous subscription
        c.sql("select public.dewfpga_subscribe('student@example.org', '2026-10-03', 'site')", role="anon")
        tok = c.value("select confirm_token from public.dewfpga_subscribers where email = 'student@example.org'")
        c.sql("update public.dewfpga_subscribers set confirm_sent_at = now() where email = 'student@example.org'")
        ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="anon") == "t", "a stranger's anonymous subscription under u1's address is confirmed anonymously")
        exp = json.loads(c.value("select public.dewfpga_export_me()", role="authenticated", claims=cl1))
        ok(exp["newsletter"] == [] and "not linked" in exp["newsletter_note"], "A6: export does not show a subscription matched only by the email claim")
        ok(c.value("select public.dewfpga_delete_me()", role="authenticated", claims=cl1) == "t", "delete_me (u1, first time) deletes the profile")
        ok(c.value("select count(*) from public.dewfpga_subscribers where email = 'student@example.org' and confirmed_at is not null") == "1", "A7: delete_me leaves the email-matched, unlinked subscription alone")
        ok(c.value(f"select count(*) from auth.users where id = '{u1}'") == "1", "delete_me does not delete the shared identity")
        c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl1)
        # linking by token proof: confirm while signed in and enrolled
        c.sql("select public.dewfpga_subscribe('mine@example.org', '2026-10-03', 'site')", role="authenticated", claims=cl1)
        tok = c.value("select confirm_token from public.dewfpga_subscribers where email = 'mine@example.org'")
        c.sql("update public.dewfpga_subscribers set confirm_sent_at = now() where email = 'mine@example.org'")
        ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="authenticated", claims=cl3) == "t", "confirm by a signed-in but NOT enrolled session still confirms")
        ok(c.value("select user_id is null from public.dewfpga_subscribers where email = 'mine@example.org'") == "t", "...but links nothing (no profile to link to)")
        c.sql("select public.dewfpga_subscribe('mine2@example.org', '2026-10-03', 'site')", role="authenticated", claims=cl1)
        tok = c.value("select confirm_token from public.dewfpga_subscribers where email = 'mine2@example.org'")
        c.sql("update public.dewfpga_subscribers set confirm_sent_at = now() where email = 'mine2@example.org'")
        ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="authenticated", claims=cl1) == "t", "confirm while signed in and enrolled")
        ok(c.value("select user_id from public.dewfpga_subscribers where email = 'mine2@example.org'") == str(u1), "...links the subscription to the confirming account (token proof)")
        ok(c.value(f"select public.dewfpga_confirm('{tok}')", role="authenticated", claims=cl2) == "f", "the used token cannot re-link the row to another account")
        # linking by the manage/unsubscribe token
        ut = c.value("select unsubscribe_token from public.dewfpga_subscribers where email = 'mine@example.org'")
        ok(c.fails(f"select public.dewfpga_link_subscription('{ut}')", "permission denied", role="anon"), "anon cannot link")
        ok(c.fails(f"select public.dewfpga_link_subscription('{ut}')", "not enrolled", role="authenticated", claims=cl3), "a not-enrolled session cannot link")
        ok(c.value(f"select public.dewfpga_link_subscription('{uuid.uuid4()}')", role="authenticated", claims=cl1) == "f", "an unknown manage token links nothing")
        ok(c.value(f"select public.dewfpga_link_subscription('{ut}')", role="authenticated", claims=cl1) == "t", "the manage token from a mail links the subscription to the signed-in account")
        exp = json.loads(c.value("select public.dewfpga_export_me()", role="authenticated", claims=cl1))
        ok(sorted(n["email"] for n in exp["newsletter"]) == ["mine2@example.org", "mine@example.org"] and "token" not in json.dumps(exp) and str(u2) not in json.dumps(exp),
           "export lists the two linked subscriptions, no tokens, nobody else's data")
        ok(exp["account"]["user_id"] == str(u1) and exp["signed_in_email"] == "student@example.org", "export holds the profile and the signed-in address")
        # A8: the account's address changes after linking; the link survives, email plays no part
        c.sql(f"update auth.users set email = 'student.new@example.org' where id = '{u1}'")
        cl1n = f'{{"sub":"{u1}","email":"student.new@example.org","role":"authenticated"}}'
        exp = json.loads(c.value("select public.dewfpga_export_me()", role="authenticated", claims=cl1n))
        ok(len(exp["newsletter"]) == 2 and exp["signed_in_email"] == "student.new@example.org", "A8: after an address change the linked subscriptions are still exported")
        # A1/A2: erasure next to a second app with CASCADE and NO ACTION references to the same identity
        c.sql(f"insert into public.otherapp_profiles values ('{u1}', 'Student')")
        c.sql(f"insert into public.otherapp_notes (user_id, body) values ('{u1}', 'thesis draft v3'), ('{u1}', 'lab notes')")
        c.sql(f"insert into public.otherapp_orders (user_id, total) values ('{u1}', 42)")
        ok(c.fails("select public.dewfpga_delete_me()", "permission denied", role="anon"), "anon cannot delete")
        ok(c.value("select public.dewfpga_delete_me()", role="authenticated", claims=cl1n) == "t", "A2: delete_me succeeds although another app holds a NO ACTION reference to the identity")
        ok(c.value(f"select count(*) from public.dewfpga_profiles where user_id = '{u1}'") == "0", "delete_me removed the profile")
        ok(c.value("select count(*) from public.dewfpga_subscribers where email in ('mine@example.org', 'mine2@example.org')") == "0", "A8: delete_me removed both linked subscriptions (one under the old address)")
        ok(c.value("select count(*) from public.dewfpga_subscribers where email = 'student@example.org'") == "1", "the unlinked, email-matched subscription survives (not provably this person's)")
        ok(c.value(f"select count(*) from auth.users where id = '{u1}'") == "1", "A1: the shared identity survives")
        ok(c.value(f"select (select count(*) from public.otherapp_profiles where id = '{u1}') || '/' || (select count(*) from public.otherapp_notes where user_id = '{u1}') || '/' || (select count(*) from public.otherapp_orders where user_id = '{u1}')") == "1/2/1",
           "A1: the other app's profile, notes and orders survive dewfpga's erasure")
        ok(c.value(f"select count(*) from auth.users where id = '{u2}'") == "1" and c.value("select count(*) from public.dewfpga_profiles") == "1", "delete_me left the other dewfpga account alone")
        ok(c.value("select public.dewfpga_delete_me()", role="authenticated", claims=cl1n) == "f", "a second delete_me has nothing left to delete")
        # the operator's separate process: deleting the shared identity takes dewfpga rows with it, nothing else is dewfpga's business
        c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl2)
        c.sql("select public.dewfpga_subscribe('other@example.org', '2026-10-03')", role="authenticated", claims=cl2)
        ut = c.value("select unsubscribe_token from public.dewfpga_subscribers where email = 'other@example.org'")
        c.value(f"select public.dewfpga_link_subscription('{ut}')", role="authenticated", claims=cl2)
        c.sql(f"delete from auth.users where id = '{u2}'")
        ok(c.value(f"select count(*) from public.dewfpga_profiles where user_id = '{u2}'") == "0" and c.value("select count(*) from public.dewfpga_subscribers where email = 'other@example.org'") == "0",
           "an identity deletion done elsewhere cascades to dewfpga's profile and linked subscription")
        ok(c.value("select count(*) from public.dewfpga_subscribers where email = 'student@example.org'") == "1", "...and leaves unlinked subscriptions (they were never tied to that identity)")

        # ---------------------------------------------------------------- identity column needs no sequence grant
        seq = c.value("select pg_get_serial_sequence('public.dewfpga_mail_ledger', 'id')")
        ok(c.value(f"select has_sequence_privilege('service_role', '{seq}', 'usage') or has_sequence_privilege('service_role', '{seq}', 'update')") == "f",
           "service_role holds no privilege on the ledger's identity sequence")
        lid = c.value(f"insert into public.dewfpga_mail_ledger (consumer, kind, recipient_hash, idempotency_key, logical_key, payload_hash) "
                      f"values ('dewfpga', 'other', '{H}', 'direct-k1', 'direct-k1', '{P}') returning id", role="service_role")
        ok(lid.isdigit(), f"...and still inserts a ledger row directly: the identity column draws id {lid} as the table owner")
        c.sql("delete from public.dewfpga_mail_ledger where idempotency_key = 'direct-k1'")

        # ---------------------------------------------------------------- re-apply keeps what the operator configured
        # 002 drops the other senders an EARLIER version seeded. The operator may also add a consumer row
        # by hand (e.g. dewsletter with its own share, no ledger row yet): a re-apply must not delete it.
        c.sql("insert into public.dewfpga_mail_consumers (name, enrolled_at, daily_cap, monthly_cap, note) values "
              "('dewsletter', now(), 90, 2700, 'operator-configured, no ledger row yet'), "
              "('half_set', null, 40, null, 'partly configured: only a daily share'), "
              "('old_seed', null, null, null, 'seeded by an earlier 002, never configured'), "
              "('old_sender', null, null, null, 'never configured but has a ledger row')")
        c.sql(f"insert into public.dewfpga_mail_ledger (consumer, kind, recipient_hash, idempotency_key, logical_key, payload_hash, status) "
              f"values ('old_sender', 'other', '{H}', 'old-sender-k1', 'old-sender-k1', '{P}', 'failed')")
        c.load_migrations()
        names = c.value("select string_agg(name, ',' order by name) from public.dewfpga_mail_consumers")
        ok(names == "dewfpga,dewsletter,half_set,old_sender",
           f"re-apply deletes only the unconfigured seed without a ledger row (old_seed); kept: {names}")
        ok(c.value("select enrolled_at is not null, daily_cap, monthly_cap from public.dewfpga_mail_consumers where name = 'dewsletter'", extra=("-At", "-F", "/")) == "t/90/2700",
           "the operator-configured foreign consumer keeps its enrolment and share across a re-apply")

    # ---------------------------------------------------------------- Supabase default privileges (existing projects)
    default_privileges_cluster()
    print(f"\npassed {PASSED}, failed 0")


# What an EXISTING Supabase project does to every new object in public (supabase/postgres init scripts;
# docs/guides/database/hardening-data-api): anon, authenticated and service_role get ALL on new tables,
# functions and sequences by default. The plain harness does not model this, so these checks run on a
# second private cluster with the same default privileges set BEFORE the migrations.
SUPABASE_DEFAULT_PRIVILEGES = """
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
"""

# Everything README/SQL allow anon and authenticated to touch; anything else granted is a leak.
ALLOWED = {
    ("function", "anon", "dewfpga_subscribe", "execute"), ("function", "anon", "dewfpga_confirm", "execute"),
    ("function", "anon", "dewfpga_unsubscribe", "execute"),
    ("function", "authenticated", "dewfpga_subscribe", "execute"), ("function", "authenticated", "dewfpga_confirm", "execute"),
    ("function", "authenticated", "dewfpga_unsubscribe", "execute"), ("function", "authenticated", "dewfpga_enrol_me", "execute"),
    ("function", "authenticated", "dewfpga_link_subscription", "execute"), ("function", "authenticated", "dewfpga_export_me", "execute"),
    ("function", "authenticated", "dewfpga_delete_me", "execute"),
    ("column", "authenticated", "dewfpga_profiles", "select"),  # 003: select (user_id, created_at, premium_since), RLS self only
}

PRIVILEGE_SWEEP = """
with roles(r) as (values ('anon'), ('authenticated')),
rel as (select c.oid, c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname like 'dewfpga\\_%'),
fns as (select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'dewfpga\\_%')
select 'table', r, relname, priv, has_table_privilege(r, oid, priv)
  from roles, rel, unnest(array['select','insert','update','delete','truncate','references','trigger']) priv where relkind in ('r','p','v','m')
union all
select 'column', r, relname, priv, has_any_column_privilege(r, oid, priv)
  from roles, rel, unnest(array['select','insert','update','references']) priv where relkind in ('r','p','v','m')
union all
select 'sequence', r, relname, priv, has_sequence_privilege(r, oid, priv)
  from roles, rel, unnest(array['usage','select','update']) priv where relkind = 'S'
union all
select 'function', r, proname, 'execute', has_function_privilege(r, oid, 'execute') from roles, fns
order by 1, 2, 3, 4
"""


def default_privileges_cluster():
    global CLUSTER
    with Cluster() as c:
        CLUSTER = c
        c.sql(SUPABASE_DEFAULT_PRIVILEGES)
        c.load_migrations()
        c.load_migrations()
        rows = c.rows(PRIVILEGE_SWEEP)
        kinds = {k: len({name for kk, _, name, _, _ in rows if kk == k}) for k in ("table", "sequence", "function")}
        ok(kinds["table"] >= 5 and kinds["sequence"] >= 1 and kinds["function"] >= 15,
           f"default-privilege cluster: swept {kinds['table']} tables, {kinds['sequence']} sequences, {kinds['function']} functions x anon/authenticated = {len(rows)} (object, role, privilege) checks")
        granted = {(k, r, name, priv) for k, r, name, priv, has in rows if has == "t"}
        extra = sorted(granted - ALLOWED)
        missing = sorted(ALLOWED - granted)
        ok(not extra, f"anon/authenticated hold {len(granted)} privileges, all in the documented allow-list of {len(ALLOWED)}; extra: {extra}")
        ok(not missing, f"every documented anon/authenticated privilege is present; missing: {missing}")
        seq = c.value("select pg_get_serial_sequence('public.dewfpga_mail_ledger', 'id')")
        ok(seq == "public.dewfpga_mail_ledger_id_seq", f"the ledger's identity sequence is {seq}")
        for role in ("anon", "authenticated"):
            ok(c.fails(f"select nextval('{seq}')", "permission denied", role=role), f"{role} cannot nextval() the ledger sequence")
            ok(c.fails(f"select last_value from {seq}", "permission denied", role=role), f"{role} cannot read the ledger sequence (send volume)")
        # the identity column still draws ids for the worker: no sequence grant is needed by service_role
        lid = c.value(f"insert into public.dewfpga_mail_ledger (consumer, kind, recipient_hash, idempotency_key, logical_key, payload_hash) "
                      f"values ('dewfpga', 'other', '{H}', 'direct-k1', 'direct-k1', '{P}') returning id", role="service_role")
        ok(lid.isdigit() and int(lid) >= 1, f"service_role inserts a ledger row directly after the sequence revoke (id {lid})")
        c.sql("update public.dewfpga_mail_consumers set enrolled_at = now(), daily_cap = 10, monthly_cap = 100 where name = 'dewfpga'")
        r = c.rows(f"select ledger_id, action from public.dewfpga_mail_reserve('dewfpga', 'confirm', 'rpc-k1', '{H}', '{P}', null, 'rpc-k1')", role="service_role")
        ok(len(r) == 1 and r[0][1] == "send" and int(r[0][0]) > int(lid), f"the reserve RPC still mints ledger ids after the revoke: {r}")


if __name__ == "__main__":
    main()
