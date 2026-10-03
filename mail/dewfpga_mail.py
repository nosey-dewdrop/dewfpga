"""dewfpga mail: confirmation mails (#24) and the patch-notes campaign behind the owner-test gate (#25).

    python3 mail/dewfpga_mail.py status                       budget as the ledger sees it (dry-run: no database)
    python3 mail/dewfpga_mail.py preview-patch-notes --entry N --out DIR
    python3 mail/dewfpga_mail.py confirmations                 pending double opt-in mails (dry-run prints, sends nothing)
    python3 mail/dewfpga_mail.py owner-test --entry N --to OWNER
    python3 mail/dewfpga_mail.py approve --entry N --note RECEIPT [--unsubscribe-attestation TEXT]
    python3 mail/dewfpga_mail.py campaign --entry N

CI exercises only offline fixtures; no deploy or default action sends mail. The default is a dry run against no
database and no provider. A live run needs ALL of: the --live flag, DEWFPGA_MAIL_LIVE=1,
RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, MAIL_FROM, SITE_URL and (for owner-test)
DEWFPGA_OWNER_EMAIL. Live sends also require explicit DEWFPGA_MAIL_HEADROOM_DAY and
DEWFPGA_MAIL_HEADROOM_MONTH. The live path has not been verified against real services.

Scope: the ledger (mail/sql/002) bounds dewfpga's OWN allocation of the Resend account (consumer
'dewfpga', operator-set daily_cap/monthly_cap). dewsletter's mail and Supabase Auth's mail on the same
account do not reserve here and are not bounded by it; nothing here guarantees Auth any headroom. An
account-wide usage preflight runs before each ledger claim on the live sending path. If usage cannot
be read, is malformed, or lacks the configured cushion, admission is deferred before any claim/send.
This observation cannot reserve capacity against concurrent external senders; provider quota refusals
remain authoritative. Same-key retries within a claim are bounded, not atomic with account usage.

Every mail is one logical request with one idempotency key, reserved in the ledger BEFORE the
provider is called and settled after with the claim's token. The ledger binds the key to the
exact request body (sha256 of the canonical JSON: from, to, subject, html, text, headers) so a
retry is a retry of the same mail, never of a changed one. Every mail (confirmation and owner test
included) carries a tokened unsubscribe link and List-Unsubscribe header; a mail without one is refused.

What a provider answer means, and what the code does with it:
  accepted   2xx with a message id: settle sent.
  unknown    lost response, 5xx, 2xx without id, 409 "another request with this key is in flight",
             or an unparsable answer: the provider MAY have accepted. Retry the SAME key, bounded
             (SAME_KEY_TRIES calls with BACKOFF seconds between, and never a call later than
             DEADLINE_MARGIN before the end of the ledger's same-key window), then settle `unknown`.
             The row stays counted. No new key is ever minted for an unresolved intent: a later run
             may re-claim the same key only inside the ledger's same-key window (20 h after the first
             attempt, conservative against Resend's documented 24 h idempotency store) and claim
             bound; after that the ledger answers `unresolved`, the sender makes ZERO provider calls
             and the operator reconciles the row against the provider log (dewfpga_mail_resolve).
  conflict   409 invalid_idempotent_request: the provider holds this key with another body. Our
             ledger says the body is ours, so the provider's prior acceptance is unknown to us:
             settle `unknown`, stop, never mint a fresh key.
  quota      the provider's own quota names: settle failed (or unknown if an earlier try was
             uncertain), keep it counted and halt the run. Other account activity can exhaust
             capacity even when this application's own ledger is within its allocation.
  refused    429 rate_limit_exceeded (not a quota): the provider documents it as "request not
             processed". Settle failed (counted anyway, we cannot verify the claim), and only when
             the ledger confirms `failed` (no earlier claim of the row is uncertain; an uncertain row
             settles `unknown` instead; a refusal after an unknown try of the same claim settles
             `unknown` too) reserve a NEW derived key, bounded by MAX_ATTEMPTS, through
             the full gates again. The ledger itself refuses a new key while any earlier key of the
             same logical mail is uncertain. Before the next key the sender WAITS (the answer's
             retry-after when it is a sane number of seconds, else BACKOFF per key, at most
             REFUSAL_WAIT_MAX): the rate limit is per team, 10 rps, shared with dewsletter, and three
             keys fired within milliseconds would burn every attempt on the same burst.
  released   4xx validation (400/403/404/405/422): the request itself is wrong; settle released (not
             counted), no retry: the same body would be refused again.

The same-key retry gives "at most one provider acceptance per key inside the provider's idempotency
window", as documented by the provider and modelled in the tests. It is NOT exactly-once delivery:
provider behaviour is mocked here, and nothing below is live evidence. Provider acceptance is not
inbox delivery: the #25 approval needs the owner's receipt note and a measured (or attested)
unsubscribe from that owner test."""
import argparse, hashlib, json, os, re, subprocess, sys, time, urllib.error, urllib.request, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import patch_notes_mail  # noqa: E402
from quota_usage import AccountUsageGate, UsageDeferred  # noqa: E402

