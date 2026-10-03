#!/usr/bin/env python3
"""PostgREST-shaped loopback HTTP shim over a private throwaway PostgreSQL cluster.

Used by mail/tests/test_browser.mjs so the browser pages are exercised against the real SQL
(mail/sql/*.sql) instead of a mock. Only `POST /rest/v1/rpc/<fn>` is implemented, because the
pages call nothing else on PostgREST. The caller's identity comes from two headers set by the
test's fake GoTrue layer: X-Role (anon|authenticated) and X-Claims (JSON jwt claims). Errors
raised with `insufficient_privilege` map to 401 for anon and 403 otherwise, like PostgREST.

Listens on 127.0.0.1 only, prints `PORT <n>` once ready, exits when stdin closes. Reuses
pg_harness.Cluster (initdb into a temp dir, unix socket, dropped on exit) and never touches a
user's database. Extra admin endpoints for the test: POST /_test/user {email} creates an
auth.users row and returns its id; POST /_test/sql {sql} runs sql as postgres (role-less).
"""
import json, os, signal, sys, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg_harness  # noqa: E402

cluster = None
lock = threading.Lock()


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def call(fn, args, role, claims):
    """Run `select public.<fn>(...)` as role with claims; -> (status, body)."""
    if not fn.startswith("dewfpga_") or not fn.replace("_", "").isalnum():
        return 404, {"message": "unknown function"}
    params = ", ".join(f"{k} => {q(json.dumps(v) if isinstance(v, (dict, list)) else v)}" for k, v in (args or {}).items())
    sql = f"select coalesce(to_json(public.{fn}({params}))::text, 'null')"
    with lock:
        r = cluster.run(sql, role=role, claims=claims.replace("'", "''") if claims else None, extra=("-At",))
    if r.returncode != 0:
        err = r.stderr.strip()
        if "insufficient_privilege" in err or "permission denied" in err or "42501" in err:
            return (401 if role == "anon" else 403), {"code": "42501", "message": err.splitlines()[0][:200]}
        if "does not exist" in err:
            return 404, {"message": err.splitlines()[0][:200]}
        return 400, {"message": err.splitlines()[0][:200]}
    out = r.stdout.strip().splitlines()
    out = out[-1] if out else "null"
    try:
        return 200, json.loads(out)
    except ValueError:
        return 200, out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            return self.send(400, {"message": "bad json"})
        if self.path.startswith("/rest/v1/rpc/"):
            fn = self.path[len("/rest/v1/rpc/"):].split("?")[0]
            role = self.headers.get("X-Role") or "anon"
            claims = self.headers.get("X-Claims") or ""
            if role == "anon":
                claims = ""
            status, out = call(fn, body, role, claims)
            return self.send(status, out)
        if self.path == "/_test/user":
            uid = str(uuid.uuid4())
            with lock:
                cluster.sql(f"insert into auth.users(id, email) values ({q(uid)}, {q(body['email'])})")
            return self.send(200, {"id": uid})
        if self.path == "/_test/sql":
            with lock:
                r = cluster.run(body.get("sql", ""), extra=("-At",))
            return self.send(200 if r.returncode == 0 else 400, {"out": r.stdout, "err": r.stderr[-400:]})
        self.send(404, {"message": "not found"})


def main():
    global cluster
    # Normal shutdown is stdin EOF. A parent timeout must still unwind the
    # cluster context instead of abandoning PostgreSQL.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    with pg_harness.Cluster() as c:
        cluster = c
        c.load_migrations()
        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        print(f"PORT {srv.server_address[1]}", flush=True)
        try:
            for _ in sys.stdin:  # parent closes stdin when done
                pass
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    main()
