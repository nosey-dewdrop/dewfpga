/* dewfpga newsletter + account pages. Served as /dewfpga/mail.js. No dependencies, no cookies.
   Talks to Supabase PostgREST (rpc/dewfpga_*) and GoTrue (/auth/v1/*) with fetch.
   The session (magic-link tokens) lives in sessionStorage of this tab only.
   The HTML ships every control disabled; this script enables a form only after its handler is
   attached and the page is configured, so a missing or failed script can never submit anything.
   Pure helpers are exported on DEWFPGA_MAIL_LIB so mail/tests/test_pages.py can run them in node. */
(function (root) {
  'use strict';
  var CONSENT_VERSION = '2026-10-03';
  var SESSION_KEY = 'dewfpga.session';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function config() {
    var c = root.DEWFPGA_MAIL || {};
    return {
      url: String(c.supabaseUrl || '').replace(/\/+$/, ''),
      key: String(c.anonKey || ''),
      site: String(c.siteUrl || 'https://nosey-dewdrop.github.io/dewfpga').replace(/\/+$/, '')
    };
  }
  function configured(c) { return !!(c.url && c.key && /^https:\/\//.test(c.url)); }

  /* "#t=<uuid>" -> uuid or null. Anything else (longer, extra params, not a uuid) is rejected. */
  function tokenFromHash(hash) {
    var m = /^#t=([0-9a-f-]{36})$/i.exec(hash || '');
    return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
  }
  /* GoTrue implicit flow returns "#access_token=..&refresh_token=..&expires_at=..&type=magiclink",
     or "#error=..&error_code=..&error_description=..". A hash that cannot be percent-decoded returns
     { malformed: true } instead of throwing, so the caller can still strip it and keep the page usable. */
  function parseAuthHash(hash) {
    if (!hash || hash.charAt(0) !== '#') return null;
    var p = {}, parts = hash.slice(1).split('&');
    try {
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        if (kv[0]) p[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      }
    } catch (e) { return { malformed: true }; }
    if (p.error || p.error_code) return { error: p.error_code || p.error, description: p.error_description || '' };
    if (p.access_token) {
      return {
        session: {
          access_token: p.access_token,
          refresh_token: p.refresh_token || '',
          /* expires_at wins; else now + expires_in. An explicit expires_in=0 is "already expired", not
             "missing": only a hash without either field falls back to GoTrue's default hour. */
          expires_at: /^\d+$/.test(p.expires_at || '') ? Number(p.expires_at)
            : Math.floor(Date.now() / 1000) + (/^\d+$/.test(p.expires_in || '') ? Number(p.expires_in) : 3600),
          type: p.type || ''
        }
      };
    }
    return null;
  }
  function sessionValid(s, now) {
    now = now === undefined ? Math.floor(Date.now() / 1000) : now;
    return !!(s && typeof s.access_token === 'string' && s.access_token.length > 20 && Number(s.expires_at) > now + 15);
  }
  /* sessionStorage can be missing, blocked, full, or throw on any single call. Every access is guarded
     and reports what happened instead of pretending. */
  function storage() {
    try { return root.sessionStorage || null; } catch (e) { return null; }
  }
  /* -> { session: <valid session>|null, error: ''|'blocked'|'expired' } */
  function readSession() {
    var st = storage();
    if (!st) return { session: null, error: 'blocked' };
    var raw;
    try { raw = st.getItem(SESSION_KEY); } catch (e) { return { session: null, error: 'blocked' }; }
    if (raw === null || raw === undefined || raw === '') return { session: null, error: '' };
    var s = null;
    try { s = JSON.parse(raw); } catch (e2) { s = null; }
    if (sessionValid(s)) return { session: s, error: '' };
    try { st.removeItem(SESSION_KEY); } catch (e3) { /* nothing left to do */ }
    return { session: null, error: s && s.access_token ? 'expired' : '' };
  }
  function loadSession() { return readSession().session; }
  /* -> true when stored, false when the browser refused (blocked, quota, private mode). */
  function saveSession(s) {
    var st = storage(); if (!st) return false;
    try { st.setItem(SESSION_KEY, JSON.stringify(s)); return st.getItem(SESSION_KEY) !== null; } catch (e) { return false; }
  }
  function clearSession() {
    var st = storage(); if (!st) return false;
    try { st.removeItem(SESSION_KEY); return true; } catch (e) { return false; }
  }

  /* Headers for PostgREST/GoTrue. The bearer is the user's session when a valid one is given, else the
     anon key. Calls that MUST be signed in go through authed() below and never reach the anon fallback. */
  function headers(c, session) {
    return {
      'Content-Type': 'application/json',
      'apikey': c.key,
      'Authorization': 'Bearer ' + (sessionValid(session) ? session.access_token : c.key)
    };
  }
  /* Error text shown to the user: status + provider message, never the request body or a token. */
  function errorText(status, body) {
    var msg = '';
    if (body && typeof body === 'object') msg = body.message || body.msg || body.error_description || body.error || body.hint || '';
    else if (typeof body === 'string') msg = body;
    msg = String(msg).slice(0, 200);
    if (status === 0) return 'could not confirm the result (network error); the request may have been processed';
    if (status === 429) return 'too many requests; try again later' + (msg ? ' (' + msg + ')' : '');
    if (status === 401) return 'sign-in not accepted' + (msg ? ': ' + msg : '');
    if (status === 403) return 'not allowed' + (msg ? ': ' + msg : '');
    if (status >= 500) return 'the service is unavailable right now (' + status + '); try again in a moment';
    return 'request failed (' + status + ')' + (msg ? ': ' + msg : '');
  }

  var lib = {
    CONSENT_VERSION: CONSENT_VERSION, SESSION_KEY: SESSION_KEY,
    config: config, configured: configured, tokenFromHash: tokenFromHash, parseAuthHash: parseAuthHash,
    sessionValid: sessionValid, headers: headers, errorText: errorText
  };
  root.DEWFPGA_MAIL_LIB = lib;
  if (typeof document === 'undefined') return;

  /* ---------- browser part ---------- */
  var C = config();
  var EXPIRED = 'Your sign-in has expired. Nothing was changed. Sign in again to continue.';
  var STORAGE_BLOCKED = 'This browser does not let the page keep a session (sessionStorage is blocked or full), so signing in cannot work here. Allow site data for this page or use another browser.';
  function $(id) { return document.getElementById(id); }
  function say(id, text, kind) {
    var el = $(id); if (!el) return;
    el.textContent = text; el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function controls(form) { return form ? form.querySelectorAll('button,input') : []; }
  function setBusy(form, busy) {
    if (!form) return;
    var els = controls(form), off = form.getAttribute('data-off') === '1';
    for (var i = 0; i < els.length; i++) els[i].disabled = !!busy || off;
  }
  /* The HTML ships controls disabled. Only a form whose handler is attached gets switched on. */
  function enable(form) { if (form) { form.removeAttribute('data-off'); setBusy(form, false); } }
  function keepOff(form) { if (form) { form.setAttribute('data-off', '1'); setBusy(form, true); } }
  function fail(status, body) { var e = new Error(errorText(status, body)); e.status = status; return e; }
  function fetchJson(url, opts, session) {
    opts = opts || {};
    opts.headers = headers(C, session);
    opts.credentials = 'omit';
    opts.referrerPolicy = 'no-referrer';
    opts.cache = 'no-store';
    var p;
    try { p = fetch(url, opts); } catch (e) { p = Promise.reject(e); }
    return p.then(function (r) {
      return r.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = t; }
        if (!r.ok) throw fail(r.status, body);
        return body;
      });
    }, function () { throw fail(0, null); });
  }
  function rpc(name, args, session) {
    return fetchJson(C.url + '/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) }, session);
  }
  /* A call that must carry the user's session. With no valid session it fails locally with
     e.expired, before anything is sent: it never downgrades to the anon key. A 401 from the service
     (token no longer accepted) is reported the same way. */
  function authed(name, args) {
    var r = readSession();
    if (!r.session) {
      var e = new Error(r.error === 'blocked' ? STORAGE_BLOCKED : EXPIRED);
      e.expired = true; e.storage = r.error === 'blocked';
      return Promise.reject(e);
    }
    return rpc(name, args, r.session).catch(function (err) {
      if (err.status === 401) { clearSession(); err.expired = true; err.message = EXPIRED; }
      throw err;
    });
  }
  function stripHash() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    if (location.hash) { try { location.hash = ''; } catch (e2) { /* ignore */ } }
  }
  function offline(form, statusId) {
    keepOff(form);
    say(statusId, 'Not configured yet: this page has no Supabase project set in config.js, so nothing is sent or stored.', 'warn');
  }

  /* ---------- newsletter: subscribe ---------- */
  function pageNewsletter() {
    var form = $('subscribe-form'); if (!form) return;
    $('consent-version').textContent = CONSENT_VERSION;
    if (!configured(C)) return offline(form, 'subscribe-status');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = ($('sub-email').value || '').trim();
      var consent = $('sub-consent').checked;
      if (!consent) return say('subscribe-status', 'Tick the consent box first; without it nothing is stored.', 'warn');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say('subscribe-status', 'That does not look like an email address.', 'warn');
      setBusy(form, true);
      say('subscribe-status', 'Sending…');
      rpc('dewfpga_subscribe', { p_email: email, p_consent_text_version: CONSENT_VERSION, p_source: 'site' })
        .then(function () {
          say('subscribe-status', 'If this address can be subscribed, a confirmation mail has been queued. Patch notes are sent only after you confirm. Mail is sent in batches when capacity is available, so delivery may take several days.', 'ok');
          form.reset();
        })
        .catch(function (e) { say('subscribe-status', e.message, 'err'); })
        .then(function () { setBusy(form, false); });
    });
    say('subscribe-status', '');
    enable(form);
  }

  /* ---------- newsletter: confirm (token in #t=, consumed on an explicit click) ---------- */
  function pageConfirm() {
    var form = $('confirm-form'); if (!form) return;
    var anonBtn = $('confirm-anon-btn');
    var token = tokenFromHash(location.hash);
    stripHash();
    if (!token) { keepOff(form); return say('confirm-status', 'No confirmation token in this link. Open the link from the confirmation mail again, or subscribe again.', 'warn'); }
    if (!configured(C)) return offline(form, 'confirm-status');
    var promisedLink = !!loadSession();
    say('confirm-status', '');
    if (promisedLink) say('confirm-status', 'You are signed in on the account page in this tab: confirming here also links the subscription to that dewfpga account (only if the account record exists).');
    function finish(ok) {
      token = null;
      if (anonBtn) anonBtn.hidden = true;
      if (ok === true) say('confirm-status', 'Confirmed. The next patch note comes by mail. Every mail carries its own unsubscribe link.', 'ok');
      else say('confirm-status', 'This link is not valid any more (already used, older than 48 hours, or unsubscribed). Subscribe again to get a fresh one.', 'warn');
    }
    function confirmWith(session, linked) {
      setBusy(form, true);
      say('confirm-status', linked ? 'Confirming and linking…' : 'Confirming…');
      return rpc('dewfpga_confirm', { p_token: token }, session)
        .then(function (ok) {
          if (ok === true && linked) say('confirm-status', 'Confirmed and linked to your signed-in account (if the account record exists; otherwise confirmed without a link). Every mail carries its own unsubscribe link.', 'ok');
          else finish(ok);
          if (ok === true) { token = null; if (anonBtn) anonBtn.hidden = true; }
        })
        .catch(function (e) {
          setBusy(form, false);
          if (linked && e.status === 401) {
            /* The service no longer accepts the session: nothing was confirmed. Same explicit choice as below. */
            clearSession(); promisedLink = true;
            if (anonBtn) anonBtn.hidden = false;
            return say('confirm-status', 'Your sign-in has expired, so the subscription was NOT confirmed and NOT linked. Sign in again on the account page in this tab and open the mail link again to link it, or confirm without linking below.', 'warn');
          }
          say('confirm-status', e.message, 'err');
        });
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!token) return;
      var s = loadSession();
      if (promisedLink && !s) {
        /* The sign-in this page promised to link with is gone. Do not confirm anonymously behind
           the user's back: explain and ask for an explicit choice. */
        if (anonBtn) anonBtn.hidden = false;
        return say('confirm-status', 'Your sign-in expired, so confirming now would NOT link the subscription to your account. Nothing was sent. Sign in again on the account page in this tab and open the mail link again to link it, or confirm without linking below.', 'warn');
      }
      confirmWith(s, !!s);
    });
    if (anonBtn) anonBtn.addEventListener('click', function () {
      if (!token) return;
      promisedLink = false;
      confirmWith(null, false);
    });
    enable(form);
    if (anonBtn) anonBtn.hidden = true;
  }

  /* ---------- newsletter: unsubscribe / link to account (token in #t=) ---------- */
  function pageUnsubscribe() {
    var form = $('unsubscribe-form'); if (!form) return;
    var linkForm = $('link-form');
    var token = tokenFromHash(location.hash);
    stripHash();
    if (!token) { keepOff(form); keepOff(linkForm); return say('unsubscribe-status', 'No token in this link. Use the unsubscribe link at the bottom of any dewfpga mail.', 'warn'); }
    if (!configured(C)) { offline(linkForm, 'link-status'); return offline(form, 'unsubscribe-status'); }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!token) return;
      setBusy(form, true); setBusy(linkForm, true);
      say('unsubscribe-status', 'Unsubscribing…');
      rpc('dewfpga_unsubscribe', { p_token: token })
        .then(function (ok) {
          token = null;
          if (ok === true) say('unsubscribe-status', 'Unsubscribed. No more mail from dewfpga to this address. The row is removed by the operator\'s cleanup after 30 days; there is no automatic schedule yet.', 'ok');
          else say('unsubscribe-status', 'This link is not valid any more; the address may already be unsubscribed.', 'warn');
        })
        .catch(function (e) { say('unsubscribe-status', e.message, 'err'); setBusy(form, false); setBusy(linkForm, false); });
    });
    enable(form);
    say('unsubscribe-status', '');
    if (linkForm) {
      if (!loadSession()) { linkForm.hidden = true; keepOff(linkForm); return; }
      linkForm.hidden = false;
      linkForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!token) return;
        setBusy(linkForm, true);
        say('link-status', 'Linking…');
        authed('dewfpga_link_subscription', { p_token: token })
          .then(function (ok) {
            if (ok === true) say('link-status', 'Linked. This subscription now shows up in the account export and is removed with the account.', 'ok');
            else say('link-status', 'Nothing linked: the token is not a live subscription.', 'warn');
          })
          .catch(function (e) {
            say('link-status', e.message + (e.expired && !e.storage ? ' Sign in again on the account page in this tab, then open the mail link again.' : ''), e.expired ? 'warn' : 'err');
            if (e.expired) { linkForm.hidden = true; keepOff(linkForm); }
          })
          .then(function () { setBusy(linkForm, false); });
      });
      enable(linkForm);
    }
  }

  /* ---------- account: magic link sign-in, explicit enrolment, rights ---------- */
  function pageAccount() {
    var signin = $('signin-form'); if (!signin) return;
    var views = { out: $('view-signed-out'), noacct: $('view-no-account'), acct: $('view-account') };
    var retryBtn = $('retry-btn');
    function show(which) {
      for (var k in views) if (views[k]) views[k].hidden = (k !== which);
      if (retryBtn) retryBtn.hidden = true;
    }
    if (!configured(C)) { show('out'); return offline(signin, 'signin-status'); }
    say('signin-status', '');

    /* The hash may carry tokens: take it out of the address bar BEFORE anything can throw on it. */
    var rawHash = location.hash;
    if (rawHash && rawHash.length > 1) stripHash();
    var parsed = parseAuthHash(rawHash);
    rawHash = null;
    if (parsed && parsed.malformed) say('signin-status', 'The sign-in link could not be read (it was damaged on the way, probably by a mail client). It has been removed from the address bar. Request a new link below.', 'err');
    else if (parsed && parsed.error) say('signin-status', 'Sign-in link rejected: ' + parsed.error + (parsed.description ? ' (' + parsed.description + ')' : '') + '. Request a new link.', 'err');
    else if (parsed && parsed.session) {
      if (!sessionValid(parsed.session)) say('signin-status', 'The sign-in link had already expired when it was opened. Request a new link.', 'warn');
      else if (!saveSession(parsed.session)) say('signin-status', 'The sign-in link was valid, but ' + STORAGE_BLOCKED.charAt(0).toLowerCase() + STORAGE_BLOCKED.slice(1) + ' You are not signed in.', 'err');
    }
    parsed = null;

    signin.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = ($('signin-email').value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say('signin-status', 'That does not look like an email address.', 'warn');
      if (readSession().error === 'blocked') return say('signin-status', STORAGE_BLOCKED, 'err');
      setBusy(signin, true);
      say('signin-status', 'Sending…');
      var redirect = C.site + '/account/';
      fetchJson(C.url + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
        method: 'POST', body: JSON.stringify({ email: email, create_user: true })
      })
        .then(function () { say('signin-status', 'If sign-in is possible for this address, a magic link is on its way. It works once and for a limited time; how long, and how often a new one can be requested, is set in the operator\'s Supabase project.', 'ok'); })
        .catch(function (e) { say('signin-status', e.message, 'err'); })
        .then(function () { setBusy(signin, false); });
    });

    /* scope=local: revoke THIS session only. Without it GoTrue revokes every session of the identity,
       on every device and in every app that shares the Supabase project. */
    function signOut(note) {
      var s = loadSession();
      clearSession();
      var done = function () { show('out'); if (note) say('signin-status', note, 'ok'); };
      if (!s) return done();
      fetchJson(C.url + '/auth/v1/logout?scope=local', { method: 'POST', body: '{}' }, s).then(done, function () {
        show('out');
        say('signin-status', (note ? note + ' ' : '') + 'Sign-in was cleared from this tab, but server session revocation could not be confirmed.', 'warn');
      });
    }
    /* Session gone -> sign-in view with an honest line. Transient failure -> keep the session, offer retry. */
    function onError(e) {
      if (e.expired || e.status === 401) { clearSession(); show('out'); say('signin-status', e.storage ? STORAGE_BLOCKED : EXPIRED, 'warn'); return; }
      if (e.status === 403) { say('signin-status', 'The service refused this session: ' + e.message + '. You are still signed in; sign out and in again if this persists.', 'err'); return; }
      show('out');
      if (retryBtn) retryBtn.hidden = false;
      say('signin-status', 'Could not load the account right now: ' + e.message + '. Your session is kept in this tab; retry or reload the page.', 'warn');
    }
    function render() {
      var r = readSession();
      if (!r.session) {
        show('out');
        if (r.error === 'blocked') say('signin-status', STORAGE_BLOCKED, 'err');
        else if (r.error === 'expired') say('signin-status', EXPIRED, 'warn');
        return;
      }
      var s = r.session;
      fetchJson(C.url + '/auth/v1/user', { method: 'GET' }, s)
        .then(function (user) {
          var email = (user && user.email) || '(no email on this sign-in)';
          var who = document.querySelectorAll('.signed-in-as');
          for (var i = 0; i < who.length; i++) who[i].textContent = email;
          return authed('dewfpga_export_me', {});
        })
        .then(function (exp) {
          if (!exp || !exp.account) return show('noacct');
          $('acct-created').textContent = String(exp.account.created_at || '').replace('T', ' ').slice(0, 16) + ' UTC';
          $('acct-linked').textContent = String((exp.newsletter || []).length);
          show('acct');
        })
        .catch(onError);
    }
    if (retryBtn) retryBtn.addEventListener('click', function () { say('signin-status', 'Retrying…'); render(); });
    var enrol = $('enrol-form');
    if (enrol) {
      enrol.addEventListener('submit', function (ev) {
        ev.preventDefault(); setBusy(enrol, true); say('enrol-status', 'Creating…');
        authed('dewfpga_enrol_me', {})
          .then(function () { say('enrol-status', ''); render(); })
          .catch(function (e) { if (e.expired) onError(e); else say('enrol-status', e.message, 'err'); })
          .then(function () { setBusy(enrol, false); });
      });
      enable(enrol);
    }
    var exportBtn = $('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      exportBtn.disabled = true; say('rights-status', 'Exporting…');
      authed('dewfpga_export_me', {})
        .then(function (exp) {
          var blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'dewfpga-account-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
          say('rights-status', 'Export downloaded. ' + (exp.newsletter_note || ''), 'ok');
        })
        .catch(function (e) { if (e.expired) onError(e); else say('rights-status', e.message, 'err'); })
        .then(function () { exportBtn.disabled = false; });
    });
    var deleteBtn = $('delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', function () {
      if (!root.confirm('Delete the dewfpga account record and the newsletter subscriptions linked to it? The shared sign-in identity stays (see the table above).')) return;
      deleteBtn.disabled = true; say('rights-status', 'Deleting…');
      authed('dewfpga_delete_me', {})
        .then(function (ok) {
          signOut(ok === true ? 'dewfpga account record and linked subscriptions deleted; signed out here. The shared sign-in identity still exists.' : 'Nothing to delete: no dewfpga account record for this sign-in. Signed out here.');
        })
        .catch(function (e) { if (e.expired) onError(e); else say('rights-status', e.message, 'err'); deleteBtn.disabled = false; });
    });
    var outBtns = document.querySelectorAll('.signout-btn');
    for (var i = 0; i < outBtns.length; i++) {
      outBtns[i].addEventListener('click', function () { signOut('Signed out of this session. Other devices and other apps using the same sign-in stay signed in.'); });
      outBtns[i].disabled = false;
    }
    if (exportBtn) exportBtn.disabled = false;
    if (deleteBtn) deleteBtn.disabled = false;
    if (readSession().error === 'blocked') { keepOff(signin); say('signin-status', STORAGE_BLOCKED, 'err'); show('out'); return; }
    enable(signin);
    render();
  }

  function start() {
    var main = document.querySelector('main[data-page]');
    var page = main ? main.getAttribute('data-page') : '';
    if (page === 'newsletter') pageNewsletter();
    else if (page === 'confirm') pageConfirm();
    else if (page === 'unsubscribe') pageUnsubscribe();
    else if (page === 'account') pageAccount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