USER_AGENT = "dewfpga-mail/1.0 (+https://github.com/nosey-dewdrop/dewfpga)"
RESEND_ENDPOINT = "https://api.resend.com/emails"
CONSUMER = "dewfpga"
MAX_ATTEMPTS = 3          # fresh derived keys after definite refusals (429), per logical mail
SAME_KEY_TRIES = 3        # provider calls with the SAME key per claim when the answer is unknown
BACKOFF = (1.0, 3.0)      # seconds between same-key tries; also the wait before the next key after a 429
REFUSAL_WAIT_MAX = 60.0   # seconds: the longest wait after a 429 refusal, whatever retry-after says
DEADLINE_MARGIN = 60      # seconds before the ledger's same-key window ends: no call after this
LIVE_ENV = ("RESEND_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "MAIL_FROM", "SITE_URL")
# provider names that mean our ledger under-counted: stop the run, keep the row as failed
PROVIDER_QUOTA_ERRORS = frozenset({"daily_quota_exceeded", "monthly_quota_exceeded", "email_above_quota"})
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class MailError(Exception):
    pass


class BudgetHalt(MailError):
    """The shared budget refused; nothing was sent for this and later recipients."""


class RpcError(MailError):
    def __init__(self, message, code=None, http=None):
        super().__init__(message)
        self.code, self.http = code, http


def recipient_hash(email):
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def classify_rpc_error(message):
    """The ledger's own refusals, by their message text (the SQL raises these)."""
    m = message.lower()
    if "budget" in m or "daily cap" in m or "not enrolled" in m:
        return "budget"
    if "gate closed" in m or "no sent owner-test" in m or "unsubscribe not measured" in m or "receipt" in m:
        return "gate"
    return "other"


# ------------------------------------------------------------------ database

class Rpc:
    """call(fn, params) -> the function's JSON result (list of rows or a scalar)."""

    def call(self, fn, params):
        raise NotImplementedError


class SupabaseRpc(Rpc):
    """POST {url}/rest/v1/rpc/{fn} with the service key. Live only; UNVERIFIED here."""

    def __init__(self, url, service_key, timeout=30):
        if not url.startswith("https://") or not service_key:
            raise MailError("SUPABASE_URL must be https and SUPABASE_SERVICE_KEY set")
        self.url, self.key, self.timeout = url.rstrip("/"), service_key, timeout

    def call(self, fn, params):
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{fn}", data=json.dumps(params).encode(), method="POST",
            headers={"apikey": self.key, "Authorization": f"Bearer {self.key}",
                     "Content-Type": "application/json", "Accept": "application/json",
                     "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            try:
                body = json.loads(raw)
                raise RpcError(body.get("message") or raw, body.get("code"), exc.code) from None
            except (ValueError, AttributeError):
                raise RpcError(raw or str(exc), None, exc.code) from None
        return json.loads(raw) if raw.strip() else None


class NullRpc(Rpc):
    """Dry run: there is no database. Reads answer empty, writes are refused."""

    def call(self, fn, params):
        if fn in ("dewfpga_pending_confirmations", "dewfpga_recipients"):
            return []
        if fn == "dewfpga_mail_budget":
            return [{"day_used": None, "note": "dry-run: no database"}]
        raise RpcError(f"dry-run: {fn} needs a database (use --live)")


# ------------------------------------------------------------------ provider

def retry_after_seconds(headers):
    """A 429 answer's retry-after as seconds, only when it is a plain number in (0, REFUSAL_WAIT_MAX]; else None."""
    try:
        value = float(str(headers.get("Retry-After", "")).strip())
    except (AttributeError, ValueError, TypeError):
        return None
    return value if 0 < value <= REFUSAL_WAIT_MAX else None  # nan and inf fail the comparison too


def refusal_wait(attempt, retry_after):
    """Seconds to wait after the `attempt`-th key was refused (429), before the next derived key."""
    if isinstance(retry_after, (int, float)) and not isinstance(retry_after, bool) and 0 < retry_after <= REFUSAL_WAIT_MAX:
        return float(retry_after)
    return min(float(BACKOFF[min(attempt - 1, len(BACKOFF) - 1)]), REFUSAL_WAIT_MAX)


class SendResult:
    def __init__(self, status, message_id=None, name=None, message="", retry_after=None):
        self.status, self.message_id, self.name, self.message = status, message_id, name, message
        self.retry_after = retry_after  # seconds the provider asked us to wait (429 only), already sanity-checked

    def classify(self):
        """'accepted' | 'unknown' | 'conflict' | 'quota' | 'refused' | 'released' (see module docstring)."""
        if self.name in PROVIDER_QUOTA_ERRORS:
            return "quota"
        if 200 <= self.status < 300:
            return "accepted" if self.message_id else "unknown"
        if self.status == 409:
            return "conflict" if self.name == "invalid_idempotent_request" else "unknown"
        if self.status == 429:
            return "refused"
        if self.status in (400, 403, 404, 405, 422):
            return "released"
        return "unknown"  # 0 (no answer), 5xx, anything else: may have been accepted

    def outcome(self):
        """The ledger status this answer settles to; 'retry' for an unknown answer that is tried again."""
        return {"accepted": "sent", "quota": "failed", "refused": "failed", "released": "released",
                "conflict": "unknown", "unknown": "unknown"}[self.classify()]


class Transport:
    def send(self, payload, idempotency_key):
        raise NotImplementedError


class ResendTransport(Transport):
    """POST https://api.resend.com/emails. Live only; UNVERIFIED here (no key, never run)."""

    def __init__(self, api_key, timeout=30):
        if not api_key:
            raise MailError("RESEND_API_KEY is not set")
        self.api_key, self.timeout = api_key, timeout

    def send(self, payload, idempotency_key):
        req = urllib.request.Request(
            RESEND_ENDPOINT, data=json.dumps(payload).encode(), method="POST",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json",
                     "Idempotency-Key": idempotency_key, "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode())
                return SendResult(resp.status, body.get("id") if isinstance(body, dict) else None)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            name, message = None, raw
            try:
                parsed = json.loads(raw)
                name, message = parsed.get("name"), parsed.get("message") or raw
            except ValueError:
                pass
            retry_after = retry_after_seconds(exc.headers) if exc.code == 429 else None
            return SendResult(exc.code, None, name, message, retry_after)
        except Exception as exc:  # URLError, timeout, socket
            return SendResult(0, None, None, f"{type(exc).__name__}: {exc}")


class DryRunTransport(Transport):
    """Prints the envelope, keeps the payload, returns no id: nothing is ever 'sent'."""

    def __init__(self, out=sys.stdout):
        self.out, self.payloads = out, []

    def send(self, payload, idempotency_key):
        self.payloads.append(payload)
        print(f"dry-run: would POST {len(payload['to'])} recipient(s), subject {payload['subject']!r}, "
              f"key {idempotency_key}", file=self.out)
        return SendResult(0, None, "dry_run", "dry-run: not sent")


# -------------------------------------------------------------------- mailer

def build_payload(mail_from, to, subject, html, text, unsub_url):
    if not _EMAIL_RE.match(to):
        raise MailError(f"refusing address {to!r}")
    return {"from": mail_from, "to": [to], "subject": subject, "html": html, "text": text,
            "headers": {"List-Unsubscribe": f"<{unsub_url}>"}}


def payload_hash(payload):
    """sha256 of the canonical request body: the identity the ledger binds the key to."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def key_variant(base, attempt):
    return base if attempt == 1 else f"{base}:r{attempt}"


class Mailer:
    def __init__(self, rpc, transport, mail_from, site_url, log=print, sleep=time.sleep, clock=time.monotonic,
                 usage_gate=None):
        self.rpc, self.transport, self.mail_from = rpc, transport, mail_from
        self.site_url, self.log, self.sleep, self.clock = site_url.rstrip("/"), log or (lambda *_: None), sleep, clock
        self.usage_gate = usage_gate

    # ---- the one throat
    def _reserve(self, kind, key, rhash, phash, content_hash, logical_key):
        try:
            rows = self.rpc.call("dewfpga_mail_reserve", {
                "p_consumer": CONSUMER, "p_kind": kind, "p_idempotency_key": key,
                "p_recipient_hash": rhash, "p_payload_hash": phash, "p_content_hash": content_hash,
                "p_logical_key": logical_key})
        except RpcError as exc:
            if classify_rpc_error(str(exc)) == "budget":
                raise BudgetHalt(str(exc)) from None
            raise
        return rows[0]

    def _settle(self, ledger_id, claim_token, status, message_id=None):
        """Settle with this claim's token and CHECK the answer: the caller reports the status the
        ledger holds afterwards, never its own guess. Not applied = a stale claim (another claim took
        the row, or it was already settled); an uncertain row turns a refusal into `unknown`."""
        rows = self.rpc.call("dewfpga_mail_settle", {"p_ledger_id": ledger_id, "p_claim_token": claim_token,
                                                    "p_status": status, "p_message_id": message_id})
        row = (rows[0] if rows else {}) if isinstance(rows, list) else (rows or {})
        got = row.get("status") or "unresolved"
        if not row.get("applied"):
            return got, row.get("message_id"), f"stale claim: settle {status} not applied; ledger says {got!r}"
        if got != status:
            return got, row.get("message_id"), f"settle {status} recorded as {got!r}: an earlier claim of this key is uncertain"
        return got, row.get("message_id"), None

    def _send(self, kind, base_key, to, subject, html, text, unsub_url, content_hash=None):
        """One logical mail. Returns {"outcome": sent|unknown|unresolved|in_flight|failed|released, ...}.
        Raises BudgetHalt when the ledger (or the provider's quota) says stop."""
        if "#t=" not in (unsub_url or "") or unsub_url.endswith("#t="):
            raise MailError("every mail needs a tokened unsubscribe link")
        payload = build_payload(self.mail_from, to, subject, html, text, unsub_url)
        rhash, phash = recipient_hash(to), payload_hash(payload)
        last = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            key = key_variant(base_key, attempt)
            # Observe before claiming: a deferred admission must not create an
            # uncertain ledger row for a provider call that never happened.
            # This is a best-effort account cushion, not a cross-service lock.
            if self.usage_gate is not None:
                try:
                    self.usage_gate.check(recipients=1)
                except UsageDeferred as exc:
                    raise BudgetHalt(str(exc)) from None
            row = self._reserve(kind, key, rhash, phash, content_hash, base_key)
            ledger_id, action = row["ledger_id"], row["action"]
            base = {"ledger_id": ledger_id, "key": key, "reused": row["reused"], "claims": row["attempts"]}
            if action == "sent":
                return {"outcome": "sent", "message_id": row["message_id"], "calls": 0, **base}
            if action in ("in_flight", "unresolved"):
                self.log(f"  {key}: {action}: {row.get('reason')}")
                return {"outcome": action, "message_id": row["message_id"], "calls": 0, "error": row.get("reason"), **base}
            if action == "spent":
                if row["status"] == "released":
                    return {"outcome": "released", "message_id": None, "calls": 0, "error": row.get("reason"), **base}
                last = {"outcome": "failed", "message_id": None, "calls": 0, "error": row.get("reason"), **base}
                continue  # a definite refusal under this key; the ledger decides whether the next key may pass
            assert action == "send", action
            token = row["claim_token"]
            deadline = self.clock() + float(row["seconds_left"]) - DEADLINE_MARGIN
            calls, result, uncertain = 0, None, False
            for n in range(SAME_KEY_TRIES):
                if n:
                    self.sleep(BACKOFF[min(n - 1, len(BACKOFF) - 1)])
                if self.clock() >= deadline:
                    self.log(f"  {key}: same-key window ends; no further call")
                    break
                calls += 1
                result = self.transport.send(payload, key)
                if result.classify() != "unknown":
                    break
                uncertain = True
                self.log(f"  {key}: try {n + 1}/{SAME_KEY_TRIES} unknown ({result.status} {result.name or ''} {result.message[:80]})")
            if result is None:
                # no call under this claim: hand the row back (the ledger keeps it unknown if uncertain)
                status, mid, err = self._settle(ledger_id, token, "released")
                return {"outcome": "unresolved" if status != "released" else "released", "message_id": mid, "calls": 0,
                        "error": "same-key window ends before a call" + (f"; {err}" if err else ""), **base}
            cls = result.classify()
            want = result.outcome()
            if uncertain and want != "sent":
                # an earlier try of this key may have been accepted: a later refusal or 4xx proves nothing
                cls, want = "unknown", "unknown"
            status, mid, err = self._settle(ledger_id, token, want, result.message_id)
            if result.classify() == "quota":
                raise BudgetHalt(f"provider says {result.name}: account capacity exhausted; defer remaining mail")
            out = {"outcome": status, "message_id": mid, "calls": calls,
                   "error": err or (None if status == "sent" else result.message), **base}
            if cls == "conflict":
                out["error"] = f"intent conflict: {result.message}" + (f"; {err}" if err else "")
            if cls == "refused" and status == "failed":
                last = out
                if attempt < MAX_ATTEMPTS:
                    # The team-wide rate limit (shared with dewsletter) refused this burst: wait before the next key.
                    wait = refusal_wait(attempt, result.retry_after)
                    self.log(f"  {key}: refused ({result.status} {result.name or ''}); waiting {wait:g} s, then the next key passes the gates again")
                    self.sleep(wait)
                else:
                    self.log(f"  {key}: refused ({result.status} {result.name or ''}); no key left")
                continue
            return out
        return {**last, "outcome": "failed", "error": f"{last.get('error')}; gave up after {MAX_ATTEMPTS} keys"}

    def status(self):
        rows = self.rpc.call("dewfpga_mail_budget", {})
        return rows[0] if rows else {}

    def confirm_url(self, token):
        return f"{self.site_url}/newsletter/confirm/#t={token}"

    def unsubscribe_url(self, token):
        if not token:
            raise MailError("no unsubscribe token: every mail needs a working unsubscribe link")
        return f"{self.site_url}/newsletter/unsubscribe/#t={token}"

    def compose_confirm(self, token, unsub):
        url = self.confirm_url(token)
        subject = "Confirm your dewfpga newsletter address"
        text = ("Someone, probably you, asked for dewfpga patch notes at this address.\n\n"
                f"Confirm (the link works for 48 hours):\n{url}\n\n"
                "If that was not you, ignore this mail: no patch notes are sent without confirmation.\n"
                "Unconfirmed requests become eligible for cleanup after seven days, preserving this\n"
                "link's 48-hour window. Removal happens when the operator runs cleanup.\n\n"
                f"Unsubscribe (stops this request and any later mail):\n{unsub}\n")
        html = ("<!doctype html><html lang=\"en\"><body style=\"font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a\">"
                "<p>Someone, probably you, asked for dewfpga patch notes at this address.</p>"
                f"<p><a href=\"{url}\" style=\"color:#5b2fc9\">Confirm this address</a> (the link works for 48 hours).</p>"
                "<p style=\"color:#666;font-size:14px\">If that was not you, ignore this mail: no patch notes are sent without confirmation. "
                "Unconfirmed requests become eligible for cleanup after seven days, preserving this link's 48-hour window. "
                "Removal happens when the operator runs cleanup.</p>"
                f"<p style=\"color:#666;font-size:14px\"><a href=\"{unsub}\" style=\"color:#666\">Unsubscribe</a></p></body></html>")
        return subject, html, text

    def confirmations(self, limit=20, prune=True):
        if prune:
            self.rpc.call("dewfpga_newsletter_prune", {})
        pending = self.rpc.call("dewfpga_pending_confirmations", {"p_limit": limit}) or []
        counts = {"sent": 0, "unknown": 0, "unresolved": 0, "in_flight": 0, "failed": 0, "released": 0,
                  "stale": 0, "skipped": 0}
        for p in pending:
            who = recipient_hash(p["email"])[:12]
            if not p.get("unsubscribe_token"):
                counts["skipped"] += 1
                self.log(f"confirm {who}: skipped (no unsubscribe_token: needs 001 whose pending_confirmations returns it)")
                continue
            unsub = self.unsubscribe_url(p["unsubscribe_token"])
            subject, html, text = self.compose_confirm(p["confirm_token"], unsub)
            key = f"dewfpga:confirm:{p['id']}:{hashlib.sha256(str(p['confirm_token']).encode()).hexdigest()[:32]}"
            r = self._send("confirm", key, p["email"], subject, html, text, unsub)
            outcome = r["outcome"]
            if outcome == "sent":
                marked = self.rpc.call("dewfpga_mark_confirm_sent", {"p_id": p["id"], "p_ledger_id": r["ledger_id"],
                                                                    "p_confirm_token": p["confirm_token"]})
                if marked is False or marked == [False]:
                    outcome = "stale"
                    r["error"] = "accepted, but the request changed meanwhile (new consent or unsubscribe): not marked"
            counts[outcome] += 1
            self.log(f"confirm {who}: {outcome}" + (f" ({r['error']})" if r.get("error") else ""))
        return {"pending": len(pending), **counts}

    def _owner(self, owner_email):
        """The owner's own confirmed subscription: no consent and no unsubscribe token are made up."""
        want = owner_email.strip().lower()
        for rec in self.rpc.call("dewfpga_recipients", {}) or []:
            if rec["email"].strip().lower() == want:
                return rec
        raise MailError("owner must subscribe and confirm first (no confirmed subscription for DEWFPGA_OWNER_EMAIL)")

    def owner_test(self, entry, to, owner_email):
        if not owner_email or to.strip().lower() != owner_email.strip().lower():
            raise MailError("owner-test goes only to DEWFPGA_OWNER_EMAIL; this is not a relay")
        rec = self._owner(owner_email)
        m = patch_notes_mail.build(entry)
        unsub = self.unsubscribe_url(rec["unsubscribe_token"])
        html = m["html"].replace(patch_notes_mail.UNSUB, unsub)
        text = m["text"].replace(patch_notes_mail.UNSUB, unsub)
        key = f"dewfpga:owner_test:{m['content_hash']}:{recipient_hash(to)}:{rec['unsubscribe_token']}"
        r = self._send("owner_test", key, to, f"[owner test] {m['subject']}", html, text, unsub, m["content_hash"])
        return {"content_hash": m["content_hash"], **r}

    def approve(self, entry, receipt_note, unsubscribe_attestation=None):
        m = patch_notes_mail.build(entry)
        ot = self.rpc.call("dewfpga_mail_approve", {"p_content_hash": m["content_hash"], "p_receipt_note": receipt_note,
                                                    "p_unsubscribe_attestation": unsubscribe_attestation})
        if isinstance(ot, list):  # PostgREST returns a scalar; a json_agg wrapper returns [scalar]
            ot = ot[0] if ot else None
        return {"content_hash": m["content_hash"], "owner_test_ledger_id": ot}

    def campaign(self, entry):
        m = patch_notes_mail.build(entry)
        gate = self.rpc.call("dewfpga_mail_campaign_gate", {"p_content_hash": m["content_hash"]})  # raises when closed
        recipients = self.rpc.call("dewfpga_recipients", {}) or []
        counts = {"sent": 0, "unknown": 0, "unresolved": 0, "in_flight": 0, "failed": 0, "released": 0, "halted": 0,
                  "ineligible": 0, "conflicted": 0}
        for i, rec in enumerate(recipients):
            # eligibility is re-read right before each send: an unsubscribe during the run counts
            now = {(r["id"], str(r["unsubscribe_token"])) for r in self.rpc.call("dewfpga_recipients", {}) or []}
            if (rec["id"], str(rec["unsubscribe_token"])) not in now:
                counts["ineligible"] += 1
                continue
            unsub = self.unsubscribe_url(rec["unsubscribe_token"])
            key = f"dewfpga:campaign:{m['content_hash']}:{recipient_hash(rec['email'])}"
            try:
                r = self._send("campaign", key, rec["email"], m["subject"],
                               m["html"].replace(patch_notes_mail.UNSUB, unsub),
                               m["text"].replace(patch_notes_mail.UNSUB, unsub), unsub, m["content_hash"])
            except BudgetHalt as exc:
                counts["halted"] = len(recipients) - i
                self.log(f"halt: {exc}")
                break
            except RpcError as exc:
                if exc.code not in (None, "23505") or "identity mismatch" not in str(exc):
                    raise
                # Fresh consent rotates the unsubscribe token, so a previous
                # campaign intent can have a different payload. Never mint a
                # new key or weaken that guard: leave this recipient for
                # reconciliation while allowing unrelated recipients through.
                counts["conflicted"] += 1
                self.log(f"campaign {recipient_hash(rec['email'])[:12]}: identity changed since prior intent (accepted/unknown/refused); not re-sent")
                continue
            counts[r["outcome"]] += 1
        return {"content_hash": m["content_hash"], "gate": gate[0] if gate else None,
                "recipients": len(recipients), **counts}


# ----------------------------------------------------------------------- cli

def live_config(env, flag):
    missing = [k for k in LIVE_ENV if not env.get(k)]
    if not flag or env.get("DEWFPGA_MAIL_LIVE") != "1":
        raise MailError("live needs both --live and DEWFPGA_MAIL_LIVE=1")
    if missing:
        raise MailError("live needs " + ", ".join(missing))
    if "@" not in env["MAIL_FROM"] or not env["SITE_URL"].startswith("https://"):
        raise MailError("MAIL_FROM must hold an address and SITE_URL must be https")
    return {k: env[k] for k in LIVE_ENV}


def make_mailer(args, env=os.environ):
    if args.live:
        c = live_config(env, True)
        gate = None
        if args.cmd in ("confirmations", "owner-test", "campaign"):
            try:
                day = int(env["DEWFPGA_MAIL_HEADROOM_DAY"])
                month = int(env["DEWFPGA_MAIL_HEADROOM_MONTH"])
                gate = AccountUsageGate(c["RESEND_API_KEY"], day_headroom=day, month_headroom=month)
            except (KeyError, ValueError, UsageDeferred):
                raise MailError("live sending needs valid DEWFPGA_MAIL_HEADROOM_DAY (0..99) and "
                                "DEWFPGA_MAIL_HEADROOM_MONTH (0..2999); choose the account cushion explicitly") from None
        return Mailer(SupabaseRpc(c["SUPABASE_URL"], c["SUPABASE_SERVICE_KEY"]),
                      ResendTransport(c["RESEND_API_KEY"]), c["MAIL_FROM"], c["SITE_URL"], usage_gate=gate), "live"
    if env.get("DEWFPGA_MAIL_LIVE") == "1" and not args.live:
        print("note: DEWFPGA_MAIL_LIVE=1 without --live; staying in dry-run", file=sys.stderr)
    return Mailer(NullRpc(), DryRunTransport(),
                  env.get("MAIL_FROM", "dewfpga <dry-run@localhost.invalid>"),
                  env.get("SITE_URL", "https://nosey-dewdrop.github.io/dewfpga")), "dry-run"


def main(argv, env=os.environ):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--live", action="store_true", help="talk to Supabase and Resend (also needs DEWFPGA_MAIL_LIVE=1)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    p = sub.add_parser("preview-patch-notes"); p.add_argument("--entry", type=int, required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("confirmations"); p.add_argument("--limit", type=int, default=20)
    p = sub.add_parser("owner-test"); p.add_argument("--entry", type=int, required=True); p.add_argument("--to", required=True)
    p = sub.add_parser("approve"); p.add_argument("--entry", type=int, required=True); p.add_argument("--note", required=True, help="what arrived in the inbox")
    p.add_argument("--unsubscribe-attestation", help="manual unsubscribe check, when it was not measured")
    p = sub.add_parser("campaign"); p.add_argument("--entry", type=int, required=True)
    a = ap.parse_args(argv)
    if a.cmd == "preview-patch-notes":
        return patch_notes_mail.main(["--entry", str(a.entry), "--out", a.out])
    try:
        mailer, mode = make_mailer(a, env)
        print(f"mode: {mode}")
        if a.cmd == "status":
            out = mailer.status()
        elif a.cmd == "confirmations":
            out = mailer.confirmations(a.limit, prune=(mode == "live"))
        elif a.cmd == "owner-test":
            out = mailer.owner_test(a.entry, a.to, env.get("DEWFPGA_OWNER_EMAIL"))
        elif a.cmd == "approve":
            out = mailer.approve(a.entry, a.note, a.unsubscribe_attestation)
        else:
            out = mailer.campaign(a.entry)
    except MailError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
