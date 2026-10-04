#!/usr/bin/env node
/* Real-browser tests for site (newsletter, confirm, unsubscribe, account).
   Everything the page talks to is faked inside the browser's routing layer:
     - https://site.test/dewfpga/*            served from disk (site/s.css, site/s.js, site/**),
                                              config.js generated per case (empty or fake project)
     - https://fake.supabase.test/auth/v1/*   fake GoTrue (otp, user, logout); records what the page sent
     - https://fake.supabase.test/rest/v1/rpc/* forwarded to mail/tests/browser_pgrest_shim.py, a
                                              PostgREST-shaped loopback over a private throwaway
                                              PostgreSQL cluster running the real mail/sql migrations
     - every other host is aborted and counted (no egress; Google Fonts included)
   Playwright is resolved from <repo>/sim/node_modules/playwright or $DEWFPGA_PLAYWRIGHT (a path to
   the playwright package). Browsers: $DEWFPGA_BROWSERS, default "chromium,webkit".
   Needs: node >= 18, python3, PostgreSQL binaries (see pg_harness.py). Fails hard, never skips silently.
   Exit 0 only when every check passed. Output: one line per check, final "passed N, failed M". */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const pwPath = process.env.DEWFPGA_PLAYWRIGHT || path.join(repo, 'sim', 'node_modules', 'playwright');
if (!existsSync(pwPath)) {
  console.error(`playwright not found at ${pwPath}; run "npm ci" in sim/ or set DEWFPGA_PLAYWRIGHT=<path to playwright package>`);
  process.exit(2);
}
const pw = createRequire(path.join(pwPath, 'package.json'))(pwPath);
const browsersWanted = (process.env.DEWFPGA_BROWSERS || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);

