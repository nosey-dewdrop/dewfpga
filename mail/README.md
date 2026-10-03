# Newsletter and optional accounts

The site sources live in `site/newsletter/`, `site/account/`, `site/privacy/`,
`site/mail.js` and `site/config.js`. There is no second deployed `mail/site/`
copy. SQL and the operator's mail worker live here; they are not shipped in the
student CLI package. The CLI, documentation and simulator require no account.

This candidate has **not** been activated against a live Supabase project or
Resend account. Local PostgreSQL tests use stub Auth roles; browser tests use
real browsers and SQL but fake Auth and a PostgREST-shaped adapter. They do not
prove real JWT verification, SMTP delivery, inbox receipt or hosted redirects.

## Before activation

1. Identify the existing Supabase project shared with dewsletter. Review and
   apply `sql/001_dewfpga_newsletter.sql`, `002_dewfpga_mail_ledger.sql`, then
   `003_dewfpga_account.sql` as the project owner. These create `dewfpga_`
   objects. Do not delete or replace shared `auth.users` or other applications'
   objects. Normal Supabase signup still creates a sign-in identity; dewfpga
   enrolment and deletion operate on its own profile and linked subscriptions.
   First look, without writing (one `begin transaction read only` ... `rollback`):
   `psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f mail/ops/preflight_readonly.sql`
   prints server and role, pgcrypto, every `dewfpga_` object with grants and
   row counts (all 0 on a fresh project), the other applications' tables and
   their `auth.users` references, triggers on `auth.users`, default privileges,
   other functions whose body names `dewfpga_`, and which parts of 001/002/003
   already exist. It needs no superuser; tables it may not read get an estimate.
   To undo dewfpga only, `mail/ops/rollback_dewfpga.sql` drops exactly the
   `dewfpga_` tables, functions and policy of 001-003 in one transaction, never
   with CASCADE. When something outside dewfpga uses them it drops nothing:
   foreign keys and views are named up front, functions that call a `dewfpga_`
   RPC are found by their body text (a name built at run time is missed, so
   read the preflight first), and PostgreSQL refuses every other tracked
   dependency. `auth.users`, pgcrypto and other applications are untouched. It DELETES all
   subscriber, ledger and profile data: `pg_dump` the `dewfpga_` tables first
   (command in its header). Verified by `tests/test_activation_sql.py`; run by hand
   only. `mail/sql` holds only the numbered migrations; the operator scripts live in `mail/ops`.
2. Publish the controller/contact, purposes and legal grounds, collection and
   transfer details, processing locations, retention arrangements and rights
   procedure in `site/privacy/index.html` and reconcile the signup/account copy.
   The current text explicitly marks missing details. Do not infer legal
   compliance from passing software tests. See the [KVKK notice guidance](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)
   and [European Commission transparency guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).
