#!/usr/bin/env python3
"""Offline checks of the canonical newsletter/account sources in site/.
The actual tracked sitemap and site-check are exercised without adding synthetic
entries. A damaged copy verifies that an omitted newsletter URL fails the gate.
"""
import json, os, pathlib, re, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
MAIL_SITE = REPO / 'site'
PASS = FAIL = 0
RESULTS = []


def check(name, ok, detail=''):
    global PASS, FAIL
    PASS += ok
    FAIL += (not ok)
    RESULTS.append((name, ok, detail))
    print(('ok   ' if ok else 'FAIL ') + name + (('  ' + detail) if detail and not ok else ''))


def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')


# 1. syntax of the two scripts
for js in ('config.js', 'mail.js'):
    r = subprocess.run(['node', '--check', str(MAIL_SITE / js)], capture_output=True, text=True)
    check(f'node --check {js}', r.returncode == 0, r.stderr.strip())

# 2. pure helpers in node, no DOM
NODE = r'''
const path = process.argv[1]; // `node -e code arg`: argv[0] is node, argv[1] the first extra arg
globalThis.window = undefined;
require(path);
const L = globalThis.DEWFPGA_MAIL_LIB;
const out = {};
out.consent = L.CONSENT_VERSION;
out.tok_ok = L.tokenFromHash('#t=0F3A2C5E-1B2D-4E5F-8A9B-0C1D2E3F4A5B');
out.tok_extra = L.tokenFromHash('#t=0f3a2c5e-1b2d-4e5f-8a9b-0c1d2e3f4a5b&x=1');
out.tok_short = L.tokenFromHash('#t=abc');
out.tok_none = L.tokenFromHash('');
out.tok_other = L.tokenFromHash('#access_token=abc');
out.auth_err = L.parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
out.auth_sess = L.parseAuthHash('#access_token=' + 'a'.repeat(40) + '&refresh_token=r&expires_in=3600&token_type=bearer&type=magiclink');
out.auth_none = L.parseAuthHash('#t=0f3a2c5e-1b2d-4e5f-8a9b-0c1d2e3f4a5b');
out.auth_zero = (L.parseAuthHash('#access_token=' + 'a'.repeat(40) + '&expires_in=0&type=magiclink') || {}).session;
out.auth_bad = L.parseAuthHash('#access_token=%E0%A4%A&type=magiclink'); // malformed percent-encoding must not throw
const now = Math.floor(Date.now() / 1000);
out.valid_live = L.sessionValid({access_token: 'a'.repeat(40), expires_at: now + 600}, now);
out.valid_dead = L.sessionValid({access_token: 'a'.repeat(40), expires_at: now - 1}, now);
out.valid_soon = L.sessionValid({access_token: 'a'.repeat(40), expires_at: now + 5}, now);
out.valid_short = L.sessionValid({access_token: 'short', expires_at: now + 600}, now);
out.valid_null = L.sessionValid(null, now);
globalThis.DEWFPGA_MAIL = {supabaseUrl: 'https://x.supabase.co/', anonKey: 'anonkey', siteUrl: 'https://nosey-dewdrop.github.io/dewfpga'};
const c = L.config();
out.cfg_url = c.url;
out.cfg_ok = L.configured(c);
out.cfg_http = L.configured({url: 'http://x', key: 'k'});
out.cfg_empty = L.configured({url: '', key: ''});
out.h_anon = L.headers(c, null);
out.h_sess = L.headers(c, {access_token: 'b'.repeat(40), expires_at: now + 600});
out.h_dead = L.headers(c, {access_token: 'b'.repeat(40), expires_at: now - 600});
out.e429 = L.errorText(429, {message: 'x'});
out.e401 = L.errorText(401, {});
out.e403 = L.errorText(403, {});
out.e0 = L.errorText(0, null);
out.e500 = L.errorText(500, {message: 'm'.repeat(500)});
out.e500_len = out.e500.length;
process.stdout.write(JSON.stringify(out));
'''
r = subprocess.run(['node', '-e', NODE, str(MAIL_SITE / 'mail.js')], capture_output=True, text=True)
check('mail.js loads in node without a DOM', r.returncode == 0, r.stderr.strip()[-400:])
o = json.loads(r.stdout) if r.returncode == 0 else {}
check('tokenFromHash accepts a uuid (lower-cased)', o.get('tok_ok') == '0f3a2c5e-1b2d-4e5f-8a9b-0c1d2e3f4a5b', repr(o.get('tok_ok')))
check('tokenFromHash rejects extra params', o.get('tok_extra') is None)
check('tokenFromHash rejects non-uuid', o.get('tok_short') is None and o.get('tok_none') is None and o.get('tok_other') is None)
check('parseAuthHash returns error from error_code', (o.get('auth_err') or {}).get('error') == 'otp_expired', repr(o.get('auth_err')))
s = (o.get('auth_sess') or {}).get('session') or {}
check('parseAuthHash returns a session with expiry', s.get('type') == 'magiclink' and isinstance(s.get('expires_at'), (int, float)) and s['expires_at'] > 0, repr(s))
z = o.get('auth_zero') or {}
check('parseAuthHash: expires_in=0 is already expired, not the default hour', isinstance(z.get('expires_at'), (int, float)) and z['expires_at'] <= int(__import__('time').time()) + 5, repr(z))
check('parseAuthHash: malformed percent-encoding does not throw and yields no session', 'auth_bad' in o and not ((o.get('auth_bad') or {}).get('session')), repr(o.get('auth_bad')))
check('parseAuthHash ignores a newsletter token hash', o.get('auth_none') is None)
check('sessionValid: live yes, expired/soon/short/null no',
      o.get('valid_live') is True and not o.get('valid_dead') and not o.get('valid_soon') and not o.get('valid_short') and not o.get('valid_null'),
      repr({k: o.get(k) for k in o if k.startswith('valid_')}))
