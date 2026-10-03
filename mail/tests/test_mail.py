#!/usr/bin/env python3
"""mail/dewfpga_mail.py against the real SQL functions (private PostgreSQL) and a recording transport.

No network: every socket is refused for the whole run (a test that reaches Resend or Supabase fails
here instead of sending). What is covered: dry-run sends nothing; the live guard names every missing
input; the Resend payload and headers (Idempotency-Key, User-Agent, List-Unsubscribe); the answer
classes (accepted, unknown, conflict, quota, refused, released); reserve -> send -> settle through psql
with the claim token; dewfpga's own allocation fails closed (not enrolled, no own caps); a mail
without a tokened unsubscribe link is refused; an unknown answer retries the SAME key and stays
counted, never a fresh key; only a 429 refusal moves to a derived key, bounded by MAX_ATTEMPTS; the
provider's quota error halts the run; the owner must subscribe and confirm before the owner test; the
campaign needs the owner test sent AND approved with a receipt note and a measured or attested
unsubscribe; eligibility is rechecked before each campaign send. Confirmations exercise
the actual shipped 001 RPCs (tokened unsubscribe and generation-fenced completion).
No network or real services are used.
"""
import io, json, os, socket, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from pg_harness import Cluster  # noqa: E402
import dewfpga_mail as dm  # noqa: E402
import patch_notes_mail  # noqa: E402

PASSED = 0


def ok(cond, what):
    global PASSED
    if not cond:
        print(f"FAIL  {what}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {what}")


# ---- no socket for the whole run; psql uses a unix socket through a subprocess, not this process
class _NoNet(socket.socket):
    def __init__(self, *a, **k):
        raise AssertionError("network use in tests")


socket.socket = _NoNet
socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(AssertionError("network use in tests"))


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


SCALAR = {"dewfpga_confirm", "dewfpga_unsubscribe", "dewfpga_mark_confirm_sent",
          "dewfpga_mail_approve", "dewfpga_subscribe"}


class PsqlRpc(dm.Rpc):
    """The same calls SupabaseRpc would POST, run as service_role on the private cluster."""

    def __init__(self, cluster):
        self.c, self.calls = cluster, []

    def call(self, fn, params):
        self.calls.append((fn, dict(params)))
        args = ", ".join(f"{k} => {lit(v)}" for k, v in params.items())
        if fn in SCALAR:
            q = f"select to_json(public.{fn}({args}))"
        else:
            q = f"select coalesce(json_agg(t), '[]') from public.{fn}({args}) t"
        r = self.c.run(q, role="service_role", extra=("-At",))
        if r.returncode != 0:
            msg = [l for l in r.stderr.splitlines() if l.startswith("ERROR:")]
            raise dm.RpcError((msg[0][7:] if msg else r.stderr).strip())
        return json.loads(r.stdout.strip())


class RecordingTransport(dm.Transport):
    def __init__(self):
        self.sent, self.script = [], []

    def send(self, payload, key):
        self.sent.append((payload, key))
        if self.script:
            return self.script.pop(0)
        return dm.SendResult(200, f"test-{uuid.uuid4()}")


def ledger(c):
    return c.rows("select idempotency_key, status, coalesce(message_id,'') from public.dewfpga_mail_ledger order by id")


