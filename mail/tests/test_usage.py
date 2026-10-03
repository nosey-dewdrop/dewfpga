"""Offline account quota boundaries. No provider calls or actual mail."""
import copy
import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quota_usage import AccountUsageGate, UsageDeferred, _NoRedirect


BASE = {"emails": {"daily": {"used": 80, "limit": 100},
                   "monthly": {"used": 2700, "limit": 3000}}}


class Response(io.BytesIO):
    status = 200


class UsageTests(unittest.TestCase):
    def gate(self, *responses):
        self.requests = []
        values = iter(responses or [BASE])

        def open_fake(request, timeout):
            self.requests.append(request)
            value = next(values)
            if isinstance(value, Exception):
                raise value
            return Response(value if isinstance(value, bytes) else json.dumps(value).encode())

        return AccountUsageGate("test-only-key", day_headroom=10,
                                month_headroom=100, opener=open_fake)

    def test_reads_account_not_just_own_ledger(self):
        self.assertEqual(self.gate().check(), {"daily": 10, "monthly": 200})
        req = self.requests[0]
        self.assertEqual(req.full_url, "https://api.resend.com/usage")
        self.assertEqual(req.get_method(), "GET")
        self.assertIsNone(req.data)
        self.assertEqual(req.get_header("Authorization"), "Bearer test-only-key")

    def test_one_slot_includes_cushion_and_recipient_count(self):
        data = copy.deepcopy(BASE)
        data["emails"]["daily"]["used"] = 89
        self.assertEqual(self.gate(data).check()["daily"], 1)
        with self.assertRaises(UsageDeferred):
            self.gate(data).check(recipients=2)

    def test_daily_and_monthly_exhaustion_independently_defer(self):
        for window, used in (("daily", 90), ("daily", 105), ("monthly", 2900)):
            with self.subTest(window=window, used=used):
                data = copy.deepcopy(BASE)
                data["emails"][window]["used"] = used
                with self.assertRaises(UsageDeferred):
                    self.gate(data).check()

    def test_provider_lower_limit_wins(self):
        data = copy.deepcopy(BASE)
        data["emails"]["daily"]["limit"] = 85
        with self.assertRaises(UsageDeferred):
            self.gate(data).check()

    def test_null_or_higher_provider_limit_does_not_expand_policy(self):
        for limit in (None, 10000):
            data = copy.deepcopy(BASE)
            data["emails"]["daily"].update(used=99, limit=limit)
            with self.subTest(limit=limit), self.assertRaises(UsageDeferred):
                self.gate(data).check()

    def test_each_attempt_observes_again_without_cache(self):
        later = copy.deepcopy(BASE)
        later["emails"]["daily"]["used"] = 100
        gate = self.gate(BASE, later)
        gate.check()
        with self.assertRaises(UsageDeferred):
            gate.check()
        self.assertEqual(len(self.requests), 2)

    def test_unknown_schema_and_invalid_counts_never_admit(self):
        cases = [None, [], {}, {"emails": []}]
        for value in (True, -1, 2.5, "0", None):
            data = copy.deepcopy(BASE)
            data["emails"]["daily"]["used"] = value
            cases.append(data)
        for field in ("daily", "monthly"):
            data = copy.deepcopy(BASE)
            del data["emails"][field]["limit"]
            cases.append(data)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(UsageDeferred):
                self.gate(data).check()

    def test_transport_and_decode_failures_do_not_fall_back_to_sending(self):
        for failure in (TimeoutError("test-only-key"), b"not JSON", b"x" * 65537,
                        urllib.error.HTTPError("https://api.resend.com/usage", 429,
                                               "rate limited", {}, None)):
            with self.subTest(failure=type(failure).__name__):
                with self.assertRaises(UsageDeferred) as exc:
                    self.gate(failure).check()
                self.assertNotIn("test-only-key", str(exc.exception))

    def http_error(self, code, body=None):
        fp = io.BytesIO(json.dumps(body).encode()) if body is not None else None
        return urllib.error.HTTPError("https://api.resend.com/usage", code, "error", {}, fp)

    def test_restricted_sending_key_names_the_cause_without_echoing_secrets(self):
        # Resend answers GET /usage with 401 restricted_api_key for a sending_access key
        # (sources/resend-errors.md). The worker must say why it defers, not just "unavailable".
        body = {"statusCode": 401, "name": "restricted_api_key",
                "message": "This API key is restricted to only send emails. echo test-only-key"}
        with self.assertRaises(UsageDeferred) as exc:
            self.gate(self.http_error(401, body)).check()
        text = str(exc.exception)
        self.assertIn("401", text)
        self.assertIn("restricted_api_key", text)
        self.assertIn("full_access", text)
        self.assertIn("deferred", text)
        self.assertNotIn("test-only-key", text)
        self.assertNotIn("restricted to only send", text)
        self.assertNotIn("echo", text)

    def test_other_http_errors_carry_status_and_documented_name_only(self):
        cases = [(403, {"name": "restricted_api_key", "message": "API key is not active"}, "restricted_api_key"),
                 (500, None, None),
                 (503, {"message": "test-only-key leaked"}, None)]
        for code, body, name in cases:
            with self.subTest(code=code):
                with self.assertRaises(UsageDeferred) as exc:
                    self.gate(self.http_error(code, body)).check()
                text = str(exc.exception)
                self.assertIn(str(code), text)
                if name:
                    self.assertIn(name, text)
                if code != 401:
                    self.assertNotIn("full_access", text)
                for secret in ("test-only-key", "not active", "leaked"):
                    self.assertNotIn(secret, text)

    def test_injected_error_names_never_reach_the_message(self):
        bad = ["a" * 65, "Restricted-Key test-only-key", "x\ny", "", 42, {"k": 1}, ["restricted_api_key"],
               "restricted_api_key ", "restricted_api_key\n", "rÿstricted", "RESTRICTED_API_KEY", "../etc", None]
        for name in bad:
            with self.subTest(name=name):
                with self.assertRaises(UsageDeferred) as exc:
                    self.gate(self.http_error(401, {"name": name, "message": "test-only-key"})).check()
                text = str(exc.exception)
                self.assertIn("401", text)
                self.assertNotIn("test-only-key", text)
                self.assertNotIn("\n", text)
                if isinstance(name, str) and name:
                    self.assertNotIn(name, text)
                self.assertLess(len(text), 200)

    def test_authorization_is_not_redirected(self):
        req = urllib.request.Request("https://api.resend.com/usage",
                                     headers={"Authorization": "Bearer test-only-key"})
        self.assertIsNone(_NoRedirect().redirect_request(
            req, None, 302, "redirect", {}, "https://another.example/usage"))

    def test_operator_settings_must_be_explicit_and_valid(self):
        for day, month in ((100, 0), (-1, 0), (True, 0), (0, 3000)):
            with self.subTest(day=day, month=month):
                with self.assertRaises((ValueError, UsageDeferred)):
                    AccountUsageGate("test", day_headroom=day, month_headroom=month)
        with self.assertRaises(ValueError):
            self.gate().check(0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