check('config strips trailing slash, requires https', o.get('cfg_url') == 'https://x.supabase.co' and o.get('cfg_ok') is True and o.get('cfg_http') is False and o.get('cfg_empty') is False)
check('headers: anon key bearer without session', (o.get('h_anon') or {}).get('Authorization') == 'Bearer anonkey' and o['h_anon'].get('apikey') == 'anonkey')
check('headers: user token bearer with live session', (o.get('h_sess') or {}).get('Authorization') == 'Bearer ' + 'b' * 40)
check('headers: expired session sends the anon key (callers must detect expiry before relying on this)', (o.get('h_dead') or {}).get('Authorization') == 'Bearer anonkey')
check('errorText maps 429/401/403/0, preserves unknown network outcome and caps length', 'too many' in o.get('e429', '') and 'sign-in not accepted' in o.get('e401', '') and 'not allowed' in o.get('e403', '') and 'may have been processed' in o.get('e0', '') and 'nothing was changed' not in o.get('e0', '') and o.get('e500_len', 999) < 260,
      repr({k: o.get(k) for k in ('e429', 'e401', 'e403', 'e0', 'e500_len')}))

# 3. static page rules
pages = {
    'newsletter': MAIL_SITE / 'newsletter' / 'index.html',
    'confirm': MAIL_SITE / 'newsletter' / 'confirm' / 'index.html',
    'unsubscribe': MAIL_SITE / 'newsletter' / 'unsubscribe' / 'index.html',
    'account': MAIL_SITE / 'account' / 'index.html',
}
html = {k: read(v) for k, v in pages.items()}
mailjs = read(MAIL_SITE / 'mail.js')
for k, h in html.items():
    check(f'{k}: no inline event handlers or javascript: urls', not re.search(r'\son\w+\s*=|javascript:', h, re.I))
    check(f'{k}: data-page matches', f'data-page="{k}"' in h)
    check(f'{k}: loads config.js before mail.js', h.find('/dewfpga/config.js') < h.find('/dewfpga/mail.js') and '/dewfpga/config.js' in h)
    check(f'{k}: no-referrer policy', '<meta name="referrer" content="no-referrer">' in h)
    check(f'{k}: no external script or form action', not re.search(r'<script[^>]+src="https?://', h) and 'action=' not in h)