const SITE = 'https://site.test/dewfpga';
const SB = 'https://fake.supabase.test';
const ANON = 'anonkey-for-browser-tests-only';
const CONSENT = /CONSENT_VERSION = '([^']+)'/.exec(readFileSync(path.join(repo, 'site/mail.js'), 'utf8'))[1];

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`ok   ${name}`); }
  else { failed++; failures.push(name); console.log(`FAIL ${name}${detail ? ' :: ' + String(detail).slice(0, 300) : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function eventually(fn, ms = 8000) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(60); }
  return false;
}

/* ---------- shim over private PostgreSQL ---------- */
function startShim() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', path.join(here, 'browser_pgrest_shim.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('shim did not start within 90 s\n' + err.slice(-2000))); }, 90000);
    child.stdout.on('data', d => {
      out += d;
      const m = /PORT (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    });
    child.stderr.on('data', d => { err += d; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`shim exited (${code}) before announcing a port\n` + err.slice(-2000))); });
  });
}
let shim;
async function stopShim() {
  if (shim.child.exitCode !== null) return;
  // EOF lets the Python context manager stop its private PostgreSQL. Sending
  // SIGTERM immediately after EOF races that cleanup and leaves the DB alive.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      shim.child.kill('SIGTERM');
      reject(new Error('private database shim cleanup exceeded 15 s'));
    }, 15000);
    shim.child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`private database shim exited ${code} during cleanup`));
    });
    shim.child.stdin.end();
  });
}
const shimUrl = () => `http://127.0.0.1:${shim.port}`;
async function shimPost(p, body, headers = {}) {
  const r = await fetch(shimUrl() + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, text };
}
async function sqlOne(sql) { const r = await shimPost('/_test/sql', { sql }); if (r.body.err) throw new Error(r.body.err); return (r.body.out || '').trim(); }
async function newUser(email) { return (await shimPost('/_test/user', { email })).body.id; }
/* a pending subscription whose confirmation mail "was sent" now; returns its tokens */
async function newSub(email) {
  const r = await shimPost('/rest/v1/rpc/dewfpga_subscribe', { p_email: email, p_consent_text_version: CONSENT, p_source: 'site' }, { 'X-Role': 'anon' });
  if (r.status !== 200) throw new Error('subscribe via shim: ' + r.status + ' ' + r.text);
  await sqlOne(`update public.dewfpga_subscribers set confirm_sent_at = now() where email = '${email}'`);
  const [confirm, unsub] = (await sqlOne(`select confirm_token || ' ' || unsubscribe_token from public.dewfpga_subscribers where email = '${email}'`)).split(' ');
  return { confirm, unsub };
}
async function row(email) {
  const r = await sqlOne(`select coalesce(confirmed_at::text,'-') || '|' || coalesce(unsubscribed_at::text,'-') || '|' || coalesce(user_id::text,'-') from public.dewfpga_subscribers where email = '${email}'`);
  const [confirmed, unsubscribed, user] = r.split('|');
  return { s: r, confirmed: confirmed !== '-', unsubscribed: unsubscribed !== '-', user: user === '-' ? null : user };
}

/* ---------- fake site + fake GoTrue, per context ---------- */
const files = {
  '/dewfpga/s.css': ['site/s.css', 'text/css'],
  '/dewfpga/s.js': ['site/s.js', 'application/javascript'],
  '/dewfpga/mail.js': ['site/mail.js', 'application/javascript'],
  '/dewfpga/newsletter/': ['site/newsletter/index.html', 'text/html'],
  '/dewfpga/newsletter/confirm/': ['site/newsletter/confirm/index.html', 'text/html'],
  '/dewfpga/newsletter/unsubscribe/': ['site/newsletter/unsubscribe/index.html', 'text/html'],
  '/dewfpga/account/': ['site/account/index.html', 'text/html'],
};
const configJs = on => on
  ? `window.DEWFPGA_MAIL = { supabaseUrl: ${JSON.stringify(SB)}, anonKey: ${JSON.stringify(ANON)}, siteUrl: ${JSON.stringify(SITE)} };\n`
  : `window.DEWFPGA_MAIL = { supabaseUrl: "", anonKey: "", siteUrl: ${JSON.stringify(SITE)} };\n`;

function makeWorld(browser, opts = {}) {
  const world = {
    tokens: new Map(),          // bearer -> { sub, email }
    otp: [], logouts: [], requests: [], egress: new Map(),
    inject: null,               // { status } | { abort: true } for the next RPC
    mailJs: opts.mailJs !== false, configured: opts.configured !== false,
  };
  world.open = async (ctxOpts = {}) => {
    const context = await browser.newContext({ acceptDownloads: true, ...ctxOpts });
    await context.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      world.requests.push({ url: req.url(), method: req.method(), post: req.postData() || '', auth: req.headers()['authorization'] || '' });
      if (u.host === 'site.test') {
        if (u.pathname === '/dewfpga/config.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: configJs(world.configured) });
        if (u.pathname === '/dewfpga/mail.js' && !world.mailJs) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
        const f = files[u.pathname];
        if (f) return route.fulfill({ status: 200, contentType: f[1], body: readFileSync(path.join(repo, f[0])) });
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      }
      if (u.host === 'fake.supabase.test') {
        const bearer = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
        if (u.pathname === '/auth/v1/otp') { world.otp.push({ url: req.url(), body: req.postData() }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
        if (u.pathname === '/auth/v1/user') {
          const t = world.tokens.get(bearer);
          if (!t) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"invalid JWT"}' });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: t.sub, email: t.email }) });
        }
        if (u.pathname === '/auth/v1/logout') { world.logouts.push(req.url()); if (world.logoutAbort) return route.abort('connectionfailed'); return route.fulfill({ status: 204, body: '' }); }
        if (u.pathname.startsWith('/rest/v1/rpc/')) {
          const loseResponse = world.inject?.afterRpcAbort;
          if (world.inject) { const inj = world.inject; world.inject = null;
            if (inj.abort) return route.abort('connectionfailed');
            if (!loseResponse) return route.fulfill({ status: inj.status, contentType: 'application/json', body: JSON.stringify({ message: 'injected ' + inj.status }) }); }
          let role, claims = '';
          if (bearer === ANON) role = 'anon';
          else { const t = world.tokens.get(bearer); if (!t) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"JWT expired"}' });
            role = 'authenticated'; claims = JSON.stringify({ sub: t.sub, email: t.email, role: 'authenticated' }); }
          const r = await fetch(shimUrl() + u.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': role, 'X-Claims': claims }, body: req.postData() || '{}' });
          if (loseResponse) { await r.text(); return route.abort('connectionfailed'); }
          return route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no such endpoint"}' });
      }
      world.egress.set(u.host, (world.egress.get(u.host) || 0) + 1);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.errors = []; page.on('pageerror', e => page.errors.push(String(e)));
    page.on('dialog', d => (world.dialog || (x => x.dismiss()))(d));
    page.close2 = () => context.close();
    return page;
  };
  world.liveToken = (sub, email) => { const t = 'live-token-' + Math.random().toString(36).slice(2) + '-' + Date.now(); world.tokens.set(t, { sub, email }); return t; };
  world.mentions = s => world.requests.filter(r => r.url.includes(s) || r.post.includes(s) || r.auth.includes(s));
  world.rpcCalls = fn => world.requests.filter(r => r.url.includes('/rest/v1/rpc/' + fn));
  return world;
}
const text = (page, id) => page.locator('#' + id).innerText();
/* goto via about:blank: a hash-only change on the same path would not reload the page */
async function nav(page, url) { await page.goto('about:blank'); await page.goto(url); }
const noscriptVisible = page => page.locator('noscript p').first().isVisible(); // Playwright's text engine skips <noscript> subtrees
const disabledAll = (page, sel) => page.$$eval(sel, els => els.every(e => e.disabled));
const storage = page => page.evaluate(() => sessionStorage.getItem('dewfpga.session'));
async function signIn(page, world, token) {
  await nav(page, `${SITE}/account/#access_token=${token}&refresh_token=rt&expires_in=3600&type=magiclink`);
  await eventually(() => page.evaluate(() => !document.getElementById('view-signed-out').hidden === false || !document.getElementById('view-no-account').hidden || !document.getElementById('view-account').hidden));
}

/* ---------- the cases ---------- */
async function run(browserName) {
  const bt = pw[browserName];
  const browser = await bt.launch();
  const tag = `${browserName}-${Date.now().toString(36)}`;
  const em = n => `${n}-${tag}@browser.test`;
  const N = s => `${browserName}: ${s}`;

  /* 1. JavaScript off: nothing can be sent, the noscript line is visible */
  { const w = makeWorld(browser); const page = await w.open({ javaScriptEnabled: false });
    await page.goto(`${SITE}/newsletter/`);
    check(N('noJS: noscript explanation visible'), await noscriptVisible(page));
    check(N('noJS: every control disabled'), await disabledAll(page, '#subscribe-form button, #subscribe-form input'));
    await page.locator('#sub-email').fill('leak@browser.test', { force: true }).catch(() => {});
    await page.locator('#subscribe-form button[type=submit]').click({ force: true }).catch(() => {});
    await sleep(400);
    check(N('noJS: URL unchanged after forced submit (no native GET leak)'), page.url() === `${SITE}/newsletter/`, page.url());
    check(N('noJS: no request carried the address'), w.mentions('leak@browser.test').length === 0);
    for (const p of ['newsletter/confirm/', 'newsletter/unsubscribe/', 'account/']) {
      await nav(page, `${SITE}/${p}#t=00000000-0000-4000-8000-000000000000`);
      check(N(`noJS ${p}: noscript visible + controls disabled`), (await noscriptVisible(page)) && await disabledAll(page, 'main form button, main form input'));
    }
    await page.close2(); }

  /* 2. mail.js fails to load: honest status, nothing enabled, nothing sent */
  { const w = makeWorld(browser, { mailJs: false }); const page = await w.open();
    await page.goto(`${SITE}/newsletter/`); await sleep(300);
    check(N('script 404: loading line stays'), (await text(page, 'subscribe-status')).includes('the script failed to load and nothing was sent'));
    check(N('script 404: controls stay disabled'), await disabledAll(page, '#subscribe-form button, #subscribe-form input'));
    await page.goto(`${SITE}/account/`); await sleep(300);
    check(N('script 404 account: controls disabled + loading line'), (await disabledAll(page, '#signin-form button, #signin-form input')) && (await text(page, 'signin-status')).includes('failed to load'));
    check(N('script 404: zero Supabase requests'), w.requests.filter(r => r.url.includes('fake.supabase.test')).length === 0);
    await page.close2(); }

  /* 3. Empty config: pages say so and stay closed */
  { const w = makeWorld(browser, { configured: false }); const page = await w.open();
    for (const [p, st] of [['newsletter/', 'subscribe-status'], ['newsletter/confirm/#t=00000000-0000-4000-8000-000000000000', 'confirm-status'], ['newsletter/unsubscribe/#t=00000000-0000-4000-8000-000000000000', 'unsubscribe-status'], ['account/', 'signin-status']]) {
      await page.goto(`${SITE}/${p}`); await sleep(200);
      check(N(`empty config ${p.split('#')[0]}: "Not open yet" + disabled`), (await text(page, st)).startsWith('Not open yet') && await disabledAll(page, 'main form button, main form input'));
    }
    check(N('empty config: zero Supabase requests'), w.requests.filter(r => r.url.includes('fake.supabase.test')).length === 0);
    await page.close2(); }

  /* A committed request can lose its response: do not report "nothing changed". */
  { const w = makeWorld(browser); const page = await w.open(); const email = em('lost-response');
    await page.goto(`${SITE}/newsletter/`);
    await eventually(() => page.$eval('#subscribe-form', f => !f.hasAttribute('data-off')));
    await page.locator('#sub-email').fill(email);
    await page.locator('#sub-consent').check();
    w.inject = { afterRpcAbort: true };
    await page.locator('#subscribe-form button[type=submit]').click();
    check(N('lost response: UI reports uncertainty after actual SQL commit'),
      await eventually(async () => (await text(page, 'subscribe-status')).includes('may have been processed')) &&
      await sqlOne(`select count(*) from public.dewfpga_subscribers where email = '${email}'`) === '1');
    await page.close2(); }

  /* A failed logout clears this tab but cannot promise server revocation. */
  { const w = makeWorld(browser); const page = await w.open(); const email = em('logout-failure');
    const uid = await newUser(email); const token = w.liveToken(uid, email);
    await signIn(page, w, token);
    await eventually(() => page.locator('.signout-btn:visible').count());
    w.logoutAbort = true;
    await page.locator('.signout-btn:visible').click();
    check(N('failed logout: local clear and explicit unconfirmed server revocation'),
      await eventually(async () => (await text(page, 'signin-status')).includes('revocation could not be confirmed')) &&
      (await storage(page)) === null);
    await page.close2(); }

  /* 4. Happy path: subscribe -> confirm (anon) -> reuse -> unsubscribe */
  { const w = makeWorld(browser); const page = await w.open(); const email = em('happy');
    await page.goto(`${SITE}/newsletter/`);
    await eventually(() => page.$eval('#subscribe-form', f => !f.hasAttribute('data-off')));
    check(N('subscribe: loading line cleared, controls enabled'), (await text(page, 'subscribe-status')) === '' && !(await disabledAll(page, '#subscribe-form button')));
    await page.locator('#sub-email').fill(email);
    await page.locator('#subscribe-form button[type=submit]').click();
    check(N('subscribe: consent required before anything is sent'), (await text(page, 'subscribe-status')).includes('Tick the consent box') && w.rpcCalls('dewfpga_subscribe').length === 0);
    await page.locator('#sub-consent').check();
    await page.locator('#subscribe-form button[type=submit]').click();
    check(N('subscribe: ok text'), await eventually(async () => (await text(page, 'subscribe-status')).startsWith('If this address can be subscribed')));
    check(N('subscribe: one anon RPC, no personal bearer'), w.rpcCalls('dewfpga_subscribe').length === 1 && w.rpcCalls('dewfpga_subscribe')[0].auth === 'Bearer ' + ANON);
    await sqlOne(`update public.dewfpga_subscribers set confirm_sent_at = now() where email = '${email}'`);
    const [ct, ut] = (await sqlOne(`select confirm_token || ' ' || unsubscribe_token from public.dewfpga_subscribers where email = '${email}'`)).split(' ');
    await nav(page, `${SITE}/newsletter/confirm/#t=${ct}`);
    await eventually(() => page.$eval('#confirm-form', f => !f.hasAttribute('data-off')));
    check(N('confirm: token stripped from address bar'), !page.url().includes('#'), page.url());
    check(N('confirm: nothing sent before the click'), w.rpcCalls('dewfpga_confirm').length === 0);
    await page.locator('#confirm-form button[type=submit]').click();
    check(N('confirm: "Confirmed."'), await eventually(async () => (await text(page, 'confirm-status')).startsWith('Confirmed.')));
    check(N('confirm: row confirmed, not linked'), (r => r.confirmed && !r.unsubscribed && !r.user)(await row(email)), (await row(email)).s);
    await nav(page, `${SITE}/newsletter/confirm/#t=${ct}`);
    await eventually(() => page.$eval('#confirm-form', f => !f.hasAttribute('data-off')));
    await page.locator('#confirm-form button[type=submit]').click();
    check(N('confirm reuse: "not valid any more" + 48 hours'), await eventually(async () => /not valid any more.*48 hours/.test(await text(page, 'confirm-status'))));
    await nav(page, `${SITE}/newsletter/unsubscribe/#t=${ut}`);
    await eventually(() => page.$eval('#unsubscribe-form', f => !f.hasAttribute('data-off')));
    check(N('unsubscribe: link form hidden without a session'), await page.$eval('#link-form', f => f.hidden));
    await page.locator('#unsubscribe-form button[type=submit]').click();
    check(N('unsubscribe: "Unsubscribed."'), await eventually(async () => (await text(page, 'unsubscribe-status')).startsWith('Unsubscribed.')));
    check(N('unsubscribe: row unsubscribed'), (r => r.confirmed && r.unsubscribed && !r.user)(await row(email)), (await row(email)).s);
    check(N('happy path: no page errors'), page.errors.length === 0, page.errors.join('; '));
    await page.close2(); }

  /* 5. Account: OTP request, magic link, enrol, export, link, logout */
  { const w = makeWorld(browser); const page = await w.open(); const email = em('acct');
    await page.goto(`${SITE}/account/`);
    await eventually(() => page.$eval('#signin-form', f => !f.hasAttribute('data-off')));
    check(N('account: signed-out view, loading line cleared'), (await text(page, 'signin-status')) === '' && !(await page.$eval('#view-signed-out', e => e.hidden)));
    await page.locator('#signin-email').fill(email);
    await page.locator('#signin-form button[type=submit]').click();
    check(N('otp: ok text without fixed validity numbers'), await eventually(async () => { const t = await text(page, 'signin-status'); return t.startsWith('If sign-in is possible') && !/one hour|60 seconds|7 days/.test(t); }));
    const otp = w.otp[0] || {};
    check(N('otp: create_user:true + redirect_to account page'), w.otp.length === 1 && JSON.parse(otp.body).create_user === true && JSON.parse(otp.body).email === email && otp.url.includes('redirect_to=' + encodeURIComponent(SITE + '/account/')), otp.url);
    const uid = await newUser(email); const tok = w.liveToken(uid, email);
    await signIn(page, w, tok);
    check(N('magic link: hash stripped'), !page.url().includes('#'), page.url());
    check(N('magic link: session stored in sessionStorage'), ((await storage(page)) || '').includes(tok));
    check(N('magic link: no-account view with email'), await eventually(() => page.$eval('#view-no-account', e => !e.hidden)) && (await page.$eval('#view-no-account .signed-in-as', e => e.textContent)) === email);
    check(N('render: export_me carried the session bearer, never the anon key'), w.rpcCalls('dewfpga_export_me').every(r => r.auth === 'Bearer ' + tok) && w.rpcCalls('dewfpga_export_me').length >= 1);
    await page.locator('#enrol-form button[type=submit]').click();
    check(N('enrol: account view appears'), await eventually(() => page.$eval('#view-account', e => !e.hidden)));
    check(N('enrol: created time shown, 0 linked'), /UTC$/.test(await text(page, 'acct-created')) && (await text(page, 'acct-linked')) === '0');
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await page.locator('#export-btn').click();
    const d = await dl;
    check(N('export: download named dewfpga-account-YYYY-MM-DD.json'), d && /^dewfpga-account-\d{4}-\d{2}-\d{2}\.json$/.test(d.suggestedFilename()), d && d.suggestedFilename());
    check(N('export: status "Export downloaded."'), await eventually(async () => (await text(page, 'rights-status')).startsWith('Export downloaded.')));
    /* link a subscription from the unsubscribe page while signed in */
    const sub = await newSub(em('acct-sub'));
    await nav(page, `${SITE}/newsletter/unsubscribe/#t=${sub.unsub}`);
    await eventually(() => page.$eval('#link-form', f => !f.hasAttribute('data-off')));
    check(N('link: link form visible with a session'), !(await page.$eval('#link-form', f => f.hidden)));
    await page.locator('#link-form button[type=submit]').click();
    check(N('link: "Linked."'), await eventually(async () => (await text(page, 'link-status')).startsWith('Linked.')));
    check(N('link: row user_id set'), (await row(em('acct-sub'))).user === uid);
    /* confirm with a session links too */
    const sub2 = await newSub(em('acct-conf'));
    await nav(page, `${SITE}/newsletter/confirm/#t=${sub2.confirm}`);
    await eventually(() => page.$eval('#confirm-form', f => !f.hasAttribute('data-off')));
    check(N('confirm signed in: promise shown before click'), (await text(page, 'confirm-status')).includes('also links the subscription'));
    await page.locator('#confirm-form button[type=submit]').click();
    check(N('confirm signed in: "Confirmed and linked"'), await eventually(async () => (await text(page, 'confirm-status')).startsWith('Confirmed and linked')));
    check(N('confirm signed in: row confirmed + user_id'), (r => r.confirmed && !r.unsubscribed && r.user === uid)(await row(em('acct-conf'))), (await row(em('acct-conf'))).s);
    await page.goto(`${SITE}/account/`);
    check(N('account: linked count 2 after link + confirm'), await eventually(async () => (await text(page, 'acct-linked')) === '2'));
    await page.locator('#view-account .signout-btn').click();
    check(N('logout: scope=local, session cleared, honest copy'), await eventually(async () => w.logouts.length === 1 && w.logouts[0].includes('scope=local') && (await storage(page)) === null && (await text(page, 'signin-status')).includes('Other devices and other apps using the same sign-in stay signed in')), w.logouts.join());
    check(N('account flow: no page errors'), page.errors.length === 0, page.errors.join('; '));
    check(N('account flow: no egress to any other host'), w.egress.size === 0 || [...w.egress.keys()].every(h => h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'), [...w.egress.keys()].join());
    await page.close2(); }

  /* 6. Malformed / expired / rejected hash; storage blocked */
  { const w = makeWorld(browser); const page = await w.open();
    await nav(page, `${SITE}/account/#access_token=%E0%A4%A&refresh_token=x&type=magiclink`);
    await sleep(500);
    check(N('malformed hash: no page error'), page.errors.length === 0, page.errors.join('; '));
    check(N('malformed hash: explained, hash removed, form usable'), (await text(page, 'signin-status')).startsWith('The sign-in link could not be read') && !page.url().includes('#') && !(await disabledAll(page, '#signin-form button')));
    check(N('malformed hash: fragment never sent anywhere'), w.mentions('%E0%A4%A').length === 0 && w.mentions('access_token').length === 0);
    await nav(page, `${SITE}/account/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    check(N('rejected hash: GoTrue error shown, hash removed'), await eventually(async () => (await text(page, 'signin-status')).startsWith('Sign-in link rejected: otp_expired') && !page.url().includes('#')));
    await nav(page, `${SITE}/account/#access_token=already-expired-token-abcdefgh&expires_in=0&type=magiclink`);
    check(N('expired magic link: warned, nothing stored, token never sent'), await eventually(async () => (await text(page, 'signin-status')).startsWith('The sign-in link had already expired')) && (await storage(page)) === null && w.mentions('already-expired-token').length === 0);
    await page.close2();
    const page2 = await w.open();
    await page2.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } }); });
    await page2.goto(`${SITE}/account/#access_token=live-token-blocked-storage-abcdef&expires_in=3600&type=magiclink`);
    await sleep(500);
    check(N('storage blocked: no page error, honest text, sign-in off'), page2.errors.length === 0 && (await text(page2, 'signin-status')).includes('sessionStorage is blocked or full') && await disabledAll(page2, '#signin-form button, #signin-form input'), page2.errors.join('; ') + ' | ' + await text(page2, 'signin-status'));
    check(N('storage blocked: token never sent, hash removed'), w.mentions('live-token-blocked-storage').length === 0 && !page2.url().includes('#'));
    await page2.close2(); }

  /* 7. Expiry and failures during export/delete/link/confirm */
  { const w = makeWorld(browser); const page = await w.open(); const email = em('exp');
    const uid = await newUser(email); const tok = w.liveToken(uid, email);
    await signIn(page, w, tok);
    await page.locator('#enrol-form button[type=submit]').click();
    await eventually(() => page.$eval('#view-account', e => !e.hidden));
    /* 7a server-side expiry during export */
    w.tokens.delete(tok); const before = w.requests.length;
    await page.locator('#export-btn').click();
    check(N('export, token revoked: EXPIRED text, signed-out view, storage cleared'), await eventually(async () => (await text(page, 'signin-status')).startsWith('Your sign-in has expired') && (await storage(page)) === null && !(await page.$eval('#view-signed-out', e => e.hidden))));
    check(N('export, token revoked: no retry with the anon key'), w.requests.slice(before).every(r => !r.url.includes('/rest/v1/rpc/') || r.auth !== 'Bearer ' + ANON));
    /* 7b client-side expiry: nothing leaves the browser */
    const tok2 = w.liveToken(uid, email);
    await signIn(page, w, tok2);
    await eventually(() => page.$eval('#view-account', e => !e.hidden));
    await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('dewfpga.session')); s.expires_at = 1; sessionStorage.setItem('dewfpga.session', JSON.stringify(s)); });
    const b2 = w.requests.length;
    w.dialog = d => d.accept();
    await page.locator('#delete-btn').click();
    check(N('delete, session expired locally: EXPIRED, zero requests, nothing deleted'), await eventually(async () => (await text(page, 'signin-status')).startsWith('Your sign-in has expired')) && w.requests.length === b2 && (await sqlOne(`select count(*) from public.dewfpga_profiles where user_id = '${uid}'`)) === '1');
    /* 7c transient 503 keeps the session, retry recovers */
    const tok3 = w.liveToken(uid, email);
    w.inject = { status: 503 };
    await signIn(page, w, tok3);
    check(N('render 503: session kept, retry offered, honest text'), await eventually(async () => (await text(page, 'signin-status')).includes('Could not load the account right now') && (await text(page, 'signin-status')).includes('(503)') && !(await page.$eval('#retry-btn', b => b.hidden))) && ((await storage(page)) || '').includes(tok3));
    await page.locator('#retry-btn').click();
    check(N('render 503: retry recovers to account view'), await eventually(() => page.$eval('#view-account', e => !e.hidden)));
    /* 7d network error on export */
    w.inject = { abort: true };
    await page.locator('#export-btn').click();
    check(N('export network error: explained, still signed in'), await eventually(async () => (await text(page, 'rights-status')).includes('could not confirm the result (network error)')) && !(await page.$eval('#view-account', e => e.hidden)) && ((await storage(page)) || '').includes(tok3));
    /* 7e 403 keeps the session */
    w.inject = { status: 403 };
    await page.locator('#export-btn').click();
    check(N('export 403: "not allowed", session kept'), await eventually(async () => (await text(page, 'rights-status')).startsWith('not allowed')) && ((await storage(page)) || '').includes(tok3));
    /* 7f delete: cancel, 500, success */
    w.dialog = d => d.dismiss(); const b3 = w.rpcCalls('dewfpga_delete_me').length;
    await page.locator('#delete-btn').click(); await sleep(300);
    check(N('delete cancelled: no RPC'), w.rpcCalls('dewfpga_delete_me').length === b3);
    w.dialog = d => d.accept(); w.inject = { status: 500 };
    await page.locator('#delete-btn').click();
    check(N('delete 500: error shown, account kept, button re-enabled'), await eventually(async () => (await text(page, 'rights-status')).includes('(500)')) && !(await page.$eval('#view-account', e => e.hidden)) && !(await page.$eval('#delete-btn', b => b.disabled)));
    const linked = await newSub(em('exp-linked'));
    await shimPost('/rest/v1/rpc/dewfpga_link_subscription', { p_token: linked.unsub }, { 'X-Role': 'authenticated', 'X-Claims': JSON.stringify({ sub: uid, email, role: 'authenticated' }) });
    await page.locator('#delete-btn').click();
    check(N('delete ok: signed out with scope=local, honest note'), await eventually(async () => (await text(page, 'signin-status')).startsWith('dewfpga account record and linked subscriptions deleted') && (await storage(page)) === null) && w.logouts.some(u => u.includes('scope=local')));
    check(N('delete ok: profile and linked row gone'), (await sqlOne(`select count(*) from public.dewfpga_profiles where user_id = '${uid}'`)) === '0' && (await sqlOne(`select count(*) from public.dewfpga_subscribers where email = '${em('exp-linked')}'`)) === '0');
    /* 7g delete with no profile -> false -> honest note */
    const tok4 = w.liveToken(uid, email);
    await signIn(page, w, tok4);
    check(N('after delete: no-account view again'), await eventually(() => page.$eval('#view-no-account', e => !e.hidden)));
    /* 7h link with revoked session */
    const ls = await newSub(em('exp-link'));
    await nav(page, `${SITE}/newsletter/unsubscribe/#t=${ls.unsub}`);
    await eventually(() => page.$eval('#link-form', f => !f.hasAttribute('data-off')));
    w.tokens.delete(tok4);
    await page.locator('#link-form button[type=submit]').click();
    check(N('link, token revoked: EXPIRED warn, link form hidden, unsubscribe still possible'), await eventually(async () => (await text(page, 'link-status')).startsWith('Your sign-in has expired') && (await page.$eval('#link-form', f => f.hidden))) && !(await disabledAll(page, '#unsubscribe-form button')));
    check(N('link, token revoked: row untouched'), (await row(em('exp-link'))).user === null);
    /* 7i promised link, session expired locally before the click */
    const tok5 = w.liveToken(uid, email);
    await signIn(page, w, tok5);
    const c1 = await newSub(em('exp-c1'));
    await nav(page, `${SITE}/newsletter/confirm/#t=${c1.confirm}`);
    await eventually(() => page.$eval('#confirm-form', f => !f.hasAttribute('data-off')));
    await page.evaluate(() => sessionStorage.removeItem('dewfpga.session'));
    const b4 = w.rpcCalls('dewfpga_confirm').length;
    await page.locator('#confirm-form button[type=submit]').click();
    check(N('confirm, promise broken locally: warn + explicit choice, nothing sent'), await eventually(async () => (await text(page, 'confirm-status')).includes('would NOT link') && !(await page.$eval('#confirm-anon-btn', b => b.hidden))) && w.rpcCalls('dewfpga_confirm').length === b4);
    await page.locator('#confirm-anon-btn').click();
    check(N('confirm, explicit anonymous choice: "Confirmed." unlinked'), await eventually(async () => (await text(page, 'confirm-status')).startsWith('Confirmed.')) && (r => r.confirmed && !r.user)(await row(em('exp-c1'))));
    /* 7j promised link, token revoked server-side */
    const tok6 = w.liveToken(uid, email);
    await signIn(page, w, tok6);
    const c2 = await newSub(em('exp-c2'));
    await nav(page, `${SITE}/newsletter/confirm/#t=${c2.confirm}`);
    await eventually(() => page.$eval('#confirm-form', f => !f.hasAttribute('data-off')));
    w.tokens.delete(tok6);
    await page.locator('#confirm-form button[type=submit]').click();
    check(N('confirm, token revoked: NOT confirmed, explicit choice, storage cleared'), await eventually(async () => (await text(page, 'confirm-status')).includes('NOT confirmed and NOT linked') && !(await page.$eval('#confirm-anon-btn', b => b.hidden))) && (await storage(page)) === null && !(await row(em('exp-c2'))).confirmed);
    await page.locator('#confirm-anon-btn').click();
    check(N('confirm, token revoked then anonymous: "Confirmed."'), await eventually(async () => (await text(page, 'confirm-status')).startsWith('Confirmed.')) && (r => r.confirmed && !r.user)(await row(em('exp-c2'))));
    check(N('failure flows: no page errors'), page.errors.length === 0, page.errors.join('; '));
    check(N('failure flows: no personal bearer used after revocation'), w.requests.every(r => !(r.url.includes('/rest/v1/rpc/dewfpga_export_me') && r.auth === 'Bearer ' + ANON)));
    await page.close2(); }

  await browser.close();
}

(async () => {
  shim = await startShim();
  console.log(`shim: private PostgreSQL via browser_pgrest_shim.py on 127.0.0.1:${shim.port}; playwright ${pw.chromium ? createRequire(path.join(pwPath, 'package.json'))('./package.json').version : '?'}`);
  try {
    for (const b of browsersWanted) {
      if (!pw[b]) { check(`${b}: available in playwright`, false, 'unknown browser'); continue; }
      try { await run(b); } catch (e) { check(`${b}: suite completed`, false, e.stack || e); }
    }
  } finally {
    await stopShim();
  }
  console.log(`passed ${passed}, failed ${failed}`);
  if (failures.length) console.log('failed: ' + failures.join(' | ').slice(0, 2000));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
