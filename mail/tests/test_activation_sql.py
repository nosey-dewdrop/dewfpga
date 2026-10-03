#!/usr/bin/env python3
"""mail/ops/preflight_readonly.sql and mail/ops/rollback_dewfpga.sql on a private PostgreSQL.

The operator's two activation scripts: the preflight must report without writing (an empty project,
001 alone, 001-003; a copy with a write injected is refused by the read-only transaction and leaves the
catalog and every row untouched), the rollback must remove exactly the dewfpga_ objects of 001-003
(another application's table with a CASCADE reference to auth.users, its rows and auth.users itself
are byte-identical afterwards; 001-003 apply cleanly again and subscribe -> confirm works) and must
refuse with ZERO drops when anything outside dewfpga depends on a dewfpga_ object (no CASCADE).
No Supabase project, no network, no mail. Counts PASS/FAIL, exit 1 when anything failed."""
import glob, os, re, subprocess, sys, tempfile, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pg_harness import Cluster, SQL_DIR

PASSED = 0
FAILED = 0
CLUSTER = None
OPS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ops")
PREFLIGHT = os.path.join(OPS_DIR, "preflight_readonly.sql")
ROLLBACK = os.path.join(OPS_DIR, "rollback_dewfpga.sql")
MIGRATIONS = ["001_dewfpga_newsletter.sql", "002_dewfpga_mail_ledger.sql", "003_dewfpga_account.sql"]

# what 001-003 leave behind, as preflight section 3f counts them
FULL = {"dewfpga_tables": 5, "dewfpga_functions": 19, "dewfpga_policies": 1, "dewfpga_indexes": 11, "dewfpga_sequences": 1, "dewfpga_views": 0}
EMPTY = {k: 0 for k in FULL}
H = "a" * 64
P = "e" * 64


def ok(cond, what):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"ok    {what}")
    else:
        FAILED += 1
        print(f"FAIL  {what}")
        if CLUSTER and CLUSTER.last is not None and CLUSTER.last.returncode != 0:
            print("last psql stderr:", CLUSTER.last.stderr.strip()[:600])


def strip_comments(text):
    return "\n".join(re.sub(r"--.*$", "", line) for line in text.splitlines())


def run_file(c, path, *extra):
    """psql -f path on the private cluster, the way the operator runs it (ON_ERROR_STOP, no psqlrc)."""
    c.last = subprocess.run(c._cmd(("-f", path, *extra)), text=True, capture_output=True)
    return c.last


def preflight(c):
    return run_file(c, PREFLIGHT, "-At", "-F", "\t")


def counts(out):
    return {m.group(1): int(m.group(2)) for m in re.finditer(r"^(dewfpga_(?:tables|functions|policies|indexes|sequences|views))\t(\d+)$", out, re.M)}


def parts(out):
    """section 8a as {(migration, part): True/False/None}; None = the role could not read the table that tells."""
    return {(m.group(1), m.group(2)): {"t": True, "f": False, "": None}[m.group(3)]
            for m in re.finditer(r"^(00[123])\t(.+?)\t([tf]?)$", out, re.M)}


def section(out, tag):
    """the data lines of one preflight section (tag like '4b.'), without its header and sub-header lines."""
    if f"== {tag}" not in out:
        return [f"<section {tag} missing from the report>"]
    seg = out.split(f"== {tag}", 1)[1]
    body = seg.split("\n== ", 1)[0]
    return [l for l in body.splitlines()[1:] if l.strip() and not l.startswith("   ")]


def headers(out):
    return [l for l in out.splitlines() if l.startswith("== ")]