for k in ('confirm', 'unsubscribe'):
    check(f'{k}: noindex (token pages never in the sitemap)', 'content="noindex"' in html[k])
for k in ('newsletter', 'account'):
    check(f'{k}: indexable with canonical', 'rel="canonical"' in html[k] and 'noindex' not in html[k])

# element ids used by mail.js exist on the right page
need = {
    'newsletter': ['subscribe-form', 'sub-email', 'sub-consent', 'consent-version', 'subscribe-status'],
    'confirm': ['confirm-form', 'confirm-status'],
    'unsubscribe': ['unsubscribe-form', 'unsubscribe-status', 'link-form', 'link-status'],
    'account': ['signin-form', 'signin-email', 'signin-status', 'view-signed-out', 'view-no-account', 'view-account',
                'enrol-form', 'enrol-status', 'acct-created', 'acct-linked', 'export-btn', 'delete-btn', 'rights-status'],
}
for k, ids in need.items():
    missing = [i for i in ids if f'id="{i}"' not in html[k]]
    check(f'{k}: every id mail.js uses exists', not missing, repr(missing))
    for i in ids:
        check(f'{k}: id {i} used by mail.js', f"'{i}'" in mailjs or f'"{i}"' in mailjs)
check('account: signed-in-as and signout-btn classes present', html['account'].count('class="signed-in-as"') == 2 and 'signout-btn' in html['account'])

# consent text version shown on the page equals the one mail.js sends
cv = re.search(r"CONSENT_VERSION\s*=\s*'([^']+)'", mailjs).group(1)
check('newsletter: consent version equals mail.js CONSENT_VERSION', f'id="consent-version">{cv}<' in html['newsletter'] and o.get('consent') == cv, cv)

# honesty of the rights copy
a = html['account']
check('account: says free stays free', 'stays free without an account' in a)
check('account: premium coming soon, nothing sold', 'Premium: coming soon' in a and 'Nothing is sold yet' in a)
check('account: delete does not remove the shared identity', 'not</b> delete the shared sign-in identity' in a)
check('account: anonymous subscriptions not shown/deleted', 'not shown in the export, not deleted here' in a)
check('account: legal lines marked as not yet published', 'not yet published' in a and 'OPERATOR:' in a)
check('newsletter: legal lines marked as not yet published', 'not yet published' in html['newsletter'] and 'OPERATOR:' in html['newsletter'])
check('newsletter: no tracking claim matches code (no pixel in mailer)', 'no tracking pixel' in html['newsletter'] and 'pixel' not in read(REPO / 'mail' / 'dewfpga_mail.py').lower().replace('no tracking pixel', ''))

# shipped-closed defaults: no native GET submit without JS, controls off until mail.js attaches handlers
for k, h in html.items():
    forms = re.findall(r'<form\b[^>]*>', h)
    check(f'{k}: every form is data-off="1", novalidate, no method/action', forms and all('data-off="1"' in f and 'novalidate' in f and 'method=' not in f and 'action=' not in f for f in forms), repr(forms))
    ctrls = re.findall(r'<(?:button|input)\b[^>]*>', h)
    open_ = [c for c in ctrls if 'disabled' not in c and 'id="retry-btn"' not in c]
    check(f'{k}: every button/input ships disabled (retry button excepted, it is hidden)', not open_, repr(open_))
    check(f'{k}: noscript explains that nothing is sent', '<noscript>' in h and 'JavaScript is off' in h)
    check(f'{k}: loading line promises nothing was sent', 'Loading the form script' in h and 'nothing was sent' in h)
