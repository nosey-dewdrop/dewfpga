#!/usr/bin/env python3
"""Sender idempotency regressions: one logical mail must never earn two accepted provider keys.

Runs mail/dewfpga_mail.py against the real SQL functions on a private PostgreSQL and a MODELLED
provider (FakeResend below: Resend's documented idempotency store, 24 h, same key + same body =
same message id, concurrent same key = 409 concurrent_idempotent_requests, different body = 409
invalid_idempotent_request). The model is not live evidence: nothing is sent anywhere.

    python3 mail/tests/test_sender_idem.py [--mail-dir DIR]

--mail-dir points at another copy of mail/ (its sql/ and dewfpga_mail.py) so the same scenarios
can be run against the code before a fix; the default is this tree's mail/. Exit status 1 on any
FAIL, 0 only when every scenario passed. S1..S12 are the first correction's scenarios (adapted to the
claim token and dewfpga's own allocation); S13..S24 are the ledger-v2 corrections: early expiry never
slides a row out of the count, fencing (a stale claim's refusal changes nothing, a late acceptance
converges), sticky uncertainty, the provider's concurrent-key 409, the same-key deadline, tokened
unsubscribe on every mail, the owner gate (receipt + measured/attested unsubscribe, supersede) and the
campaign's per-recipient eligibility recheck.

Confirmation and owner flows exercise the shipped 001 migration directly. No
replacement SQL functions are installed to make the sender's expectations pass.
"""
import argparse, glob, hashlib, importlib.util, json, os, socket, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pg_harness  # noqa: E402


class _NoNet(socket.socket):
    def __init__(self, *a, **k):
        raise AssertionError("network use in tests")


socket.socket = _NoNet
socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(AssertionError("network use in tests"))

TO = "student@example.invalid"
UNSUB = "https://example.invalid/newsletter/unsubscribe/#t=00000000-0000-4000-8000-000000000001"
STALE = "00000000-0000-4000-8000-0000000000ff"   # a claim token no claim holds
FAILS = []