3. Configure Supabase Auth with the existing Resend SMTP account and a verified
   sending domain. Resend documents host `smtp.resend.com`, port `465`, username
   `resend` and the API key as password. Supply the verified sender address/name;
   confirm the settings and delivery with a real test before activation. See
   [Resend's Supabase setup](https://resend.com/docs/send-with-supabase-smtp).
4. Set Auth's site URL and allowed redirect to the actual published
   `/dewfpga/account/` URL. Preserve signup for new users. Review the project's
   Auth mail rate limits: an hourly setting is not proof of a reserved daily
   allowance. [Supabase custom SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)
   describes the separate default and custom-SMTP restrictions.
5. Put only the public project URL and public anon key in `site/config.js`.
   Never put the service key or Resend key in site files, git, browser storage
   or the CLI package. Keep worker credentials in the operator's protected
   environment. Blank public configuration leaves the forms disabled.
6. Choose the worker's own daily allocation and account-wide daily/monthly
   headroom after reviewing the existing account's actual use. Verify that
   `GET https://api.resend.com/usage` works with the worker's credential. Do not
   assume dewsletter always consumes exactly 90 messages or that its repository
   JSON counter coordinates other senders.

## Shared capacity and retries

The application ledger controls dewfpga's own allocation. Account-wide usage
observation includes activity outside this worker; the headroom is a cushion,
not a reservation for Auth, dewsletter or inbound mail. Another sender may use
capacity between the observation and the request. Provider quota refusal must
defer work. Missing, malformed or unavailable usage data also defers work;
there is no fallback that sends blindly.

Current provider documents conflict about whether the daily window is rolling
or a UTC calendar day. The application can use its own conservative rolling
policy without claiming it is the provider's exact reset policy. Recheck usage
on a later run instead of promising delivery at a guessed reset time. See
[Usage API](https://resend.com/docs/api-reference/usage/retrieve-usage),
[account limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
and [quota errors](https://resend.com/docs/api-reference/errors).

A lost response may follow a successful provider acceptance. Such attempts
must retain their original payload and idempotency key inside the permitted
retry window, then remain unresolved for operator reconciliation. An HTTP
success with a message ID records provider acceptance, not inbox delivery.
Neither the worker nor its tests claim exactly-once delivery.

## Consent, cleanup and account scope

Subscribe records pending consent; only the mailed confirmation token enables
newsletter dispatch. Confirmation links last 48 hours after the recorded send.
A new consent generation gets new management tokens and must prove any account
link again. Every newsletter message, including confirmation and owner-test,
needs a usable unsubscribe link.

The SQL cleanup makes never-confirmed requests eligible after seven days,
preserving a recently mailed confirmation's 48-hour window. Unsubscribed rows
become eligible after 30 days. Eligibility does not mean a scheduled cleanup
has run: arrange and monitor an actual worker/maintenance schedule. Document
ledger and provider retention separately. Recipient hashes are not anonymous
data and account deletion does not imply deletion of every provider log.

Export/deletion covers the dewfpga profile and subscriptions linked to it.
Anonymous subscriptions use their own unsubscribe links. Other applications'
profiles and the shared Supabase Auth identity survive dewfpga deletion.

## Owner acceptance before a campaign

Preview the selected patch note locally. The owner must explicitly subscribe
and confirm before the owner test; do not create consent on their behalf.
Record actual receipt, inspect the content, follow the real unsubscribe link
and measure that further newsletter dispatch excludes that subscription.
Approval must identify the tested content and recipient/generation. If content
changes, repeat the test. A recording provider in a local test does not satisfy
this real-delivery acceptance step.

CI, site deployment and a default CLI invocation must never send mail. The
operator's live worker requires explicit live configuration. The commands below describe the reviewable operator procedure; they have not been run against live services.


## Operator commands and configuration

Run from the repository root. Local preview needs no credentials:

```sh
python3 mail/dewfpga_mail.py status
python3 mail/dewfpga_mail.py preview-patch-notes --entry 24 --out /tmp/dewfpga-mail-preview
```

For a live worker, supply `RESEND_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `MAIL_FROM`, `SITE_URL`, `DEWFPGA_OWNER_EMAIL`,
`DEWFPGA_MAIL_HEADROOM_DAY` and `DEWFPGA_MAIL_HEADROOM_MONTH` in its protected
environment. Daily headroom accepts 0..99 and monthly 0..2999; choose values
based on the shared account, not the examples in tests. Set `DEWFPGA_MAIL_LIVE=1`
only after the activation checks. `--live` is also required. Status/approval do
not send and do not require headroom; all live sending commands do.

Enrol the own worker allocation as the database operator, with chosen integer
caps. The schema's own maximums are 95 per rolling 24 hours and 2900 per rolling
30 days; these are application policies, not a claim about the provider's window.
Set `dewfpga_mail_consumers.enrolled_at`, `daily_cap`, and `monthly_cap` for
`name = 'dewfpga'`. Null enrolment or caps refuse sending. Setting `enrolled_at`
to null revokes future claims. No change to dewsletter's repository is required
for the observed-account approach; coordinate its operating schedule and limits
with this allocation.

The following are explicit operator actions, not CI or deployment steps:

```sh
python3 mail/dewfpga_mail.py --live status
python3 mail/dewfpga_mail.py --live confirmations --limit 5
python3 mail/dewfpga_mail.py --live owner-test --entry 24 --to OWNER_ADDRESS
# After actual receipt and the unsubscribe check:
python3 mail/dewfpga_mail.py --live approve --entry 24 --note "Actual receipt and content checked"
python3 mail/dewfpga_mail.py --live campaign --entry 24
```

Replace `OWNER_ADDRESS` with the address in `DEWFPGA_OWNER_EMAIL`. An approval
without observed unsubscribe evidence fails unless the operator supplies a
truthful `--unsubscribe-attestation` describing the manual check. Approval
expires after 14 days and a newer owner test supersedes it. Do not substitute
an invented attestation for the real owner test required by the rollout plan.
Prioritize pending confirmations before campaign batches and monitor halted,
unknown, stale, ineligible and conflicted outcomes. A quota halt is a deferred
run, not a completed campaign. Fresh consent rotates management tokens: rerunning
an old campaign may therefore conflict with that recipient's earlier payload.
The worker reports this recipient as conflicted, preserves the old ledger and
sends nothing to them in this run; unrelated recipients can continue. This does
not say whether that earlier intent was accepted, refused or remains unknown.
Even a proven earlier refusal is not automatically reissued after a consent
change: restarting a past issue deliberately preserves its original identity.
A fresh subscription remains eligible for later issues. There is no automatic
repair/reissue command for an old conflict. Inspect the original ledger and real
provider evidence before resolving uncertainty; do not mint a new key to bypass it.

Unknown or aged attempts require reconciliation with the provider's actual
records. The service-only `dewfpga_mail_resolve` SQL function requires a note and,
for an accepted message, its provider ID. Do not mark an attempt definitely
unsent merely because a recent log search found no match. No automatic resolver
or CLI shortcut fabricates that evidence.

Offline validation (PostgreSQL binaries and `sim/` npm dependencies required):

```sh
python3 -B mail/tests/test_sql.py
python3 -B mail/tests/test_mail.py
python3 -B mail/tests/test_sender_idem.py
python3 -B mail/tests/test_lifecycle.py
python3 -B mail/tests/test_usage.py
python3 -B mail/tests/test_integration.py
python3 -B mail/tests/test_pages.py
node mail/tests/test_browser.mjs
```

The browser suite defaults to Chromium and WebKit. Set `DEWFPGA_BROWSERS` for a
single browser or `DEWFPGA_PLAYWRIGHT` to an installed Playwright package path.
The private test database uses a temporary Unix socket and is stopped on exit.
CI installs matching browsers from `sim/package-lock.json` and needs no secrets.