check('confirm: anon confirm button exists hidden+disabled and mail.js drives it', 'id="confirm-anon-btn" hidden disabled' in html['confirm'] and "'confirm-anon-btn'" in mailjs)
check('account: retry button exists and mail.js drives it', 'id="retry-btn"' in html['account'] and "'retry-btn'" in mailjs)
calls = [m.start() for m in re.finditer(r'(?<!function )\benable\((form|linkForm|enrol|signin)\)', mailjs)]
first_submit = mailjs.find("addEventListener('submit'")
check('mail.js enables a form only after handlers are attached (every enable() call follows a submit listener)',
      len(calls) >= 5 and first_submit != -1 and all(mailjs.rfind("addEventListener('submit'", 0, c) != -1 for c in calls), repr((len(calls), first_submit)))

# copy matches the backend and the auth service; no invented numbers
allhtml = '\n'.join(html.values())
check('confirm page + mail.js say 48 hours (dewfpga_confirm window), never 7 days for the link', '48 hours' in html['confirm'] and '48 hours' in mailjs and not re.search(r'link[^.]{0,80}7 days', allhtml + mailjs, re.I))
check('newsletter: link valid 48 hours', 'valid for 48 hours' in html['newsletter'])
check('no fixed OTP numbers: no "one hour" / "60 seconds" promises', not re.search(r'one hour|60 seconds|within an hour', allhtml + mailjs, re.I))
check('no automatic deletion schedule promised', 'no automatic schedule' in html['newsletter'] and 'no automatic schedule' in html['unsubscribe'] and not re.search(r'automatically (deleted|removed)', allhtml, re.I))
check('google fonts disclosed on both indexable pages', all('Google Fonts' in html[k] for k in ('newsletter', 'account')))
check('no IP-retention claim invented', not re.search(r'IP address[^.]*(kept|stored|retained) for', allhtml, re.I) and 'store no IP address' in html['newsletter'])
check('account: logout is scope=local and copy says this session only', '/auth/v1/logout?scope=local' in mailjs and 'Ends this session only' in html['account'] and 'does not sign out other devices' in html['account'])
check('account: magic link requests create_user: true (new-user signup intended)', 'create_user: true' in mailjs and 'create_user: false' not in mailjs)
check('account: OTP copy defers validity/rate to the Supabase project', "set in the operator's Supabase project" in html['account'])
check('account: no compliance guarantee, controller openly missing', 'makes no compliance guarantee' in html['account'] and 'Controller contact' in html['account'])
check('account: rights table has export, delete, sign out', all(s in html['account'] for s in ('id="export-btn"', 'id="delete-btn"', 'class="act signout-btn"')))
acct = mailjs[mailjs.find('var rawHash = location.hash'):]
check('mail.js strips the auth hash (stripHash → replaceState) before parsing it', 'replaceState' in mailjs[mailjs.find('function stripHash'):][:300] and 0 < acct.find('stripHash()') < acct.find('parseAuthHash('), repr((acct.find('stripHash()'), acct.find('parseAuthHash('))))
check('mail.js guards sessionStorage access (try/catch around storage)', mailjs.count('sessionStorage') >= 2 and 'try {' in mailjs)
check('mail.js does not retry a 401 anonymously (clears session, shows sign-in)', 'status === 401' in mailjs and 'clearSession' in mailjs)

# 4. RPC names used by the pages exist in SQL with the expected grants
sql = '\n'.join(read(p) for p in sorted((REPO / 'mail' / 'sql').glob('*.sql')))
rpcs = sorted(set(re.findall(r"rpc\('(dewfpga_\w+)'", mailjs)))
check('mail.js calls only dewfpga_ RPCs', rpcs and all(r.startswith('dewfpga_') for r in rpcs), repr(rpcs))
for r_ in rpcs:
    check(f'rpc {r_} defined in sql', re.search(r'create or replace function public\.' + r_ + r'\s*\(', sql, re.I) is not None)