def main():
    # ---------------------------------------------------------------- pure parts
    r = dm.main(["status"], env={})
    ok(r == 0, "dry-run status exits 0 without any env")
    ok(dm.main(["campaign", "--entry", "16"], env={}) == 2, "dry-run campaign is refused (needs a database): nothing sent")
    ok(dm.main(["--live", "status"], env={}) == 2, "--live without DEWFPGA_MAIL_LIVE=1 refused")
    try:
        dm.live_config({"DEWFPGA_MAIL_LIVE": "1"}, True)
        ok(False, "live guard")
    except dm.MailError as e:
        ok(all(k in str(e) for k in dm.LIVE_ENV), f"live guard names every missing input: {e}")
    try:
        dm.live_config({"DEWFPGA_MAIL_LIVE": "1", "RESEND_API_KEY": "x", "SUPABASE_URL": "https://p.supabase.co",
                        "SUPABASE_SERVICE_KEY": "x", "MAIL_FROM": "no-at", "SITE_URL": "https://x"}, True)
        ok(False, "MAIL_FROM shape")
    except dm.MailError as e:
        ok("MAIL_FROM" in str(e), "MAIL_FROM without an address refused")
    p = dm.build_payload("dewfpga <a@b.test>", "x@y.test", "s", "<p>h</p>", "t", "https://s/u/")
    ok(p["to"] == ["x@y.test"] and p["headers"] == {"List-Unsubscribe": "<https://s/u/>"} and p["from"] == "dewfpga <a@b.test>",
       "Resend payload: from, to[], subject, html, text, headers.List-Unsubscribe (fields per saved send-email doc)")
    try:
        dm.build_payload("a@b.test", "not an address", "s", "h", "t", "u")
        ok(False, "bad address")
    except dm.MailError:
        ok(True, "payload refuses a malformed recipient")
    ok(dm.key_variant("k", 1) == "k" and dm.key_variant("k", 3) == "k:r3", "retry keys derive from the base key")
    R = dm.SendResult
    ok([R(200, "id").classify(), R(200, None).classify(), R(500).classify(), R(0).classify(),
        R(409, None, "concurrent_idempotent_requests").classify(), R(409, None, "invalid_idempotent_request").classify(),
        R(429, None, "rate_limit_exceeded").classify(), R(429, None, "daily_quota_exceeded").classify(), R(422, None, "validation_error").classify()]
       == ["accepted", "unknown", "unknown", "unknown", "unknown", "conflict", "refused", "quota", "released"],
       "answer classes: 2xx+id accepted; 2xx without id, 5xx, no answer, 409 in-flight unknown; 409 other body conflict; 429 refused; quota; 4xx released")
    ok([R(500).outcome(), R(409, None, "invalid_idempotent_request").outcome(), R(429, None, "rate_limit_exceeded").outcome(), R(422).outcome()]
       == ["unknown", "unknown", "failed", "released"], "unknown and conflict settle unknown (counted, uncertain); a refusal settles failed")

    # the ResendTransport request shape, without a socket: urlopen is replaced for one call
    import urllib.request
    seen = {}

    class _Resp:
        status = 200
        def read(self): return b'{"id":"abc"}'
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake_open(req, timeout=None):
        seen["url"], seen["headers"], seen["body"] = req.full_url, dict(req.header_items()), json.loads(req.data)
        return _Resp()
    real = urllib.request.urlopen
    urllib.request.urlopen = fake_open
    try:
        res = dm.ResendTransport("re_test").send(p, "dewfpga:k")
    finally:
        urllib.request.urlopen = real
    h = {k.lower(): v for k, v in seen["headers"].items()}
    ok(seen["url"] == dm.RESEND_ENDPOINT and h["idempotency-key"] == "dewfpga:k" and h["authorization"] == "Bearer re_test"
       and h["user-agent"] == dm.USER_AGENT and h["content-type"] == "application/json" and seen["body"] == p and res.outcome() == "sent" and res.message_id == "abc",
       "ResendTransport: POST /emails with Idempotency-Key, Bearer, named User-Agent, JSON body (adapter shape only; live UNVERIFIED)")

    # dry-run transport never returns an id
    d = dm.DryRunTransport(io.StringIO())
    ok(d.send(p, "k").outcome() != "sent" and d.payloads[0] is p and len(d.payloads) == 1, "dry-run transport returns no id, nothing counts as sent")

    # ---------------------------------------------------------------- with the database
    with Cluster() as c:
        c.load_migrations()
        rpc, tr = PsqlRpc(c), RecordingTransport()
        slept = []
        m = dm.Mailer(rpc, tr, "dewfpga <news@example.test>", "https://nosey-dewdrop.github.io/dewfpga/", log=lambda *a: None,
                      sleep=slept.append)
        U = "https://nosey-dewdrop.github.io/dewfpga/newsletter/unsubscribe/#t=" + str(uuid.uuid4())

        def send(key, to="a@b.test", unsub=U):
            return m._send("confirm", key, to, "s", "h", "t", unsub)

        def used():
            return int(c.value("select day_used from public.dewfpga_mail_budget()", role="service_role"))

        def subscribe_confirm(mail):
            c.sql(f"select public.dewfpga_subscribe('{mail}', '2026-10-03', 'site')", role="anon")
            c.sql(f"update public.dewfpga_subscribers set confirm_sent_at = now() where email = '{mail}'")
            tok = c.value(f"select confirm_token from public.dewfpga_subscribers where email = '{mail}'")
            c.sql(f"select public.dewfpga_confirm('{tok}')", role="anon")

        try:
            send("dewfpga:confirm:x")
            ok(False, "halt")
        except dm.BudgetHalt as e:
            ok("not enrolled" in str(e) and tr.sent == [], f"unenrolled consumer: BudgetHalt before any send ({e})")
        c.sql("update public.dewfpga_mail_consumers set enrolled_at = now() where name = 'dewfpga'")
        try:
            send("dewfpga:confirm:x")
            ok(False, "halt")
        except dm.BudgetHalt as e:
            ok("no own allocation" in str(e) and tr.sent == [], "enrolled without its own daily/monthly share: halt, nothing sent (fail closed)")
        c.sql("update public.dewfpga_mail_consumers set daily_cap = 40, monthly_cap = 1000 where name = 'dewfpga'")
        try:
            send("dewfpga:confirm:x", unsub="https://nosey-dewdrop.github.io/dewfpga/newsletter/unsubscribe/")
            ok(False, "untokened")
        except dm.MailError as e:
            ok("tokened unsubscribe" in str(e) and tr.sent == [] and ledger(c) == [], "a mail without a tokened unsubscribe link is refused before the ledger")

        r1 = send("dewfpga:confirm:x")
        ok(r1["outcome"] == "sent" and r1["calls"] == 1 and tr.sent[0][1] == "dewfpga:confirm:x"
           and tr.sent[0][0]["headers"]["List-Unsubscribe"] == f"<{U}>", "reserve -> send -> settle: one mail, ledger key is the Idempotency-Key, tokened header")
        ok(ledger(c) == [["dewfpga:confirm:x", "sent", r1["message_id"]]], "ledger row settled sent with the provider id")
        r2 = send("dewfpga:confirm:x")
        ok(r2["reused"] and r2["outcome"] == "sent" and r2["calls"] == 0 and len(tr.sent) == 1, "rerun with the same key: row reused, no second send")
        try:
            send("dewfpga:confirm:x", to="other@b.test")
            ok(False, "mismatch")
        except dm.RpcError as e:
            ok("different mail" in str(e) and len(tr.sent) == 1, "same key, another recipient: refused, no send")

        # a run that died between reserve and settle: past the lease the SAME key goes out again
        crash_p = dm.build_payload(m.mail_from, "c@d.test", "s", "h", "t", U)
        rpc.call("dewfpga_mail_reserve", {"p_consumer": "dewfpga", "p_kind": "confirm", "p_idempotency_key": "dewfpga:confirm:crash",
                                          "p_recipient_hash": dm.recipient_hash("c@d.test"), "p_payload_hash": dm.payload_hash(crash_p),
                                          "p_content_hash": None, "p_logical_key": "dewfpga:confirm:crash"})
        r3a = send("dewfpga:confirm:crash", to="c@d.test")
        ok(r3a["outcome"] == "in_flight" and r3a["calls"] == 0, "inside the lease the reserved row is in flight: no call")
        c.sql("update public.dewfpga_mail_ledger set last_attempt_at = last_attempt_at - interval '6 minutes' where idempotency_key = 'dewfpga:confirm:crash'")
        r3 = send("dewfpga:confirm:crash", to="c@d.test")
        ok(r3["outcome"] == "sent" and tr.sent[-1][1] == "dewfpga:confirm:crash"
           and c.value("select count(*) from public.dewfpga_mail_ledger where idempotency_key like 'dewfpga:confirm:crash%'") == "1",
           "abandoned claim: the next run re-claims the SAME key, one ledger row (the provider dedupes the key)")

        # unknown answers: the same key, bounded, then settled unknown; no derived key
        n = len(tr.sent)
        tr.script = [R(500, None, "application_error", "boom"), R(0, None, None, "timeout"), R(200, None)]
        r4 = send("dewfpga:confirm:lost", to="e@f.test")
        ok(r4["outcome"] == "unknown" and r4["calls"] == dm.SAME_KEY_TRIES and [k for _, k in tr.sent[n:]] == ["dewfpga:confirm:lost"] * 3
           and slept == list(dm.BACKOFF), f"three unknown answers: three calls with the SAME key and backoff {slept}, settled unknown")
        ok({k: s_ for k, s_, _ in ledger(c)}.get("dewfpga:confirm:lost") == "unknown" and "dewfpga:confirm:lost:r2" not in {k for k, _, _ in ledger(c)},
           "the unknown row stays counted; no :r2 key exists")
        tr.script = [R(200, "late-id")]
        r4b = send("dewfpga:confirm:lost", to="e@f.test")
        ok(r4b["outcome"] == "sent" and tr.sent[-1][1] == "dewfpga:confirm:lost", "a later run retries the SAME key and settles sent")

        # 429 is a refusal: a derived key, through the gates again
        tr.script = [R(429, None, "rate_limit_exceeded", "slow")]
        r5 = send("dewfpga:confirm:flaky", to="g@h.test")
        st = {k: s_ for k, s_, _ in ledger(c)}
        ok(r5["outcome"] == "sent" and [k for _, k in tr.sent[-2:]] == ["dewfpga:confirm:flaky", "dewfpga:confirm:flaky:r2"]
           and st["dewfpga:confirm:flaky"] == "failed" and st["dewfpga:confirm:flaky:r2"] == "sent",
           "429 refused: settled failed (still counted), the next attempt uses :r2")

        # a refusal after an unknown answer under the same claim is not proof: it stays unknown
        tr.script = [R(503), R(429, None, "rate_limit_exceeded", "slow")]
        n = len(tr.sent)
        r5b = send("dewfpga:confirm:mixed", to="m@n.test")
        ok(r5b["outcome"] == "unknown" and len(tr.sent) == n + 2 and all(k == "dewfpga:confirm:mixed" for _, k in tr.sent[n:]),
           f"unknown then 429 on the same key: stays unknown, no fresh key ({r5b.get('error')})")

        # 4xx validation: released, not retried, not counted
        u0 = used()
        tr.script = [R(422, None, "validation_error", "bad to")]
        r6 = send("dewfpga:confirm:bad", to="i@j.test")
        ok(r6["outcome"] == "released" and r6["calls"] == 1 and used() == u0, "4xx validation: released, one call, budget unchanged")
        r6b = send("dewfpga:confirm:bad", to="i@j.test")
        ok(r6b["outcome"] == "released" and r6b["calls"] == 0, "a released mail is not sent again under any key")

        # exhaust: three refusals -> gave up after exactly MAX_ATTEMPTS keys
        n = len(tr.sent)
        tr.script = [R(429, None, "rate_limit_exceeded")] * 3
        r7 = send("dewfpga:confirm:dead", to="k@l.test")
        ok(r7["outcome"] == "failed" and "gave up" in r7["error"] and len(tr.sent) == n + dm.MAX_ATTEMPTS
           and [k for _, k in tr.sent[n:]] == ["dewfpga:confirm:dead", "dewfpga:confirm:dead:r2", "dewfpga:confirm:dead:r3"],
           "MAX_ATTEMPTS refusals: three distinct keys, then gives up")

        # Provider quota error -> halt, even with room in the application's own allocation.
        tr.script = [R(429, None, "daily_quota_exceeded", "quota")]
        try:
            send("dewfpga:confirm:quota", to="o@p.test")
            ok(False, "quota halt")
        except dm.BudgetHalt as e:
            ok("account capacity exhausted" in str(e) and {k: s_ for k, s_, _ in ledger(c)}["dewfpga:confirm:quota"] == "failed", "provider quota error: halt, row kept failed")
        tr.script = []

        # ---- the owner-test gate and the campaign
        entry = 16
        OWNER = "owner@example.test"
        built = patch_notes_mail.build(entry)
        n = len(tr.sent)
        try:
            m.owner_test(entry, "stranger@example.test", OWNER)
            ok(False, "relay")
        except dm.MailError as e:
            ok("not a relay" in str(e) and len(tr.sent) == n, "owner-test to a non-owner address refused before any send")
        try:
            m.owner_test(entry, OWNER, None)
            ok(False, "relay")
        except dm.MailError:
            ok(True, "owner-test refused when DEWFPGA_OWNER_EMAIL is unset")
        try:
            m.owner_test(entry, OWNER, OWNER)
            ok(False, "owner unsubscribed")
        except dm.MailError as e:
            ok("subscribe and confirm first" in str(e) and len(tr.sent) == n, "owner-test refused until the owner's own address is subscribed and confirmed")
        try:
            m.campaign(entry)
            ok(False, "gate")
        except dm.RpcError as e:
            ok("gate closed" in str(e) and dm.classify_rpc_error(str(e)) == "gate", "campaign refused: no owner test yet")
        for mail in ("r1@example.test", "r2@example.test", "gone@example.test", OWNER):
            subscribe_confirm(mail)
        c.sql("select public.dewfpga_subscribe('pend@example.test', '2026-10-03', 'site')", role="anon")
        tok = c.value("select unsubscribe_token from public.dewfpga_subscribers where email = 'gone@example.test'")
        c.sql(f"select public.dewfpga_unsubscribe('{tok}')", role="anon")
        ok(int(c.value("select count(*) from public.dewfpga_recipients()", role="service_role")) == 3, "three confirmed recipients (owner included), pending and unsubscribed excluded")

        ot = m.owner_test(entry, "Owner@Example.test", OWNER)
        last_p, last_k = tr.sent[-1]
        own_tok = c.value(f"select unsubscribe_token from public.dewfpga_subscribers where email = '{OWNER}'")
        ok(ot["outcome"] == "sent" and last_p["to"] == ["Owner@Example.test"] and last_p["subject"].startswith("[owner test] dewfpga #16")
           and last_k.startswith(f"dewfpga:owner_test:{built['content_hash']}:{dm.recipient_hash(OWNER)}") and "{{unsubscribe_url}}" not in last_p["html"]
           and last_p["headers"]["List-Unsubscribe"] == f"<https://nosey-dewdrop.github.io/dewfpga/newsletter/unsubscribe/#t={own_tok}>",
           "owner test goes to the owner, keyed by content hash, carrying the owner's own tokened unsubscribe link")
        try:
            m.campaign(entry)
            ok(False, "gate")
        except dm.RpcError as e:
            ok("gate closed" in str(e), "owner test sent but not approved: campaign still refused")
        for note, att, want in (("ok", None, "receipt note"), ("arrived in the inbox, read on phone", None, "unsubscribe not measured")):
            try:
                m.approve(entry, note, att)
                ok(False, "approve")
            except dm.RpcError as e:
                ok(want in str(e) and dm.classify_rpc_error(str(e)) == "gate", f"approve refused: {want}")
        ap = m.approve(entry, "arrived in the inbox, read on phone", "clicked the link in a copy: page said unsubscribed")
        ok(ap["owner_test_ledger_id"] == ot["ledger_id"], "approve with receipt + attested unsubscribe records the sent owner-test row")
        before = len(tr.sent)
        cp = m.campaign(entry)
        ok(cp["sent"] == 3 and cp["recipients"] == 3 and cp["halted"] == 0 and cp["ineligible"] == 0 and len(tr.sent) == before + 3
           and cp["gate"]["unsubscribe_method"] == "attested", f"campaign: {cp}")
        links = [p_["headers"]["List-Unsubscribe"] for p_, _ in tr.sent[-3:]]
        ok(sorted(p_["to"][0] for p_, _ in tr.sent[-3:]) == sorted(["r1@example.test", "r2@example.test", OWNER]) and all("#t=" in l for l in links)
           and len(set(links)) == 3 and all(p_["subject"] == built["subject"] for p_, _ in tr.sent[-3:]),
           "each recipient gets its own tokened unsubscribe link and the patch-notes subject")
        ok(all(p_["headers"]["List-Unsubscribe"].strip("<>") in p_["html"] and p_["headers"]["List-Unsubscribe"].strip("<>") in p_["text"] for p_, _ in tr.sent[-3:]),
           "the unsubscribe URL in the body is the recipient's own")
        cp2 = m.campaign(entry)
        ok(cp2["sent"] == 3 and len(tr.sent) == before + 3, "campaign rerun: every row reused, zero new sends")
        text = open(patch_notes_mail.NOTES, encoding="utf-8").read().replace("### #16 ·", "### #16 · changed", 1)
        built2 = patch_notes_mail.build(entry, text)
        ok(built2["content_hash"] != built["content_hash"] and c.fails(f"select * from public.dewfpga_mail_campaign_gate('{built2['content_hash']}')", "gate closed", role="service_role"),
           "edited patch note: new content hash, gate closed until a new owner test")

        # budget halt mid-campaign leaves the rest unsent, counted as halted
        c.sql("delete from public.dewfpga_mail_approvals; delete from public.dewfpga_mail_ledger where kind = 'campaign'")
        c.sql(f"update public.dewfpga_mail_consumers set daily_cap = {used() + 1} where name = 'dewfpga'")
        m.approve(entry, "arrived in the inbox, read on phone", "clicked the link in a copy: page said unsubscribed")
        before = len(tr.sent)
        cp3 = m.campaign(entry)
        ok(cp3["sent"] == 1 and cp3["halted"] == 2 and len(tr.sent) == before + 1, f"own cap hit mid-campaign: one sent, two halted, nothing skipped silently: {cp3}")
        c.sql("update public.dewfpga_mail_consumers set daily_cap = 40 where name = 'dewfpga'")

        # measured unsubscribe: the owner uses the test mail's own link after the test went out
        c.sql("delete from public.dewfpga_mail_approvals")
        ok(c.value(f"select public.dewfpga_unsubscribe('{own_tok}')", role="anon") == "t", "owner clicks the owner test's unsubscribe link")
        m.approve(entry, "arrived in the inbox, read on phone")
        g = c.rows(f"select unsubscribe_method from public.dewfpga_mail_campaign_gate('{built['content_hash']}')", role="service_role")
        ok(g == [["measured"]], f"approve without attestation passes on the measured unsubscribe: {g}")

        # eligibility is re-read before each send: an unsubscribe during the run is honoured
        c.sql("delete from public.dewfpga_mail_ledger where kind = 'campaign'")
        r2_tok = c.value("select unsubscribe_token from public.dewfpga_subscribers where email = 'r2@example.test'")
        real_send = tr.send

        def unsub_r2_after_first(payload, key):
            res_ = real_send(payload, key)
            c.sql(f"select public.dewfpga_unsubscribe('{r2_tok}')", role="anon")
            return res_
        tr.send = unsub_r2_after_first
        try:
            cp4 = m.campaign(entry)
        finally:
            tr.send = real_send
        ok(cp4["recipients"] == 2 and cp4["sent"] == 1 and cp4["ineligible"] == 1 and tr.sent[-1][0]["to"] == ["r1@example.test"],
           f"r2 unsubscribed while r1 was sending: r2 is skipped as ineligible: {cp4}")

        # confirmations: actual shipped SQL returns usable tokens; no synthetic RPC replacement
        c.sql("select public.dewfpga_subscribe('new1@example.test', '2026-10-03', 'site')", role="anon")
        c.sql("select public.dewfpga_subscribe('new2@example.test', '2026-10-03', 'site')", role="anon")
        pending_actual = rpc.call("dewfpga_pending_confirmations", {"p_limit": 10})
        ok(len(pending_actual) == 3 and all(p_.get("unsubscribe_token") for p_ in pending_actual),
           "actual shipped pending RPC returns a usable unsubscribe token for every confirmation")
        pend_order = [r_[0] for r_ in c.rows("select email from public.dewfpga_pending_confirmations(10)", role="service_role")]
        ok(pend_order[0] == "pend@example.test" and len(pend_order) == 3, f"pending queue is oldest-first: {pend_order}")
        tr.script = [R(503), R(503), R(503)]  # the oldest row gets three unknown answers
        n = len(tr.sent)
        cf = m.confirmations(limit=10, prune=True)
        pend_key = tr.sent[n][1]
        flags = {r_[0]: (r_[1], r_[2]) for r_ in c.rows("select email, confirm_sent_at is not null, confirm_ledger_id is not null from public.dewfpga_subscribers where email in ('pend@example.test','new1@example.test','new2@example.test')", role="service_role")}
        ok(cf["pending"] == 3 and cf["sent"] == 2 and cf["unknown"] == 1 and cf["failed"] == 0 and len(tr.sent) == n + 5,
           f"confirmations: 1 unknown after 3 same-key calls, 2 sent (5 provider calls): {cf}")
        ok(flags["pend@example.test"] == ("f", "f") and flags["new1@example.test"] == ("t", "t") and flags["new2@example.test"] == ("t", "t"),
           f"only really-sent rows are marked sent, each with its ledger id: {flags}")
        last_p, last_k = tr.sent[-1]
        ok("/newsletter/confirm/#t=" in last_p["html"] and last_k.startswith("dewfpga:confirm:") and "48 hours" in last_p["text"]
           and "/newsletter/unsubscribe/#t=" in last_p["headers"]["List-Unsubscribe"],
           "confirm mail carries the fragment token link, the 48-hour note and a tokened unsubscribe header")
        ok(c.value("select confirm_token::text from public.dewfpga_subscribers where email = 'new2@example.test'") in last_p["html"], "the token in the mail is the row's token")
        n = len(tr.sent)
        cf2 = m.confirmations(limit=10)
        ok(cf2["pending"] == 1 and cf2["sent"] == 1 and len(tr.sent) == n + 1 and tr.sent[-1][1] == pend_key
           and tr.sent[-1][0]["to"] == ["pend@example.test"],
           f"second run re-tries the unknown row under its SAME key and marks it: {cf2}")
        ok(c.rows("select email from public.dewfpga_pending_confirmations(10)", role="service_role") == [], "nothing pending afterwards")
        ok(int(c.value("select count(*) from public.dewfpga_mail_ledger where recipient_hash = %s" % ("'" + dm.recipient_hash("pend@example.test") + "'"))) == 1,
           "that address cost exactly one ledger row: an unknown answer never mints a new key")

        # no request ever carries more than one recipient (no address leaks between subscribers)
        ok(all(len(p_["to"]) == 1 for p_, _ in tr.sent), "every request has exactly one recipient")

        # rpc parameter names match the SQL signatures (a wrong name would 404 on PostgREST)
        names = {fn for fn, _ in rpc.calls}
        ok({"dewfpga_mail_reserve", "dewfpga_mail_settle", "dewfpga_mail_approve", "dewfpga_mail_campaign_gate", "dewfpga_recipients",
            "dewfpga_pending_confirmations", "dewfpga_mark_confirm_sent", "dewfpga_newsletter_prune"} <= names, f"rpc functions exercised: {sorted(names)}")

    print(f"passed {PASSED}, failed 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
