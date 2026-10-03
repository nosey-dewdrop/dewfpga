"""Account-wide Resend observation; this is not a reservation or SMTP limiter.

The worker must also enforce its own ledger allocation. A concurrent sender or
inbound message can consume capacity after this check. Provider quota refusals
remain authoritative. No observation means defer, never silently send anyway.
See https://resend.com/docs/api-reference/usage/retrieve-usage .
"""
import json
import re
import urllib.error
import urllib.request

# Resend's documented error names (resend.com/docs/api-reference/errors) are lowercase identifiers.
_ERROR_NAME = re.compile(r"^[a-z_]{1,64}$")


class UsageDeferred(Exception):
    """No mail should be attempted until a later successful capacity check."""


def _http_error_reason(exc):
    """Status code plus the body's documented `name`, nothing else.

    The body's message, the headers and the raw body may echo the credential or
    other account detail; only a name matching _ERROR_NAME is repeated. A
    sending_access key gets 401 restricted_api_key from GET /usage: say so,
    otherwise the worker defers forever without a visible cause.
    """
    reason = f"HTTP {exc.code}"
    name = None
    try:
        parsed = json.loads(exc.read(4096))
        candidate = parsed.get("name") if isinstance(parsed, dict) else None
        if isinstance(candidate, str) and _ERROR_NAME.fullmatch(candidate):
            name = candidate
    except Exception:
        pass
    if name:
        reason += " " + name
    if exc.code == 401 and name == "restricted_api_key":
        reason += ": this key can only send mail; GET /usage needs a full_access key"
    return reason


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the account credential to a redirected destination.
        return None


def _count(value, name):
    if type(value) is not int or value < 0:
        raise UsageDeferred(f"invalid account usage field: {name}")
    return value


class AccountUsageGate:
    """Read fresh usage before a ledger claim, leaving an operator-chosen cushion.

    The cushion is best effort, not capacity reserved for Auth/dewsletter. The
    ceilings also preserve the configured account policy when a provider limit
    is null or larger. We do not infer a reset instant: Resend documents the free
    plan's daily quota as a UTC calendar day; the ledger's rolling count is the
    conservative side of that and nothing here schedules against midnight UTC.
    """

    def __init__(self, api_key, *, day_headroom, month_headroom,
                 day_ceiling=100, month_ceiling=3000, timeout=15, opener=None):
        if not api_key:
            raise ValueError("RESEND_API_KEY is required for account usage")
        self.headroom = {"daily": _count(day_headroom, "day_headroom"),
                         "monthly": _count(month_headroom, "month_headroom")}
        self.ceilings = {"daily": _count(day_ceiling, "day_ceiling"),
                         "monthly": _count(month_ceiling, "month_ceiling")}
        if any(self.headroom[k] >= self.ceilings[k] for k in self.headroom):
            raise ValueError("headroom must be smaller than each account ceiling")
        self.key, self.timeout = api_key, timeout
        self.opener = opener or urllib.request.build_opener(_NoRedirect()).open

    def check(self, recipients=1):
        recipients = _count(recipients, "recipients")
        if not recipients:
            raise ValueError("a send must have at least one recipient")
        req = urllib.request.Request(
            "https://api.resend.com/usage", method="GET",
            headers={"Authorization": "Bearer " + self.key,
                     "Accept": "application/json", "User-Agent": "dewfpga-mail/1.0"})
        try:
            with self.opener(req, timeout=self.timeout) as response:
                if response.status != 200:
                    raise UsageDeferred("account usage unavailable; mail deferred")
                raw = response.read(65537)
                if len(raw) > 65536:
                    raise UsageDeferred("account usage response too large; mail deferred")
                data = json.loads(raw)
        except UsageDeferred:
            raise
        except urllib.error.HTTPError as exc:
            # Status and documented error name only; the rest of the answer may contain secrets.
            reason = _http_error_reason(exc)
            raise UsageDeferred(f"account usage unavailable ({reason}); mail deferred") from None
        except Exception:
            # Provider response bodies/transport exceptions may contain secrets.
            raise UsageDeferred("account usage unavailable; mail deferred") from None
        if not isinstance(data, dict) or not isinstance(data.get("emails"), dict):
            raise UsageDeferred("invalid account usage response; mail deferred")
        remaining = {}
        for window in ("daily", "monthly"):
            row = data["emails"].get(window)
            if not isinstance(row, dict) or "limit" not in row:
                raise UsageDeferred(f"missing {window} account usage; mail deferred")
            used = _count(row.get("used"), window + ".used")
            limit = row["limit"]
            ceiling = self.ceilings[window]
            if limit is not None:
                ceiling = min(ceiling, _count(limit, window + ".limit"))
            remaining[window] = ceiling - used - self.headroom[window]
            if remaining[window] < recipients:
                raise UsageDeferred(f"{window} account capacity low; mail deferred")
        return remaining