def load_mail_module(mail_dir):
    spec = importlib.util.spec_from_file_location("dewfpga_mail_under_test", os.path.join(mail_dir, "dewfpga_mail.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, mail_dir)
    spec.loader.exec_module(mod)
    return mod


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


class Crash(Exception):
    pass


def make_classes(dm):
    class PgRpc(dm.Rpc):
        """The Supabase RPC call shape, run as service_role on the private cluster."""

        def __init__(self, c):
            self.c = c

        def call(self, fn, params):
            args = ", ".join(f"{k} => {lit(v)}" for k, v in params.items())
            q = f"select coalesce(json_agg(t), '[]'::json) from public.{fn}({args}) as t"
            r = self.c.run(q, role="service_role", extra=("-At",))
            if r.returncode != 0:
                msg = next((l.split("ERROR:", 1)[1].strip() for l in r.stderr.splitlines() if "ERROR:" in l), r.stderr)
                raise dm.RpcError(msg)
            rows = json.loads(r.stdout.strip())  # json_agg puts a newline between rows
            if fn in ("dewfpga_mail_settle", "dewfpga_mail_resolve"):
                return rows[0] if rows else None  # json_agg of a scalar function = [true]
            return rows

    class FakeResend(dm.Transport):
        """MODEL of the provider (not Resend itself). script: one action per send call, then 'accept'."""
        TTL = 24.0

        def __init__(self, script=()):
            self.script, self.now = list(script), 0.0
            self.keys, self.in_flight = {}, set()
            self.calls, self.dedup_hits, self.delivered, self.n = [], 0, [], 0
            self.payloads = []
            self.during = None  # callable run while the current key is in flight (interleaving)

        def send(self, payload, key):
            action = self.script.pop(0) if self.script else "accept"
            self.calls.append((key, action))
            self.payloads.append(payload)
            body = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            if key in self.in_flight:
                return dm.SendResult(409, None, "concurrent_idempotent_requests", "another request in progress")
            k = self.keys.get(key)
            if k and self.now - k["t"] < self.TTL:
                if k["body"] != body:
                    return dm.SendResult(409, None, "invalid_idempotent_request", "payload differs")
                self.dedup_hits += 1
                return dm.SendResult(200, k["id"])
            if action == "reject429":
                return dm.SendResult(429, None, "rate_limit_exceeded", "too many requests")
            if action == "reject_conflict":  # the provider holds this key with a body we do not know
                return dm.SendResult(409, None, "invalid_idempotent_request", "payload differs")
            if action == "reject503":  # no answer we can read: the provider may or may not have it
                return dm.SendResult(503, None, "internal_server_error", "unavailable")
            if action == "reject422":
                return dm.SendResult(422, None, "validation_error", "bad field")
            self.in_flight.add(key)
            try:
                if action == "accept_slow" and self.during:
                    fn, self.during = self.during, None
                    fn()
                self.n += 1
                mid = f"msg-{self.n}"
                self.keys[key] = {"t": self.now, "body": body, "id": mid}
                self.delivered.append((key, payload["to"][0], self.now))
            finally:
                self.in_flight.discard(key)
            if action == "accept_lose":
                return dm.SendResult(0, None, None, "TimeoutError: response lost after acceptance")
            if action == "accept_crash":
                raise Crash(key)
            return dm.SendResult(200, mid)

    return PgRpc, FakeResend


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mail-dir", default=os.path.normpath(os.path.join(HERE, "..")))
    a = ap.parse_args()
    mail_dir = os.path.abspath(a.mail_dir)
    dm = load_mail_module(mail_dir)
    PgRpc, FakeResend = make_classes(dm)
    print("sender", dm.__file__, "sha256", hashlib.sha256(open(dm.__file__, "rb").read()).hexdigest())

    c = pg_harness.Cluster().__enter__()
    try:
        for f in sorted(glob.glob(os.path.join(mail_dir, "sql", "*.sql"))):
            r = c.run(open(f, encoding="utf-8").read())
            if r.returncode != 0:
                print(f"migration {f} failed:\n{r.stderr}")
                sys.exit(1)
            print("loaded", os.path.relpath(f, mail_dir))
        cols = set(c.rows("select column_name from information_schema.columns where table_schema='public' and table_name='dewfpga_mail_ledger'", role="postgres") and
                   [r[0] for r in c.rows("select column_name from information_schema.columns where table_schema='public' and table_name='dewfpga_mail_ledger'", role="postgres")])
        ts_cols = [x for x in ("created_at", "settled_at", "first_attempt_at", "last_attempt_at") if x in cols]
        print("ledger timestamp columns:", ", ".join(ts_cols))

        def reset():
            c.sql("delete from public.dewfpga_mail_approvals; delete from public.dewfpga_mail_ledger;"
                  "delete from public.dewfpga_mail_consumers where name <> 'dewfpga';"
                  "delete from public.dewfpga_subscribers;"
                  "update public.dewfpga_mail_consumers set enrolled_at = now(), daily_cap = 95, monthly_cap = 2900;")

        def advance(prov, hours):
            """Move the clock: age every ledger timestamp and the model's key timestamps by the same hours."""
            sets = ", ".join(f"{x} = {x} - interval '{hours} hours'" for x in ts_cols)
            c.sql(f"update public.dewfpga_mail_ledger set {sets}")
            prov.now += hours

        def layers(prov):
            rows = c.rows("select idempotency_key, status, coalesce(message_id,''), "
                          "round(extract(epoch from now() - created_at) / 3600)::int from public.dewfpga_mail_ledger order by id")
            counted = int(c.value("select day_used from public.dewfpga_mail_budget()", role="service_role"))
            return {"db": [f"{k}={s}{'(' + m + ')' if m else ''}@{h}h" for k, s, m, h in rows],
                    "counted_24h": counted,
                    "calls": [f"{k}:{x}" for k, x in prov.calls], "dedup_hits": prov.dedup_hits,
                    "delivered": len(prov.delivered), "accepted_keys": sorted({k for k, _, _ in prov.delivered})}

        def report(name, expected, observed, ok, extra=None):
            if not ok:
                FAILS.append(name)
            print(f"\n[{'PASS' if ok else 'FAIL'}] {name}")
            print(f"  EXPECTED: {expected}")
            for k, v in observed.items():
                print(f"  {k:13}: {v}")
            if extra:
                print(f"  note         : {extra}")

        def mailer(prov, clock=None):
            kw = dict(log=lambda *_: None, sleep=lambda s: None)
            if clock:
                kw["clock"] = clock
            return dm.Mailer(PgRpc(c), prov, "dewfpga <a@example.invalid>", "https://example.invalid", **kw)

        def send(m, base="dewfpga:confirm:1:abc", subject="s"):
            return m._send("confirm", base, TO, subject, "<p>h</p>", "t", UNSUB)

        def halted(fn):
            try:
                return fn(), None
            except dm.BudgetHalt as exc:
                return None, f"BudgetHalt: {exc}"

        def fill(n, consumer="dewfpga", hours_ago=1):
            c.sql("insert into public.dewfpga_mail_ledger (consumer, kind, recipient_hash, idempotency_key, logical_key, status, message_id, "
                  "created_at, first_attempt_at, settled_at, payload_hash) "
                  f"select '{consumer}', 'other', repeat('a', 64), 'fill-' || g, 'fill-' || g, 'sent', 'm-' || g, now() - interval '{hours_ago} hours', "
                  f"now() - interval '{hours_ago} hours', now() - interval '{hours_ago} hours', repeat('b', 64) from generate_series(1, {n}) g")

        def row(key="dewfpga:confirm:1:abc"):
            r = PgRpc(c).call("dewfpga_mail_lookup", {"p_idempotency_key": key})
            return r[0] if r else None

        # ---- S1: provider accepted, the response was lost
        reset(); prov = FakeResend(["accept_lose"]); m = mailer(prov)
        r = send(m); L = layers(prov)
        report("S1 lost response after acceptance", "1 delivery, 1 accepted key, same key retried, row sent",
               {**L, "outcome": r.get("outcome")},
               L["delivered"] == 1 and len(L["accepted_keys"]) == 1 and r.get("outcome") == "sent"
               and all(k.startswith("dewfpga:confirm:1:abc:") is False for k in L["accepted_keys"]))

        # ---- S2: three lost responses in one run, then a second run
        reset(); prov = FakeResend(["accept_lose"] * 3); m = mailer(prov)
        r1 = send(m); L1 = layers(prov)
        r2 = send(m); L = layers(prov)
        report("S2 three lost responses, then rerun", "every retry uses the SAME key (no :r2/:r3), at most SAME_KEY_TRIES calls per run, run 2 is sent, 1 delivery",
               {**L, "run1": r1.get("outcome"), "run2": r2.get("outcome"), "run1_calls": len(L1["calls"])},
               L["delivered"] == 1 and len(L["accepted_keys"]) == 1 and r1.get("outcome") in ("sent", "unknown")
               and r2.get("outcome") == "sent" and len(L1["calls"]) <= dm.SAME_KEY_TRIES
               and all(":r" not in k for k, _ in prov.calls),
               "the model answers the same-key retry with the stored id (Resend's documented dedup), so run 1 already converges to sent")

        # ---- S3: two senders, same logical mail, interleaved while A is in flight
        reset(); prov = FakeResend(["accept_slow"]); mA, mB = mailer(prov), mailer(prov); out = {}
        prov.during = lambda: out.__setitem__("B", halted(lambda: send(mB)))
        out["A"] = send(mA); L = layers(prov)
        report("S3 concurrent same key while in flight", "B makes no provider call (in_flight), A settles sent, 1 delivery, 1 accepted key",
               {**L, "A": out["A"].get("outcome"), "B": out["B"]},
               L["delivered"] == 1 and len(L["accepted_keys"]) == 1 and L["db"][0].startswith("dewfpga:confirm:1:abc=sent")
               and out["A"].get("outcome") == "sent" and len(L["calls"]) == 1
               and out["B"][0] is not None and out["B"][0].get("outcome") == "in_flight")

        # ---- S3b: lease expiry: A crashed after acceptance, B comes after the lease, late A settle
        reset(); prov = FakeResend(["accept_crash"]); mA, mB = mailer(prov), mailer(prov)
        try:
            send(mA); crashed = False
        except Crash:
            crashed = True
        early = send(mB)                      # inside the lease: in_flight, no call
        advance(prov, 0.2)                    # 12 minutes > 5 minute lease
        late = send(mB); L = layers(prov)
        lid = int(c.value("select id from public.dewfpga_mail_ledger limit 1", role="postgres"))
        a_settle = PgRpc(c).call("dewfpga_mail_settle", {"p_ledger_id": lid, "p_claim_token": STALE, "p_status": "sent", "p_message_id": "late-A"})
        mid_after = c.value("select message_id from public.dewfpga_mail_ledger where id = %d" % lid, role="postgres")
        a_settle = a_settle.get("applied") if a_settle else a_settle
        report("S3b lease expiry and late settle", "B inside lease: in_flight, no call; after lease: reuse, dedup, sent; A's late settle is not applied and does not overwrite the message id",
               {**L, "crashed": crashed, "early": early.get("outcome"), "late": late.get("outcome"), "late_settle": a_settle, "message_id": mid_after},
               crashed and early.get("outcome") == "in_flight" and late.get("outcome") == "sent" and L["delivered"] == 1
               and len(L["calls"]) == 2 and a_settle is False and mid_after == "msg-1")

        # ---- S4 control: definite 429 refusal, retried under a derived key through the gates
        reset(); prov = FakeResend(["reject429"]); m = mailer(prov)
        r = send(m); L = layers(prov)
        report("S4 control: 429 then accept", "first key failed (counted), derived key sent, 1 delivery",
               {**L, "outcome": r.get("outcome")},
               L["delivered"] == 1 and r.get("outcome") == "sent" and L["counted_24h"] == 2)

        # ---- S5 control: crash after acceptance, rerun 1 h later
        reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
        try:
            send(m)
        except Crash:
            pass
        advance(prov, 1); r = send(m); L = layers(prov)
        report("S5 control: crash, rerun after 1 h", "same key reused inside the window, dedup, 1 delivery",
               {**L, "outcome": r.get("outcome")},
               L["delivered"] == 1 and r.get("outcome") == "sent" and len(L["accepted_keys"]) == 1)

        # ---- S6: crash, rerun after 25 h (provider key may have expired)
        reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
        try:
            send(m)
        except Crash:
            pass
        advance(prov, 25); calls_before = len(prov.calls)
        r, halt = halted(lambda: send(m)); L = layers(prov)
        report("S6 aged reserved row (25 h)", "ZERO new provider calls, row left for operator reconciliation (outcome unresolved), still 1 delivery",
               {**L, "outcome": r.get("outcome") if r else halt},
               len(prov.calls) == calls_before and L["delivered"] == 1 and r is not None and r.get("outcome") == "unresolved")

        # ---- S6b: the window is measured from the FIRST attempt, not from the last claim
        # attempt 1: crash after acceptance (row reserved). 1 h later a second claim is made through the
        # real RPC and the process dies BEFORE its provider call (no model call). 19.5 h after that
        # (20.5 h after the first attempt) a claim must make no call even though the last claim is recent.
        reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
        try:
            send(m)
        except Crash:
            pass
        advance(prov, 1)
        try:
            payload = dm.build_payload("dewfpga <a@example.invalid>", TO, "s", "<p>h</p>", "t", UNSUB)
            claim2 = PgRpc(c).call("dewfpga_mail_reserve", {"p_consumer": "dewfpga", "p_kind": "confirm",
                                   "p_idempotency_key": "dewfpga:confirm:1:abc", "p_recipient_hash": dm.recipient_hash(TO),
                                   "p_payload_hash": dm.payload_hash(payload), "p_logical_key": "dewfpga:confirm:1:abc"})
            claim2 = claim2[0].get("action") if claim2 else None
        except Exception as exc:  # pre-correction SQL has no payload_hash argument
            claim2 = f"{type(exc).__name__}: {exc}"
        advance(prov, 19.5); calls_mid = len(prov.calls)
        r3, halt3 = halted(lambda: send(m)); L = layers(prov)
        report("S6b window counts from first attempt", "claim at 1 h is allowed to send (crashes before the call); claim at 20.5 h makes no call (unresolved) although the last claim was 19.5 h ago",
               {**L, "claim_at_1h": claim2, "r3": r3.get("outcome") if r3 else halt3},
               claim2 == "send" and len(prov.calls) == calls_mid and r3 is not None and r3.get("outcome") == "unresolved" and L["delivered"] == 1)

        # ---- S7: crash, then the consumer is revoked, rerun 1 h later
        for label, hours in (("S7 revoked consumer, rerun after 1 h", 1), ("S7b revoked consumer, rerun after 25 h", 25)):
            reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
            try:
                send(m)
            except Crash:
                pass
            c.sql("update public.dewfpga_mail_consumers set enrolled_at = null where name = 'dewfpga'")
            advance(prov, hours); r, halt = halted(lambda: send(m)); L = layers(prov)
            report(label, "BudgetHalt before any provider call (calls stay 1)",
                   {**L, "result": r.get("outcome") if r else halt},
                   len(L["calls"]) == 1 and r is None and "not enrolled" in halt)

        # ---- S8: crash, 25 h, own allocation spent and then revoked
        reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
        try:
            send(m)
        except Crash:
            pass
        advance(prov, 25); fill(95)
        rs, hs = halted(lambda: send(m, "dewfpga:confirm:2:new"))
        c.sql("update public.dewfpga_mail_consumers set enrolled_at = null where name = 'dewfpga'")
        rn, hn = halted(lambda: send(m, "dewfpga:confirm:2:new"))
        ro, ho = halted(lambda: send(m)); L = layers(prov)
        report("S8 allocation spent, then revoked: new key and reused key", "spent halts a new key; after revocation both halt before any provider call; still 1 delivery",
               {**L, "new_key": rn.get("outcome") if rn else hn, "reused_key": ro.get("outcome") if ro else ho},
               rs is None and "budget spent" in (hs or "") and rn is None and ro is None
               and "not enrolled" in (hn or "") and "not enrolled" in (ho or "") and len(L["calls"]) == 1 and L["delivered"] == 1)

        # ---- S8b: own allocation at its cap: reused in-window row keeps its counted place, new key halts
        reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
        try:
            send(m)
        except Crash:
            pass
        fill(94); advance(prov, 1)
        rn, hn = halted(lambda: send(m, "dewfpga:confirm:2:new"))
        ro, ho = halted(lambda: send(m)); L = layers(prov)
        report("S8b at cap: in-window reuse honoured, new key refused", "new key: BudgetHalt, no call; reused key: dedup, sent; 1 delivery",
               {**L, "new_key": rn.get("outcome") if rn else hn, "reused_key": ro.get("outcome") if ro else ho},
               rn is None and "budget" in (hn or "") and ro is not None and ro.get("outcome") == "sent" and L["delivered"] == 1)

        # ---- S9 control: own cap 1, lost response then retry
        reset(); c.sql("update public.dewfpga_mail_consumers set daily_cap = 1 where name = 'dewfpga'")
        prov = FakeResend(["accept_lose", "accept"]); m = mailer(prov)
        r, halt = halted(lambda: send(m)); L = layers(prov)
        report("S9 control: own daily cap 1, lost response", "the same key is retried inside the cap (no second row), 1 delivery",
               {**L, "outcome": r.get("outcome") if r else halt},
               L["delivered"] == 1 and r is not None and r.get("outcome") == "sent" and len(L["db"]) == 1)

        # ---- S10: a changed payload cannot reuse an uncertain intent
        reset(); prov = FakeResend(["accept_crash"]); m = mailer(prov)
        try:
            send(m)
        except Crash:
            pass
        advance(prov, 1)
        try:
            r = send(m, subject="s2"); err = None
        except dm.RpcError as exc:
            r, err = None, str(exc)
        L = layers(prov)
        report("S10 payload changed under the same key", "identity mismatch error from the ledger, no provider call",
               {**L, "result": r.get("outcome") if r else err},
               r is None and "identity mismatch" in (err or "") and len(L["calls"]) == 1)

        # ---- S11: provider says the key belongs to another body (unknown prior acceptance)
        reset(); prov = FakeResend(["reject_conflict"]); m = mailer(prov)
        r = send(m); L = layers(prov)
        report("S11 409 invalid_idempotent_request", "settle unknown, no fresh key, 1 call",
               {**L, "outcome": r.get("outcome"), "error": r.get("error")},
               r.get("outcome") == "unknown" and len(L["calls"]) == 1 and L["db"][0].endswith("=unknown@0h") and L["counted_24h"] == 1)

        # ---- S12 control: definite validation refusal is released and not retried
        reset(); prov = FakeResend(["reject422"]); m = mailer(prov)
        r = send(m); L = layers(prov)
        report("S12 control: 422 released", "released, not counted, no retry", {**L, "outcome": r.get("outcome")},
               r.get("outcome") == "released" and len(L["calls"]) == 1 and L["counted_24h"] == 0)

        def raises(fn):
            try:
                return fn(), None
            except (dm.RpcError, dm.MailError) as exc:
                return None, str(exc)

        def reserve_raw(key="dewfpga:confirm:1:abc", logical="dewfpga:confirm:1:abc", phash="c" * 64):
            return PgRpc(c).call("dewfpga_mail_reserve", {"p_consumer": "dewfpga", "p_kind": "confirm", "p_idempotency_key": key,
                                 "p_recipient_hash": dm.recipient_hash(TO), "p_payload_hash": phash, "p_logical_key": logical})[0]

        def settle_raw(lid, tok, status, mid=None):
            return PgRpc(c).call("dewfpga_mail_settle", {"p_ledger_id": lid, "p_claim_token": tok, "p_status": status, "p_message_id": mid})

        def unsub_hdr(payload):
            return payload["headers"]["List-Unsubscribe"]

        # ---- S13: early expiry: unknown at 0 h, accepted at 19 h, still counted at 25 h
        reset(); prov = FakeResend(["reject503"] * 3); m = mailer(prov)
        r1 = send(m); advance(prov, 19)
        r2 = send(m); advance(prov, 6); L = layers(prov)
        report("S13 early expiry does not slide the count", "run 1 unknown (3 same-key calls); run 2 at 19 h same key sent; at 25 h after the first attempt the row still counts (settled 6 h ago)",
               {**L, "run1": r1.get("outcome"), "run2": r2.get("outcome")},
               r1.get("outcome") == "unknown" and r2.get("outcome") == "sent" and len(L["calls"]) == 4
               and all(":r" not in k for k, _ in prov.calls) and L["counted_24h"] == 1 and L["delivered"] == 1)

        # ---- S14: fencing: claim A's late refusal must not touch claim B's row
        reset()
        a = reserve_raw(); tok_a = a["claim_token"]
        c.sql("update public.dewfpga_mail_ledger set last_attempt_at = last_attempt_at - interval '10 minutes'")
        b = reserve_raw(); tok_b = b["claim_token"]
        sa = settle_raw(a["ledger_id"], tok_a, "failed")
        holder = c.value("select claim_token || ' ' || status from public.dewfpga_mail_ledger where id = %d" % a["ledger_id"], role="postgres")
        sb = settle_raw(b["ledger_id"], tok_b, "failed")
        r2 = reserve_raw("dewfpga:confirm:1:abc:r2")
        report("S14 fencing: late refusal from a stale claim", "A's failed is not applied (row stays reserved under B); B's own refusal is recorded unknown (A may have reached the provider); :r2 is unresolved",
               {"A": a["action"], "B": b["action"], "B_uncertain": b["uncertain"], "A_settle": sa, "row_after_A": holder,
                "B_settle": sb, "r2": (r2["action"], r2["reason"])},
               a["action"] == "send" and b["action"] == "send" and tok_a != tok_b and b["uncertain"] is True
               and sa["applied"] is False and holder == f"{tok_b} reserved"
               and sb["applied"] is True and sb["status"] == "unknown" and r2["action"] == "unresolved")

        # ---- S15: the provider's concurrent-key 409, then A's late acceptance
        reset(); prov = FakeResend(["accept_slow"]); mA, mB = mailer(prov), mailer(prov); out = {}

        def b_steals():
            c.sql("update public.dewfpga_mail_ledger set last_attempt_at = last_attempt_at - interval '10 minutes'")
            out["B"] = send(mB)
        prov.during = b_steals
        out["A"] = send(mA); L = layers(prov)
        report("S15 lease stolen while A is in flight: 409 concurrent, then A accepts late", "B gets 409 concurrent x3 on the SAME key and settles unknown; A's late acceptance converges the row to sent; 1 delivery",
               {**L, "A": out["A"].get("outcome"), "B": out["B"].get("outcome"), "B_calls": out["B"].get("calls")},
               out["B"].get("outcome") == "unknown" and out["B"].get("calls") == dm.SAME_KEY_TRIES
               and out["A"].get("outcome") == "sent" and L["delivered"] == 1 and L["db"] == ["dewfpga:confirm:1:abc=sent(msg-1)@0h"])

        # ---- S16: sticky uncertainty through the mailer: a later refusal stays unknown
        reset(); prov = FakeResend(["reject503"] * 3 + ["reject429"]); m = mailer(prov)
        r1 = send(m); advance(prov, 1)
        r2 = send(m); L = layers(prov)
        report("S16 unknown, then a 429 on the same key", "row stays unknown, no :r2 key minted, 4 calls on one key",
               {**L, "run1": r1.get("outcome"), "run2": r2.get("outcome"), "error": r2.get("error")},
               r1.get("outcome") == "unknown" and r2.get("outcome") == "unknown" and len(L["calls"]) == 4
               and all(":r" not in k for k, _ in prov.calls) and len(L["db"]) == 1)

        # ---- S17: deadline checked before every call
        reset(); prov = FakeResend(["reject503"] * 3); T = [0.0]
        orig = prov.send

        def send_then_jump(payload, key):
            res = orig(payload, key)
            T[0] = 1e9
            return res
        prov.send = send_then_jump
        m = mailer(prov, clock=lambda: T[0])
        r1 = send(m); L1 = layers(prov)
        reset(); prov = FakeResend(["reject503"] * 3); m = mailer(prov)
        send(m); advance(prov, 19.99)
        r2 = send(m); L2 = layers(prov)
        report("S17 same-key deadline", "clock passes the deadline after call 1: no call 2; a row 35 s before its window end: zero calls, stays unknown",
               {"run_a_calls": L1["calls"], "run_a": r1.get("outcome"), "run_b_calls": L2["calls"], "run_b": r2.get("outcome"), "db": L2["db"]},
               len(L1["calls"]) == 1 and r1.get("outcome") == "unknown" and len(L2["calls"]) == 3
               and r2.get("outcome") == "unresolved" and r2.get("calls") == 0 and L2["db"][0].startswith("dewfpga:confirm:1:abc=unknown"))

        # ---- S18: aged unknown row (21 h): no provider call, ever
        reset(); prov = FakeResend(["reject503"] * 3); m = mailer(prov)
        send(m); advance(prov, 21)
        r = send(m); L = layers(prov)
        report("S18 unknown row past the 20 h same-key window", "unresolved, no call, no new key", {**L, "outcome": r.get("outcome")},
               r.get("outcome") == "unresolved" and len(L["calls"]) == 3 and len(L["db"]) == 1)

        # ---- S19: a mail without a tokened unsubscribe link is refused before the ledger
        reset(); prov = FakeResend(); m = mailer(prov)
        _, err = raises(lambda: m._send("confirm", "dewfpga:confirm:9:x", TO, "s", "<p>h</p>", "t", "https://example.invalid/u"))
        _, err2 = raises(lambda: m.unsubscribe_url(None)); L = layers(prov)
        report("S19 untokened unsubscribe", "MailError, no ledger row, no call", {**L, "error": err, "unsubscribe_url(None)": err2},
               "tokened unsubscribe" in (err or "") and "no unsubscribe token" in (err2 or "") and not L["calls"] and not L["db"])

        # ---- S21: actual shipped 001: tokened confirmation and generation-fenced completion
        reset(); prov = FakeResend(["accept", "accept_slow"]); m = mailer(prov)
        c.sql("insert into public.dewfpga_subscribers (email, consent_text_version, confirm_requested_at) values "
              "('a1@example.invalid', 'v1', now() - interval '2 minutes'), ('a2@example.invalid', 'v1', now() - interval '1 minute')")
        tok1 = c.value("select unsubscribe_token from public.dewfpga_subscribers where email = 'a1@example.invalid'", role="postgres")
        prov.during = lambda: c.sql("update public.dewfpga_subscribers set confirm_token = gen_random_uuid() where email = 'a2@example.invalid'")
        r = m.confirmations(); L = layers(prov)
        marks = c.rows("select email, confirm_sent_at is not null, confirm_ledger_id is not null from public.dewfpga_subscribers order by email", role="postgres")
        report("S21 confirmations (shipped 001): tokened header, stale mark", "a1 sent, header carries a1's unsubscribe token, marked; a2's request changed in flight: accepted, mark refused -> stale",
               {**L, "result": r, "a1_header": unsub_hdr(prov.payloads[0]), "marks": marks},
               r["sent"] == 1 and r["stale"] == 1 and f"#t={tok1}>" in unsub_hdr(prov.payloads[0])
               and f"#t={tok1}" in prov.payloads[0]["text"] and marks == [["a1@example.invalid", "t", "t"], ["a2@example.invalid", "f", "f"]])

        # ---- S22: the owner gate: subscribe first, receipt, measured unsubscribe
        reset(); prov = FakeResend(); m = mailer(prov)
        OWNER = "owner@example.invalid"
        _, e_nosub = raises(lambda: m.owner_test(16, OWNER, OWNER))
        c.sql(f"insert into public.dewfpga_subscribers (email, consent_text_version, confirm_token, confirmed_at) values ('{OWNER}', 'v1', null, now())")
        otok = c.value(f"select unsubscribe_token from public.dewfpga_subscribers where email = '{OWNER}'", role="postgres")
        ot = m.owner_test(16, OWNER, OWNER)
        _, e_gate0 = raises(lambda: m.campaign(16))
        _, e_short = raises(lambda: m.approve(16, "ok"))
        _, e_unmeasured = raises(lambda: m.approve(16, "arrived in the inbox, read on phone"))
        PgRpc(c).call("dewfpga_unsubscribe", {"p_token": otok})
        ap1, e_ap1 = raises(lambda: m.approve(16, "arrived in the inbox, read on phone"))
        gate1, e_gate1 = raises(lambda: PgRpc(c).call("dewfpga_mail_campaign_gate", {"p_content_hash": ot["content_hash"]}))
        report("S22 owner gate: subscription, receipt, measured unsubscribe", "owner_test refused before subscribing; tokened header; short note refused; no unsubscribe -> refused; after the owner's unsubscribe: measured, gate open",
               {"no_sub": e_nosub, "owner_test": ot.get("outcome"), "header": unsub_hdr(prov.payloads[0]), "gate_before": e_gate0,
                "short_note": e_short, "unmeasured": e_unmeasured, "approve": ap1 or e_ap1, "gate": gate1 or e_gate1},
               "subscribe and confirm first" in (e_nosub or "") and ot.get("outcome") == "sent"
               and f"#t={otok}>" in unsub_hdr(prov.payloads[0]) and "gate closed" in (e_gate0 or "")
               and "receipt note" in (e_short or "") and "unsubscribe not measured" in (e_unmeasured or "")
               and ap1 and ap1["owner_test_ledger_id"] == ot["ledger_id"]
               and gate1 and gate1[0]["unsubscribe_method"] == "measured")

        # ---- S23: a newer owner test supersedes the approval; attested path
        c.sql(f"update public.dewfpga_subscribers set unsubscribed_at = null, unsubscribe_token = gen_random_uuid(), confirmed_at = now() where email = '{OWNER}'")
        ot2 = m.owner_test(16, OWNER, OWNER)
        _, e_sup = raises(lambda: PgRpc(c).call("dewfpga_mail_campaign_gate", {"p_content_hash": ot["content_hash"]}))
        _, e_noatt = raises(lambda: m.approve(16, "second test arrived too"))
        m.approve(16, "second test arrived too", "clicked unsubscribe in the mail; the page said unsubscribed")
        gate2, e_gate2 = raises(lambda: PgRpc(c).call("dewfpga_mail_campaign_gate", {"p_content_hash": ot["content_hash"]}))
        report("S23 newer owner test supersedes; attested unsubscribe", "new row for the new token; gate closed until re-approved; re-approve needs an unsubscribe check; attested opens it",
               {"ot2": (ot2.get("outcome"), ot2.get("ledger_id")), "superseded": e_sup, "no_attestation": e_noatt, "gate": gate2 or e_gate2},
               ot2.get("outcome") == "sent" and ot2.get("ledger_id") != ot.get("ledger_id") and "gate closed" in (e_sup or "")
               and "unsubscribe not measured" in (e_noatt or "") and gate2 and gate2[0]["owner_test_ledger_id"] == ot2["ledger_id"]
               and gate2[0]["unsubscribe_method"] == "attested")

        # ---- S24: campaign rechecks eligibility right before each send
        c.sql("insert into public.dewfpga_subscribers (email, consent_text_version, confirm_token, confirmed_at) values "
              "('r1@example.invalid', 'v1', null, now() - interval '2 hours'), ('r2@example.invalid', 'v1', null, now() - interval '1 hour')")
        prov.script = ["accept_slow"]
        prov.during = lambda: PgRpc(c).call("dewfpga_unsubscribe", {"p_token": c.value(
            "select unsubscribe_token from public.dewfpga_subscribers where email = 'r2@example.invalid'", role="postgres")})
        n0 = len(prov.calls)
        res = m.campaign(16)
        sent_to = [p_["to"][0] for p_ in prov.payloads[n0:]]
        tokened = all(f"#t={c.value(chr(39).join(['select unsubscribe_token from public.dewfpga_subscribers where email = ', to, '']), role='postgres')}>" in unsub_hdr(p_)
                      for p_, to in zip(prov.payloads[n0:], sent_to))
        report("S24 campaign eligibility recheck", "r2 unsubscribes while r1's mail is in flight: r2 is not sent (ineligible); r1 and owner sent with their own unsubscribe tokens",
               {"result": res, "sent_to": sent_to, "own_tokens": tokened},
               res["sent"] == 2 and res["ineligible"] == 1 and sent_to == ["r1@example.invalid", OWNER] and tokened)
    finally:
        c.__exit__(None, None, None)

    print()
    if FAILS:
        print(f"FAILED {len(FAILS)}: " + "; ".join(FAILS))
        sys.exit(1)
    print("sender idempotency: all scenarios passed (provider MODELLED, nothing sent)")


if __name__ == "__main__":
    main()
