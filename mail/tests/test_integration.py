"""Actual migrations + sender + usage admission; no real provider or Auth calls."""
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dewfpga_mail as dm
from quota_usage import AccountUsageGate
import pg_harness
from test_sender_idem import make_classes, TO, UNSUB

PgRpc, FakeResend = make_classes(dm)


class Response(io.BytesIO):
    status = 200


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cluster = pg_harness.Cluster()
        cls.c = cls.cluster.__enter__()
        try:
            cls.c.load_migrations()
        except BaseException:
            cls.cluster.__exit__(*sys.exc_info())
            raise

    @classmethod
    def tearDownClass(cls):
        cls.cluster.__exit__(None, None, None)

    def setUp(self):
        self.c.sql("delete from public.dewfpga_mail_approvals; delete from public.dewfpga_mail_ledger; "
                   "delete from public.dewfpga_subscribers; "
                   "update public.dewfpga_mail_consumers set enrolled_at=now(), daily_cap=95, monthly_cap=2900;")

    def gate(self, *daily_uses):
        values = iter(daily_uses)
        self.usage_requests = []

        def observed(req, timeout):
            self.usage_requests.append(req.full_url)
            used = next(values)
            if isinstance(used, Exception):
                raise used
            return Response(json.dumps({"emails": {
                "daily": {"used": used, "limit": 100},
                "monthly": {"used": 100, "limit": 3000}}}).encode())

        return AccountUsageGate("test-only", day_headroom=10, month_headroom=100, opener=observed)

    def mailer(self, script=(), gate=None):
        self.provider = FakeResend(script)
        return dm.Mailer(PgRpc(self.c), self.provider, "test <sender@example.invalid>",
                         "https://example.invalid", log=lambda *_: None, sleep=lambda _: None,
                         usage_gate=gate)

    def send(self, mailer):
        return mailer._send("confirm", "integration-intent", TO, "subject", "html", "text", UNSUB)

    def test_exhausted_account_makes_no_claim_and_no_provider_call(self):
        mailer = self.mailer(gate=self.gate(98))
        with self.assertRaises(dm.BudgetHalt):
            self.send(mailer)
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.c.value("select count(*) from public.dewfpga_mail_ledger"), "0")

    def test_usage_outage_never_falls_back_to_sending(self):
        mailer = self.mailer(gate=self.gate(TimeoutError()))
        with self.assertRaises(dm.BudgetHalt):
            self.send(mailer)
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.c.value("select count(*) from public.dewfpga_mail_ledger"), "0")

    def test_derived_retry_observes_external_consumption_before_new_claim(self):
        mailer = self.mailer(["reject429"], self.gate(80, 98))
        with self.assertRaises(dm.BudgetHalt):
            self.send(mailer)
        self.assertEqual(len(self.usage_requests), 2)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(self.c.rows("select idempotency_key,status from public.dewfpga_mail_ledger"),
                         [["integration-intent", "failed"]])

    def test_same_claim_unknown_is_not_erased_by_later_refusal(self):
        for refusal in ("reject429", "reject422"):
            with self.subTest(refusal=refusal):
                self.setUp()
                result = self.send(self.mailer(["reject503", refusal]))
                self.assertEqual(result["outcome"], "unknown")
                self.assertEqual({k for k, _ in self.provider.calls}, {"integration-intent"})
                self.assertEqual(self.c.rows("select status,uncertain from public.dewfpga_mail_ledger"),
                                 [["unknown", "t"]])

    def test_definite_acceptance_resolves_same_claim_uncertainty(self):
        result = self.send(self.mailer(["reject503", "accept"]))
        self.assertEqual(result["outcome"], "sent")
        self.assertEqual({k for k, _ in self.provider.calls}, {"integration-intent"})

    def test_actual_confirmation_sql_supplies_token_and_records_generation(self):
        self.c.sql("select public.dewfpga_subscribe('confirmed@example.invalid','test-consent')", role="anon")
        token = self.c.value("select unsubscribe_token from public.dewfpga_subscribers")
        result = self.mailer(gate=self.gate(80)).confirmations()
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["skipped"], 0)
        payload = self.provider.payloads[0]
        self.assertIn("#t=" + token, payload["headers"]["List-Unsubscribe"])
        self.assertIn("#t=" + token, payload["text"])
        self.assertEqual(self.c.value("select confirm_sent_at is not null from public.dewfpga_subscribers"), "t")

    def test_fresh_consent_conflict_does_not_resend_or_block_later_recipients(self):
        def subscribe(email):
            self.c.sql(f"select public.dewfpga_subscribe('{email}','test-consent')", role="anon")
            token = self.c.value(f"select confirm_token from public.dewfpga_subscribers where email='{email}'")
            self.c.sql(f"update public.dewfpga_subscribers set confirm_sent_at=now() where email='{email}'")
            self.c.sql(f"select public.dewfpga_confirm('{token}')", role="anon")

        for prior_status in ("sent", "unknown", "released", "failed"):
            with self.subTest(prior_status=prior_status):
                self.setUp()
                subscribe("owner@example.invalid")
                subscribe("student@example.invalid")
                mailer = self.mailer()
                mailer.owner_test(16, "owner@example.invalid", "owner@example.invalid")
                mailer.approve(16, "offline fixture receipt only", "offline fixture manual exit check")
                if prior_status == "unknown":
                    self.provider.script = ["accept", "reject503", "reject503", "reject503"]
                elif prior_status == "released":
                    self.provider.script = ["accept", "reject422"]
                elif prior_status == "failed":
                    self.provider.script = ["accept", "reject429", "reject429", "reject429"]
                first = mailer.campaign(16)
                self.assertEqual(first[prior_status], 2 if prior_status == "sent" else 1)
                rhash = dm.recipient_hash("student@example.invalid")
                old = self.c.rows(f"select idempotency_key,payload_hash,status from public.dewfpga_mail_ledger where kind='campaign' and recipient_hash='{rhash}'")
                token = self.c.value("select unsubscribe_token from public.dewfpga_subscribers where email='student@example.invalid'")
                self.c.sql(f"select public.dewfpga_unsubscribe('{token}')", role="anon")
                subscribe("student@example.invalid")
                subscribe("later@example.invalid")
                before = len(self.provider.calls)
                result = mailer.campaign(16)
                self.assertEqual(result["conflicted"], 1)
                self.assertEqual(result["sent"], 2)  # old owner acceptance + the new recipient
                self.assertEqual(len(self.provider.calls) - before, 1)
                self.assertEqual(self.provider.payloads[-1]["to"], ["later@example.invalid"])
                self.assertEqual(self.c.rows(f"select idempotency_key,payload_hash,status from public.dewfpga_mail_ledger where kind='campaign' and recipient_hash='{rhash}'"), old)

    def test_live_sender_requires_explicit_headroom_and_installs_observer(self):
        env = {"DEWFPGA_MAIL_LIVE": "1", "RESEND_API_KEY": "test-only", "SUPABASE_SERVICE_KEY": "test-only",
               "SUPABASE_URL": "https://project.invalid", "MAIL_FROM": "sender@example.invalid",
               "SITE_URL": "https://example.invalid"}
        for cmd in ("confirmations", "owner-test", "campaign"):
            args = SimpleNamespace(live=True, cmd=cmd)
            with self.subTest(cmd=cmd), self.assertRaises(dm.MailError):
                dm.make_mailer(args, env)
            configured = dict(env, DEWFPGA_MAIL_HEADROOM_DAY="10", DEWFPGA_MAIL_HEADROOM_MONTH="100")
            mailer, mode = dm.make_mailer(args, configured)
            self.assertEqual(mode, "live")
            self.assertIsInstance(mailer.usage_gate, AccountUsageGate)
        # Construction makes no network request. Status can inspect the own
        # allocation before the operator has chosen account headroom.
        mailer, _ = dm.make_mailer(SimpleNamespace(live=True, cmd="status"), env)
        self.assertIsNone(mailer.usage_gate)


if __name__ == "__main__":
    unittest.main(verbosity=2)