def preflight_as(c, role):
    """the preflight run by another login role (trust auth on the private cluster)."""
    c.last = subprocess.run([c.psql, "-h", c.sock, "-U", role, "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                             "-f", PREFLIGHT, "-At", "-F", "\t"], text=True, capture_output=True)
    return c.last


def unexpected(out):
    seg = out.split("== 8b.", 1)[1].split("== end of preflight", 1)[0]
    return [l for l in seg.splitlines()[1:] if l.strip()]


# Everything the preflight could have changed: catalog of public and auth, acls, default acls, roles,
# extensions, sequences, and the row count of every table. Compared before/after as a whole.
SNAPSHOT = r"""
select * from (
  select 'rel' as k, n.nspname as a, c.relname as b, c.relkind::text as c, c.relrowsecurity::text as d, coalesce(c.relacl::text, '') as e
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'auth')
  union all
  select 'col', n.nspname, c.relname, a.attname,
         format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end, coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public', 'auth') and a.attnum > 0 and not a.attisdropped
  union all
  select 'fn', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
         md5(p.prosrc) || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'auth')
  union all
  select 'con', n.nspname, c.relname, k.conname, k.contype::text, pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'auth')
  union all
  select 'pol', schemaname, tablename, policyname, cmd::text, coalesce(qual, '') from pg_policies where schemaname in ('public', 'auth')
  union all
  select 'idx', schemaname, tablename, indexname, indexdef, '' from pg_indexes where schemaname in ('public', 'auth')
  union all
  select 'trg', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid), ''
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public', 'auth')
  union all
  select 'ext', e.extname, e.extversion, n.nspname, '', '' from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  union all
  select 'defacl', pg_get_userbyid(d.defaclrole), coalesce(n.nspname, ''), d.defaclobjtype::text, d.defaclacl::text, ''
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  union all
  select 'role', r.rolname, r.rolsuper::text, r.rolbypassrls::text, '', '' from pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
  union all
  select 'seq', schemaname, sequencename, coalesce(last_value::text, ''), '', '' from pg_sequences where schemaname in ('public', 'auth')
  union all
  select 'rows', n.nspname, c.relname,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text, '', ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'auth') and c.relkind in ('r', 'p')
) s order by 1, 2, 3, 4, 5, 6
"""


def snapshot(c):
    return c.rows(SNAPSHOT)


def non_dewfpga(snap):
    return [r for r in snap if not any("dewfpga" in f for f in r)]


def load(c, names):
    for n in names:
        with open(os.path.join(SQL_DIR, n), encoding="utf-8") as f:
            c.sql(f.read())


def subscribe_confirm_flow(c, email):
    """001's basic path as the browser and the mailer drive it: subscribe (anon) -> pending (service) ->
    mark sent (service) -> confirm (anon) -> recipient (service)."""
    c.sql(f"select public.dewfpga_subscribe('{email}', '2026-10-03', 'site')", role="anon")
    pend = c.rows(f"select id, confirm_token from public.dewfpga_pending_confirmations(20) where email = '{email}'", role="service_role")
    if len(pend) != 1:
        return f"pending list: {pend}"
    sid, tok = pend[0]
    if c.value(f"select public.dewfpga_mark_confirm_sent('{sid}', 1, '{tok}')", role="service_role") != "t":
        return "mark_confirm_sent false"
    if c.value(f"select public.dewfpga_confirm('{tok}')", role="anon") != "t":
        return "confirm false"
    rec = c.rows(f"select email from public.dewfpga_recipients() where email = '{email}'", role="service_role")
    return None if rec == [[email]] else f"recipients: {rec}"


def main():
    global CLUSTER
    pre_text = open(PREFLIGHT, encoding="utf-8").read()
    rb_text = open(ROLLBACK, encoding="utf-8").read()

    # ---------------------------------------------------------------- the files themselves
    # statements of the preflight, \echo lines dropped
    stmts = [s for s in strip_comments(pre_text).split(";") if s.strip() and not all(l.strip().startswith("\\") or not l.strip() for l in s.splitlines())]
    first = re.sub(r"\s+", " ", stmts[0].strip()).lower()
    last = re.sub(r"\s+", " ", stmts[-1].strip().splitlines()[-1]).lower()
    ok(first == "begin transaction read only", f"preflight: first statement is 'begin transaction read only' ({first!r})")
    ok(last == "rollback", f"preflight: last statement is 'rollback' ({last!r})")
    ok("commit" not in strip_comments(pre_text).lower(), "preflight: no commit anywhere")
    rb_code = strip_comments(rb_text).lower()
    ok("cascade" not in rb_code, "rollback: no CASCADE anywhere in the code")
    ok("auth." not in rb_code, "rollback: never names the auth schema in code")
    ok(re.findall(r"^\s*(begin|commit|rollback)\s*;", rb_code, re.M) == ["begin", "commit"], "rollback: exactly one begin and one commit (single transaction)")
    drops = re.findall(r"^\s*drop\s.*$", rb_code, re.M)
    ok(drops and all("public.dewfpga_" in d for d in drops), f"rollback: all {len(drops)} drop statements target public.dewfpga_ objects")
    ok("pg_dump" in rb_text and "DATA LOSS" in rb_text, "rollback: header warns about data loss and shows the pg_dump backup command")
    # mail/sql is loaded blindly by several tests (sorted(glob('mail/sql/*.sql'))) and may be by an operator's
    # `for f in mail/sql/*.sql`: the operator scripts must not be in it, only the numbered migrations
    in_sql = sorted(os.listdir(SQL_DIR))
    ok(in_sql == MIGRATIONS and all(re.fullmatch(r"\d{3}_[a-z_]+\.sql", n) for n in in_sql), f"mail/sql holds only the numbered migrations: {in_sql}")
    ok("preflight_readonly.sql" not in in_sql and "rollback_dewfpga.sql" not in in_sql and os.path.isfile(PREFLIGHT) and os.path.isfile(ROLLBACK),
       "the operator scripts are in mail/ops, not in mail/sql")

    with Cluster() as c:
        CLUSTER = c

        # ---------------------------------------------------------------- empty project
        s0 = snapshot(c)
        r = preflight(c)
        ok(r.returncode == 0, "empty project: preflight exits 0")
        ok(counts(r.stdout) == EMPTY, f"empty project: every dewfpga_ count is 0: {counts(r.stdout)}")
        pp = parts(r.stdout)
        ok(len(pp) == 37 and not any(pp.values()), f"empty project: all {len(pp)} parts of 001/002/003 reported absent")
        ok(unexpected(r.stdout) == [], "empty project: no unexpected dewfpga_ object")
        ok(section(r.stdout, "4b.") == [] and section(r.stdout, "4c.") == [] and section(r.stdout, "7.") == [], "empty project: 4b, 4c and 7 are empty")
        all_headers = headers(r.stdout)
        ok(len(all_headers) == 17 and all_headers[-1].startswith("== end of preflight"), f"empty project: 17 section headers printed, the last one the end marker ({len(all_headers)})")
        ok(snapshot(c) == s0, "empty project: catalog and row counts identical after preflight")
        # the exact documented command, with a connection URL and aligned output
        url = f"postgresql:///postgres?host={c.sock}&user=postgres"
        doc = subprocess.run([c.psql, url, "-X", "-v", "ON_ERROR_STOP=1", "-f", PREFLIGHT], text=True, capture_output=True)
        ok(doc.returncode == 0 and doc.stdout.rstrip().endswith("ROLLBACK") and "== 1. server, database, role ==" in doc.stdout
           and "PostgreSQL" in doc.stdout, "documented command (psql URL -X -v ON_ERROR_STOP=1 -f) exits 0 and ends with ROLLBACK")
        ok(doc.stderr.strip() == "", f"documented command: nothing on stderr ({doc.stderr.strip()[:200]!r})")
        r = run_file(c, ROLLBACK)
        ok(r.returncode == 0 and "no dewfpga_ object remains" in r.stderr, "empty project: rollback is a no-op that exits 0")
        ok(snapshot(c) == s0, "empty project: rollback changed nothing")

        # ---------------------------------------------------------------- 001 alone
        load(c, MIGRATIONS[:1])
        r = preflight(c)
        pp = parts(r.stdout)
        ok(r.returncode == 0 and all(v for (m, _), v in pp.items() if m == "001"), "001 alone: every 001 part present")
        ok(not any(v for (m, _), v in pp.items() if m in ("002", "003")), "001 alone: no 002/003 part present (incl. subscribers.user_id)")
        ok(counts(r.stdout)["dewfpga_tables"] == 1 and counts(r.stdout)["dewfpga_functions"] == 7, f"001 alone: 1 table, 7 functions: {counts(r.stdout)}")
        ok(pp[("003", "dewfpga_confirm(uuid) is the 003 (linking) version")] is False, "001 alone: dewfpga_confirm is reported as the 001 version")

        # ---------------------------------------------------------------- 001-003
        load(c, MIGRATIONS[1:])

        # 8a probes the object each row names: break one object, exactly the expected rows flip, restore.
        # (restore 'reload' = 001-003 again; 'reload_user_id' drops the link column first so 003's
        # "add column if not exists ... references" re-creates the FK too)
        def rename(t, new):
            return f"alter table public.{t} rename to {new}", f"alter table public.{new} rename to {t}"
        fn_rows = {("001", "dewfpga_subscribe(text,text,text)"): "dewfpga_subscribe(text,text,text)",
                   ("001", "dewfpga_unsubscribe(uuid)"): "dewfpga_unsubscribe(uuid)",
                   ("001", "dewfpga_pending_confirmations(integer)"): "dewfpga_pending_confirmations(integer)",
                   ("001", "dewfpga_mark_confirm_sent(uuid,bigint,uuid)"): "dewfpga_mark_confirm_sent(uuid,bigint,uuid)",
                   ("001", "dewfpga_recipients()"): "dewfpga_recipients()", ("001", "dewfpga_newsletter_prune()"): "dewfpga_newsletter_prune()",
                   ("002", "dewfpga_mail_limits()"): "dewfpga_mail_limits()", ("002", "dewfpga_mail_budget(text)"): "dewfpga_mail_budget(text)",
                   ("002", "dewfpga_mail_reserve(7 x text)"): "dewfpga_mail_reserve(text,text,text,text,text,text,text)",
                   ("002", "dewfpga_mail_lookup(text)"): "dewfpga_mail_lookup(text)",
                   ("002", "dewfpga_mail_settle(bigint,uuid,text,text)"): "dewfpga_mail_settle(bigint,uuid,text,text)",
                   ("002", "dewfpga_mail_resolve(bigint,text,text,text)"): "dewfpga_mail_resolve(bigint,text,text,text)",
                   ("002", "dewfpga_mail_approve(text,text,text)"): "dewfpga_mail_approve(text,text,text)",
                   ("002", "dewfpga_mail_campaign_gate(text)"): "dewfpga_mail_campaign_gate(text)",
                   ("003", "dewfpga_enrol_me()"): "dewfpga_enrol_me()", ("003", "dewfpga_link_subscription(uuid)"): "dewfpga_link_subscription(uuid)",
                   ("003", "dewfpga_export_me()"): "dewfpga_export_me()", ("003", "dewfpga_delete_me()"): "dewfpga_delete_me()"}
        probes = [(row, f"drop function public.{sig}", [row[1]], "reload") for row, sig in fn_rows.items()]
        probes += [
            (("001", "dewfpga_confirm(uuid)"), "drop function public.dewfpga_confirm(uuid)",
             ["dewfpga_confirm(uuid)", "dewfpga_confirm(uuid) is the 003 (linking) version"], "reload"),
            (("003", "dewfpga_confirm(uuid) is the 003 (linking) version"), lambda: load(c, MIGRATIONS[:1]),
             ["dewfpga_confirm(uuid) is the 003 (linking) version"], "reload"),
            (("001", "table dewfpga_subscribers"), rename("dewfpga_subscribers", "zz_subs")[0],
             ["table dewfpga_subscribers", "dewfpga_subscribers: row level security on", "dewfpga_subscribers.user_id",
              "fk dewfpga_subscribers.user_id -> dewfpga_profiles"], rename("dewfpga_subscribers", "zz_subs")[1]),
            (("001", "dewfpga_subscribers: row level security on"), "alter table public.dewfpga_subscribers disable row level security",
             ["dewfpga_subscribers: row level security on"], "alter table public.dewfpga_subscribers enable row level security"),
            (("002", "table dewfpga_mail_consumers"), rename("dewfpga_mail_consumers", "zz_cons")[0],
             ["table dewfpga_mail_consumers", "dewfpga_mail_consumers.monthly_cap", "dewfpga_mail_consumers row 'dewfpga' seeded"],
             rename("dewfpga_mail_consumers", "zz_cons")[1]),
            (("002", "dewfpga_mail_consumers.monthly_cap"), "alter table public.dewfpga_mail_consumers drop column monthly_cap",
             ["dewfpga_mail_consumers.monthly_cap"], "reload"),
            (("002", "dewfpga_mail_consumers row 'dewfpga' seeded"), "delete from public.dewfpga_mail_consumers where name = 'dewfpga'",
             ["dewfpga_mail_consumers row 'dewfpga' seeded"], "reload"),
            (("002", "table dewfpga_mail_ledger"), rename("dewfpga_mail_ledger", "zz_ledger")[0],
             ["table dewfpga_mail_ledger", "dewfpga_mail_ledger.logical_key not null", "dewfpga_mail_ledger.uncertain", "dewfpga_mail_ledger.claim_token"],
             rename("dewfpga_mail_ledger", "zz_ledger")[1]),
            (("002", "dewfpga_mail_ledger.logical_key not null"), "alter table public.dewfpga_mail_ledger alter column logical_key drop not null",
             ["dewfpga_mail_ledger.logical_key not null"], "reload"),
            (("002", "dewfpga_mail_ledger.uncertain"), "alter table public.dewfpga_mail_ledger drop column uncertain", ["dewfpga_mail_ledger.uncertain"], "reload"),
            (("002", "dewfpga_mail_ledger.claim_token"), "alter table public.dewfpga_mail_ledger drop column claim_token", ["dewfpga_mail_ledger.claim_token"], "reload"),
            (("002", "index dewfpga_mail_ledger_logical_key"), "drop index public.dewfpga_mail_ledger_logical_key", ["index dewfpga_mail_ledger_logical_key"], "reload"),
            (("002", "table dewfpga_mail_approvals"), rename("dewfpga_mail_approvals", "zz_appr")[0],
             ["table dewfpga_mail_approvals", "dewfpga_mail_approvals.unsubscribe_method"], rename("dewfpga_mail_approvals", "zz_appr")[1]),
            (("002", "dewfpga_mail_approvals.unsubscribe_method"), "alter table public.dewfpga_mail_approvals drop column unsubscribe_method",
             ["dewfpga_mail_approvals.unsubscribe_method"], "reload"),
            (("003", "table dewfpga_profiles"), rename("dewfpga_profiles", "zz_prof")[0],
             ["table dewfpga_profiles", "fk dewfpga_subscribers.user_id -> dewfpga_profiles"], rename("dewfpga_profiles", "zz_prof")[1]),
            (("003", "policy dewfpga_profiles_self_select"), "drop policy dewfpga_profiles_self_select on public.dewfpga_profiles",
             ["policy dewfpga_profiles_self_select"], "reload"),
            (("003", "dewfpga_subscribers.user_id"), "alter table public.dewfpga_subscribers drop column user_id",
             ["dewfpga_subscribers.user_id", "fk dewfpga_subscribers.user_id -> dewfpga_profiles", "index dewfpga_subscribers_user_id"], "reload"),
            (("003", "fk dewfpga_subscribers.user_id -> dewfpga_profiles"), "alter table public.dewfpga_subscribers drop constraint dewfpga_subscribers_user_id_fkey",
             ["fk dewfpga_subscribers.user_id -> dewfpga_profiles"], "reload_user_id"),
            (("003", "index dewfpga_subscribers_user_id"), "drop index public.dewfpga_subscribers_user_id", ["index dewfpga_subscribers_user_id"], "reload"),
        ]
        base = parts(preflight(c).stdout)
        ok(len(probes) == len(base) == 37 and set(p[0] for p in probes) == set(base), f"8a: one probe per row ({len(probes)} probes, {len(base)} rows)")
        for row, brk, flips, restore in probes:
            brk() if callable(brk) else c.sql(brk)
            pp = parts(preflight(c).stdout)
            flipped = sorted(p for (_, p), v in pp.items() if v is not True)
            ok(flipped == sorted(flips), f"8a row {row[1]!r}: breaking it flips exactly {sorted(flips)} (got {flipped})")
            if restore == "reload_user_id":
                c.sql("alter table public.dewfpga_subscribers drop column user_id")
            if restore in ("reload", "reload_user_id"):
                load(c, MIGRATIONS)
            else:
                c.sql(restore)
        ok(all(v is True for v in parts(preflight(c).stdout).values()), "8a: every row present again after the probes")

        # 4b lists the FKs into dewfpga_ tables: the three internal ones now, a foreign one later
        r = preflight(c)
        ok(sorted(section(r.stdout, "4b.")) == ["dewfpga_mail_approvals\tdewfpga_mail_approvals_owner_test_ledger_id_fkey\tdewfpga_mail_ledger",
                                                  "dewfpga_mail_ledger\tdewfpga_mail_ledger_consumer_fkey\tdewfpga_mail_consumers",
                                                  "dewfpga_subscribers\tdewfpga_subscribers_user_id_fkey\tdewfpga_profiles"],
           f"4b: the three FKs of 001-003 into dewfpga_ tables, nothing else: {section(r.stdout, '4b.')}")
        ok(section(r.stdout, "4c.") == [], "4c: no foreign function names a dewfpga_ object yet")
        # 6 reflects a default privilege the moment it exists, and its revocation
        c.sql("alter default privileges in schema public grant select on tables to anon")
        d6 = section(preflight(c).stdout, "6.")
        ok(any(l.startswith("postgres\tpublic\ttable\t") and "anon=r/postgres" in l for l in d6), f"6: shows the default privilege just granted (postgres, public, table, anon=r): {d6}")
        c.sql("alter default privileges in schema public revoke select on tables from anon")
        d6 = section(preflight(c).stdout, "6.")
        ok(not any("anon=r" in l for l in d6), f"6: no anon default privilege after the revoke: {d6}")

        c.sql("update public.dewfpga_mail_consumers set enrolled_at = now(), daily_cap = 10, monthly_cap = 100 where name = 'dewfpga'")
        s1 = snapshot(c)
        r = preflight(c)
        ok(r.returncode == 0, "001-003: preflight exits 0")
        ok(counts(r.stdout) == FULL, f"001-003: counts are {FULL}: got {counts(r.stdout)}")
        pp = parts(r.stdout)
        ok(len(pp) == 37 and all(pp.values()), f"001-003: all {len(pp)} parts present")
        ok(unexpected(r.stdout) == [], f"001-003: no dewfpga_ object outside the known set: {unexpected(r.stdout)}")
        ok(re.search(r"^dewfpga_mail_consumers\t1\t$", r.stdout, re.M) is not None, "001-003: row counts section shows the seeded consumer row (owner: no RLS note)")
        ok(re.search(r"^dewfpga_subscribe\(p_email text, p_consent_text_version text, p_source text\)\tt\t\{.*search_path.*\}\tt\tt$", r.stdout, re.M) is not None,
           "001-003: functions section shows security definer, pinned search_path and anon/authenticated execute")
        ok(re.search(r"^dewfpga_mail_ledger\tt\t0\tf\tf\tt\tpostgres$", r.stdout, re.M) is not None,
           "001-003: tables section shows RLS on, 0 policies, no anon/authenticated privilege, service_role privilege")
        ok(snapshot(c) == s1, "001-003: catalog, acls, sequences and row counts identical after preflight")
        # 3e shows the sequence grants too: 002 revokes the ledger sequence from anon/authenticated (Supabase grants
        # every new public sequence to them by default); the report must show a grant when one is there
        ok(section(r.stdout, "3e.") == ["dewfpga_mail_ledger_id_seq\tf\tf\tpostgres"],
           f"001-003: sequences section shows no anon/authenticated privilege: {section(r.stdout, '3e.')}")
        c.sql("grant usage, select on sequence public.dewfpga_mail_ledger_id_seq to anon")
        ok(section(preflight(c).stdout, "3e.") == ["dewfpga_mail_ledger_id_seq\tt\tf\tpostgres"],
           "sequences section shows a grant to anon when there is one")
        c.sql("revoke all on sequence public.dewfpga_mail_ledger_id_seq from anon")
        # a database loaded the way test_sender_idem.py and test_pages.py do it still has its tables afterwards
        with Cluster() as g:
            for f in sorted(glob.glob(os.path.join(SQL_DIR, "*.sql"))):
                g.sql(open(f, encoding="utf-8").read())
            ok(g.value("select count(*) from pg_tables where schemaname = 'public' and tablename like 'dewfpga%'") == "5",
               "sorted(glob('mail/sql/*.sql')) loads 001-003 and leaves all 5 dewfpga_ tables in place (no rollback ran)")

        # ---------------------------------------------------------------- read-only really protects
        with tempfile.TemporaryDirectory(prefix="dewfpga-preflight-") as td:
            injections = [
                "insert into public.dewfpga_mail_consumers (name) values ('evil');",
                "update public.dewfpga_mail_consumers set daily_cap = 9999;",
                "delete from public.dewfpga_mail_consumers;",
                "create table public.dewfpga_evil (x int);",
                "drop table public.dewfpga_mail_approvals;",
                "alter table public.dewfpga_profiles disable row level security;",
                "grant select on public.dewfpga_subscribers to anon;",
                "select nextval('public.dewfpga_mail_ledger_id_seq');",
            ]
            for i, inj in enumerate(injections):
                copy = pre_text.replace("begin transaction read only;\n", "begin transaction read only;\n" + inj + "\n", 1)
                if i % 2:  # half of them also try to commit instead of rolling back
                    copy = copy[: copy.rfind("rollback;")] + "commit;\n"
                path = os.path.join(td, f"inj{i}.sql")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(copy)
                r = run_file(c, path)
                ok(r.returncode != 0 and "read-only transaction" in r.stderr, f"injected write is refused by the read-only transaction: {inj}")
            ok(snapshot(c) == s1, "after every injected copy (half ending in commit): nothing changed")
            ok(c.value("select count(*) from pg_class where relname = 'dewfpga_evil'") == "0", "no injected table exists")
            ok(c.value("select count(*) from public.dewfpga_mail_consumers where name = 'evil'") == "0", "no injected row exists")

        # ---------------------------------------------------------------- another application beside dewfpga
        u1, u2 = uuid.uuid4(), uuid.uuid4()
        c.sql(f"""
          create table public.other_app_notes (id bigint generated always as identity primary key,
                                               user_id uuid not null references auth.users (id) on delete cascade, body text not null);
          alter table public.other_app_notes enable row level security;
          grant select on public.other_app_notes to authenticated;
          create function public.other_app_on_signup() returns trigger language plpgsql as $$ begin return new; end $$;
          create trigger other_app_on_signup after insert on auth.users for each row execute function public.other_app_on_signup();
          insert into auth.users (id, email) values ('{u1}', 'student@example.org'), ('{u2}', 'other@example.org');
          insert into public.other_app_notes (user_id, body) values ('{u1}', 'thesis draft v3'), ('{u1}', 'lab notes'), ('{u2}', 'todo');
          analyze public.other_app_notes;
        """)
        cl1 = f'{{"sub":"{u1}","email":"student@example.org","role":"authenticated"}}'
        ok(subscribe_confirm_flow(c, "student@example.org") is None, "fixture: subscribe -> confirm works before rollback")
        c.sql("select public.dewfpga_subscribe('pending@example.org', '2026-10-03')", role="anon")
        c.value("select public.dewfpga_enrol_me()", role="authenticated", claims=cl1)
        ut = c.value("select unsubscribe_token from public.dewfpga_subscribers where email = 'student@example.org'")
        ok(c.value(f"select public.dewfpga_link_subscription('{ut}')", role="authenticated", claims=cl1) == "t", "fixture: a subscription is linked to the account")
        c.sql(f"select * from public.dewfpga_mail_reserve('dewfpga', 'confirm', 'k1', '{H}', '{P}')", role="service_role")
        ok(c.value("select (select count(*) from public.dewfpga_subscribers) || '/' || (select count(*) from public.dewfpga_profiles) || '/' || (select count(*) from public.dewfpga_mail_ledger)") == "2/1/1",
           "fixture: dewfpga holds 2 subscribers, 1 profile, 1 ledger row")
        r = preflight(c)
        ok(re.search(r"^other_app_notes\tt\tt\t3\tpostgres$", r.stdout, re.M) is not None, "preflight lists the other app's table with its FK to auth.users and the 3-row estimate")
        ok(re.search(r"^other_app_on_signup\tO\tCREATE TRIGGER other_app_on_signup", r.stdout, re.M) is not None, "preflight lists the other app's trigger on auth.users")
        ok(re.search(r"^dewfpga_subscribers\t2\t$", r.stdout, re.M) is not None and re.search(r"^dewfpga_profiles\t1\t$", r.stdout, re.M) is not None,
           "preflight shows dewfpga row counts 2 subscribers / 1 profile")
        ok(unexpected(r.stdout) == [] and counts(r.stdout) == FULL, "preflight with data: counts unchanged, nothing unexpected")
        full_headers = headers(r.stdout)

        # ---------------------------------------------------------------- a non-superuser role that cannot read every table
        c.sql("""
          create role supa_admin login nosuperuser;
          create role other_owner nologin;
          grant usage, create on schema public to other_owner;
          set role other_owner;
          create table public.other_private (x int);
          insert into public.other_private values (1), (2);
          reset role;
          analyze public.other_private;
        """)
        ok(c.fails("select * from public.other_private", "permission denied", role="supa_admin")
           and c.fails("select * from public.dewfpga_subscribers", "permission denied", role="supa_admin"),
           "fixture: supa_admin can read neither the other owner's table nor the dewfpga_ tables")
        r = preflight_as(c, "supa_admin")
        ok(r.returncode == 0 and r.stderr.strip() == "", f"non-superuser without SELECT: preflight exits 0, no stderr ({r.stderr.strip()[:200]!r})")
        ok(headers(r.stdout) == full_headers and r.stdout.rstrip().endswith("(nothing was written) =="), "non-superuser: every section printed, to the end")
        ok(re.search(r"^postgres\tsupa_admin\tsupa_admin\tf\tf\tf\t", r.stdout, re.M) is not None, "non-superuser: section 1 shows the role, not superuser")
        ok(re.search(r"^other_private\tf\tf\t2\tother_owner$", r.stdout, re.M) is not None, "non-superuser: the unreadable table is listed with its estimate and owner")
        ok(sorted(section(r.stdout, "7.")) == sorted(f"{t}\tno select privilege\t" for t in
           ["dewfpga_subscribers", "dewfpga_mail_consumers", "dewfpga_mail_ledger", "dewfpga_mail_approvals", "dewfpga_profiles"]),
           f"non-superuser: section 7 says 'no select privilege' for every dewfpga_ table: {section(r.stdout, '7.')}")
        pp = parts(r.stdout)
        ok(pp[("002", "dewfpga_mail_consumers row 'dewfpga' seeded")] is None and sum(v is True for v in pp.values()) == 36,
           "non-superuser: 8a leaves the seeded-row cell empty, the other 36 catalog-based parts are t")
        ok(counts(r.stdout) == FULL and unexpected(r.stdout) == [], "non-superuser: catalog counts complete")
        c.sql("grant select on all tables in schema public to supa_admin")
        r = preflight_as(c, "supa_admin")
        ok(r.returncode == 0 and re.search(r"^dewfpga_subscribers\t0\trls applies to this role: count may be 0$", r.stdout, re.M) is not None
           and parts(r.stdout)[("002", "dewfpga_mail_consumers row 'dewfpga' seeded")] is None,
           "non-superuser with SELECT but not owner: RLS hides the rows, section 7 says so, the seeded cell stays empty")
        c.sql("alter table public.dewfpga_mail_consumers owner to supa_admin")
        r = preflight_as(c, "supa_admin")
        ok(re.search(r"^dewfpga_mail_consumers\t1\t$", r.stdout, re.M) is not None and parts(r.stdout)[("002", "dewfpga_mail_consumers row 'dewfpga' seeded")] is True,
           "non-superuser owning the table: exact count and the seeded row come back")
        c.sql("alter table public.dewfpga_mail_consumers owner to postgres")

        users_before = c.rows("select id, email, created_at from auth.users order by id")
        notes_before = c.rows("select id, user_id, body from public.other_app_notes order by id")
        other_before = non_dewfpga(snapshot(c))
        ok(len(users_before) == 2 and len(notes_before) == 3, "fixture: 2 auth.users, 3 notes recorded before rollback")

        # ---------------------------------------------------------------- rollback
        r = run_file(c, ROLLBACK)
        ok(r.returncode == 0, "rollback exits 0 with the other app present")
        ok("no dewfpga_ object remains" in r.stderr and "WARNING" not in r.stderr, "rollback reports that no dewfpga_ object remains")
        r = preflight(c)
        ok(r.returncode == 0 and counts(r.stdout) == EMPTY, f"after rollback: every dewfpga_ count is 0: {counts(r.stdout)}")
        ok(not any(parts(r.stdout).values()), "after rollback: every part of 001/002/003 reported absent")
        ok(c.rows("select id, email, created_at from auth.users order by id") == users_before, "after rollback: auth.users rows identical")
        ok(c.rows("select id, user_id, body from public.other_app_notes order by id") == notes_before, "after rollback: other_app_notes rows identical")
        ok(non_dewfpga(snapshot(c)) == other_before, "after rollback: every non-dewfpga catalog entry, acl, trigger, sequence and row count identical")
        ok(c.value("select count(*) from pg_extension where extname = 'pgcrypto'") == "1", "after rollback: pgcrypto still installed")
        ok(c.value("select count(*) from pg_trigger where tgname = 'other_app_on_signup'") == "1", "after rollback: the other app's trigger on auth.users survives")
        ok(c.value("select count(*) from pg_class where relname like 'dewfpga%'") == "0" and c.value("select count(*) from pg_proc where proname like 'dewfpga%'") == "0",
           "after rollback: no relation or function named dewfpga* anywhere")

        # ---------------------------------------------------------------- 001-003 again, then the basic flow
        twice = "".join(open(os.path.join(SQL_DIR, n), encoding="utf-8").read() + "\n" for n in MIGRATIONS * 2)
        ok(c.run(twice).returncode == 0, "after rollback: 001-003 load twice without error")
        r = preflight(c)
        ok(counts(r.stdout) == FULL and all(parts(r.stdout).values()) and unexpected(r.stdout) == [], "after re-apply: preflight shows the full set again")
        res = subscribe_confirm_flow(c, "again@example.org")
        ok(res is None, f"after re-apply: subscribe -> confirm -> recipient works ({res})")
        ok(c.rows("select id, email, created_at from auth.users order by id") == users_before, "after re-apply: auth.users still identical")

        # ---------------------------------------------------------------- a foreign function that calls a dewfpga_ RPC (untracked by PostgreSQL)
        c.sql("""
          create function public.other_calls_dew() returns bigint language plpgsql as $$
            begin return (select count(*) from public.dewfpga_recipients()); end $$;
          create table public.other_t (id bigint generated always as identity primary key, email text not null);
          create function public.other_t_subscribe() returns trigger language plpgsql as $$
            begin perform public.dewfpga_subscribe(new.email, 'v1'); return new; end $$;
          create trigger other_t_subscribe after insert on public.other_t for each row execute function public.other_t_subscribe();
          insert into public.other_t (email) values ('viatrigger@example.org');
        """)
        ok(c.value("select public.other_calls_dew()") == "1" and c.value("select count(*) from public.dewfpga_subscribers where email = 'viatrigger@example.org'") == "1",
           "fixture: the foreign function and trigger function call dewfpga_ RPCs and work")
        r = preflight(c)
        ok(section(r.stdout, "4c.") == ["public\tother_calls_dew()\tplpgsql\tf", "public\tother_t_subscribe()\tplpgsql\tt"],
           f"4c lists both foreign functions, the trigger one flagged: {section(r.stdout, '4c.')}")
        s3 = snapshot(c)
        r = run_file(c, ROLLBACK)
        ok(r.returncode != 0 and "rollback refused" in r.stderr and "inspect, then drop or change it by hand" in r.stderr, "rollback with foreign callers: refused, says inspect then drop by hand")
        ok("public.other_calls_dew()" in r.stderr and "public.other_t_subscribe()" in r.stderr, "the refusal names both foreign functions")
        ok(snapshot(c) == s3, "refused rollback (foreign callers): catalog and rows unchanged, nothing dropped")
        ok(c.value("select public.other_calls_dew()") == "1", "refused rollback: the foreign function still works")
        c.sql("drop trigger other_t_subscribe on public.other_t; drop function public.other_t_subscribe(); drop function public.other_calls_dew(); drop table public.other_t")
        r = run_file(c, ROLLBACK)
        ok(r.returncode == 0 and counts(preflight(c).stdout) == EMPTY, "with the foreign callers removed by their owner: rollback succeeds, dewfpga_ count 0")
        c.load_migrations()
        res = subscribe_confirm_flow(c, "again@example.org")
        ok(res is None, f"re-applied again: subscribe -> confirm works ({res})")

        # ---------------------------------------------------------------- a foreign dependency blocks the rollback entirely
        sid = c.value("select id from public.dewfpga_subscribers where email = 'again@example.org'")
        c.sql(f"""
          create table public.other_app_refs (id bigint generated always as identity primary key,
                                              sub_id uuid not null references public.dewfpga_subscribers (id));
          insert into public.other_app_refs (sub_id) values ('{sid}');
          create view public.other_app_view as select count(*) as n from public.dewfpga_mail_ledger;
        """)
        ok("other_app_refs\tother_app_refs_sub_id_fkey\tdewfpga_subscribers" in section(preflight(c).stdout, "4b."), "4b lists the foreign FK into dewfpga_subscribers")
        s2 = snapshot(c)
        r = run_file(c, ROLLBACK)
        ok(r.returncode != 0 and "rollback refused" in r.stderr, "rollback with a foreign FK and view: refused")
        ok("other_app_refs" in r.stderr and "other_app_view" in r.stderr, "the refusal names both dependents")
        ok(snapshot(c) == s2, "refused rollback: catalog and rows unchanged (nothing dropped)")
        ok(counts(preflight(c).stdout) == FULL, "refused rollback: all dewfpga_ objects still present")
        # the same without the guard: PostgreSQL's own refusal (no CASCADE) still leaves nothing dropped,
        # although the function drops come first in the file: single transaction
        with tempfile.TemporaryDirectory(prefix="dewfpga-rollback-") as td:
            noguard = re.sub(r"-- guard:.*?end \$\$;\n", "", rb_text, count=1, flags=re.S)
            ok(noguard != rb_text and "rollback refused" not in noguard, "test copy: the guard block removed")
            path = os.path.join(td, "noguard.sql")
            with open(path, "w", encoding="utf-8") as f:
                f.write(noguard)
            r = run_file(c, path)
            ok(r.returncode != 0 and "cannot drop table dewfpga_subscribers because other objects depend on it" in r.stderr, "without the guard: PostgreSQL refuses the drop (no CASCADE)")
            ok(snapshot(c) == s2, "without the guard: the earlier function drops were rolled back too, nothing changed")
            ok(c.value("select count(*) from public.other_app_refs") == "1", "without the guard: the referencing row is intact")
        c.sql("drop view public.other_app_view; drop table public.other_app_refs")
        r = run_file(c, ROLLBACK)
        ok(r.returncode == 0 and counts(preflight(c).stdout) == EMPTY, "with the dependents removed by their owner: rollback succeeds, dewfpga_ count 0")
        ok(c.rows("select id, email, created_at from auth.users order by id") == users_before and c.value("select count(*) from public.other_app_notes") == "3",
           "final: auth.users and the other app's notes still identical")
        c.load_migrations()
        ok(subscribe_confirm_flow(c, "final@example.org") is None, "final: 001-003 re-applied, subscribe -> confirm works")

    print(f"\npassed {PASSED}, failed {FAILED}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # a psql failure (RuntimeError) or a report so broken that parsing fails
        FAILED += 1
        print(f"FAIL  {type(e).__name__}: {str(e)[:1500]}")
        print(f"\npassed {PASSED}, failed {FAILED}")
        sys.exit(1)
