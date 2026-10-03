"""A private, throw-away PostgreSQL for the SQL tests.

initdb into a temp dir, start on a unix socket only (no TCP), fsync off, drop everything at exit.
Never touches a user's running database. Needs initdb/pg_ctl/psql on PATH (or Homebrew's
postgresql@15 / @14 bin dirs); a Supabase project is NOT needed: the three Supabase roles and a
stub of the auth schema (auth.users, auth.uid(), auth.email()) are created here so the real
migrations in mail/sql load unchanged."""
import os, shutil, subprocess, sys, tempfile, time

_CANDIDATES = ["/opt/homebrew/opt/postgresql@15/bin", "/opt/homebrew/opt/postgresql@14/bin",
               "/usr/local/opt/postgresql@15/bin", "/usr/lib/postgresql/15/bin", "/usr/lib/postgresql/14/bin"]

SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sql")

# What a Supabase project provides and the migrations rely on. Kept minimal and explicit.
SUPABASE_STUB = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.email() to anon, authenticated, service_role;
"""


def _bin(name):
    p = shutil.which(name)
    if p:
        return p
    for d in _CANDIDATES:
        c = os.path.join(d, name)
        if os.path.exists(c):
            return c
    return None


class Cluster:
    def __init__(self):
        self.initdb, self.pg_ctl, self.psql = _bin("initdb"), _bin("pg_ctl"), _bin("psql")
        if not (self.initdb and self.pg_ctl and self.psql):
            raise RuntimeError("initdb/pg_ctl/psql not found; install PostgreSQL 14+ to run the SQL tests")
        self.dir = tempfile.mkdtemp(prefix="dewfpga-pg-")
        self.data = os.path.join(self.dir, "data")
        self.sock = os.path.join(self.dir, "s")
        os.mkdir(self.sock)
        self.log = os.path.join(self.dir, "pg.log")

    def __enter__(self):
        subprocess.run([self.initdb, "-D", self.data, "--auth=trust", "--no-sync", "-U", "postgres",
                        "-E", "UTF8", "--locale=C"], check=True, capture_output=True)
        subprocess.run([self.pg_ctl, "-D", self.data, "-l", self.log, "-w", "start", "-o",
                        f"-k {self.sock} -c listen_addresses='' -c fsync=off -c full_page_writes=off"],
                       check=True, capture_output=True)
        self.sql(SUPABASE_STUB)
        return self

    def __exit__(self, *exc):
        subprocess.run([self.pg_ctl, "-D", self.data, "-m", "immediate", "-w", "stop"], capture_output=True)
        shutil.rmtree(self.dir, ignore_errors=True)

    def _cmd(self, extra=()):
        return [self.psql, "-h", self.sock, "-U", "postgres", "-d", "postgres", "-X", "-q",
                "-v", "ON_ERROR_STOP=1", *extra]

    def run(self, sql, *, role=None, claims=None, extra=()):
        """Run sql; returns CompletedProcess (no raise). role/claims wrap the sql in a transaction as
        that role, the way PostgREST runs a request: set local role + request.jwt.claims."""
        if role:
            sql = (f"begin; set local role {role}; "
                   + (f"set local request.jwt.claims = '{claims}'; " if claims else "")
                   + sql + "; commit;")
        self.last = subprocess.run(self._cmd(extra), input=sql, text=True, capture_output=True)
        return self.last

    def sql(self, sql, **kw):
        """Run sql, raise on error, return stdout."""
        r = self.run(sql, **kw)
        if r.returncode != 0:
            raise RuntimeError(f"psql failed:\n{r.stderr}\n--- sql ---\n{sql}")
        return r.stdout

    def value(self, sql, **kw):
        """A single value, unaligned, tuples only."""
        kw.setdefault("extra", ("-At",))
        return self.sql(sql, **kw).strip()

    def rows(self, sql, **kw):
        kw.setdefault("extra", ("-At", "-F", "\t"))
        out = self.sql(sql, **kw).strip("\n")
        return [line.split("\t") for line in out.splitlines()] if out else []

    def fails(self, sql, needle=None, **kw):
        """True when sql fails (and, if given, the error mentions needle)."""
        r = self.run(sql, **kw)
        if r.returncode == 0:
            return False
        return needle is None or needle in r.stderr

    def load_migrations(self):
        for name in sorted(os.listdir(SQL_DIR)):
            if name.endswith(".sql"):
                with open(os.path.join(SQL_DIR, name), encoding="utf-8") as f:
                    self.sql(f.read())