def granted(fn, role):
    return re.search(r'grant execute on function public\.' + fn + r'\([^)]*\)\s+to\s+[^;]*\b' + role + r'\b', sql, re.I) is not None
for fn in ('dewfpga_subscribe', 'dewfpga_confirm', 'dewfpga_unsubscribe'):
    check(f'{fn} granted to anon', granted(fn, 'anon'))
for fn in ('dewfpga_enrol_me', 'dewfpga_link_subscription', 'dewfpga_export_me', 'dewfpga_delete_me'):
    check(f'{fn} granted to authenticated only', granted(fn, 'authenticated') and not granted(fn, 'anon'))
check('mail.js never touches tables directly (only /rpc/ and /auth/)', '/rest/v1/' not in mailjs.replace('/rest/v1/rpc/', ''))
check('mail.js posts to /auth/v1/otp, /auth/v1/logout, gets /auth/v1/user', all(s in mailjs for s in ('/auth/v1/otp', '/auth/v1/logout', '/auth/v1/user')))
check('mail.js never stores the service key or any key literal', not re.search(r'eyJ[A-Za-z0-9_-]{20,}', mailjs + read(MAIL_SITE / 'config.js')))
cfg = read(MAIL_SITE / 'config.js')
check('config.js ships empty credentials', bool(re.search(r'supabaseUrl:\s*""', cfg) and re.search(r'anonKey:\s*""', cfg)))

# 5. the free product must not depend on the account/newsletter layer.
# Targeted entry points, not a grep over the whole tree: these are the files a student runs or opens.
K7 = re.compile(r'dewfpga_profiles|premium_since|DEWFPGA_MAIL|dewfpga_subscribe|supabase', re.I)
for rel in ('bin/dewfpga', 'templates/Makefile', 'templates/check_xdc.py', 'install.sh', 'site/index.html', 'site/s.js', 'sim/index.html'):
    p = REPO / rel
    if not p.exists():
        check(f'{rel}: exists', False, 'missing')
        continue
    hit = K7.findall(p.read_text(encoding='utf-8', errors='ignore'))
    check(f'{rel}: free product entry point has no account/newsletter dependency', not hit, repr(sorted(set(hit))))
home = os.path.expanduser('~')
leak = [str(p.relative_to(REPO)) for p in (REPO / 'mail').rglob('*') if p.is_file() and home in p.read_text(encoding='utf-8', errors='ignore')]
check('mail/ contains no personal home path', not leak, repr(leak))

# 6. Check the actual integrated site; no synthetic routes or sitemap additions.
r = subprocess.run([sys.executable, str(REPO / 'test' / 'site-check.py')],
                   capture_output=True, text=True, cwd=str(REPO))
check('actual integrated site passes site-check', r.returncode == 0,
      ' | '.join((r.stdout + r.stderr).strip().splitlines()[-8:]))
with tempfile.TemporaryDirectory() as td:
    staged = pathlib.Path(td) / 'site'
    shutil.copytree(REPO / 'site', staged, ignore=shutil.ignore_patterns('.rabadon', '.vercel', 'node_modules'))
    sm = staged / 'sitemap.xml'
    x = sm.read_text(encoding='utf-8')
    x, count = re.subn(r'<url>\s*<loc>https://nosey-dewdrop.github.io/dewfpga/newsletter/</loc>.*?</url>', '', x, flags=re.S)
    check('newsletter has exactly one sitemap entry', count == 1)
    sm.write_text(x, encoding='utf-8')
    r2 = subprocess.run([sys.executable, str(REPO / 'test' / 'site-check.py'), '--site', str(staged)],
                        capture_output=True, text=True, cwd=str(REPO))
    check('missing actual newsletter sitemap entry fails site-check',
          r2.returncode != 0 and 'newsletter' in (r2.stdout + r2.stderr))

print(f'\npassed {PASS}, failed {FAIL}')
sys.exit(1 if FAIL else 0)
