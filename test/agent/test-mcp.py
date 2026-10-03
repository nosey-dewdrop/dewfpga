#!/usr/bin/env python3
"""Tests for templates/mcp_server.py and templates/mcp_setup.py.

Default suite: standard library only, offline, in a private temp dir; the CLI is a fake executable that prints controlled
JSON, the "python" that builds the venv is a fake too. Nothing touches HOME, the editor or the toolchain.
Real stdio client tests (server/discover in modern and auto mode, six tools, structured failure, EOF) run only when
DEWFPGA_MCP_TEST_PYTHON names a python that already has mcp==2.3.0 installed; they are skipped otherwise.

    python3 test/agent/test-mcp.py
    DEWFPGA_MCP_TEST_PYTHON=/path/to/venv/bin/python python3 test/agent/test-mcp.py
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
SERVER = os.path.join(ROOT, "templates", "mcp_server.py")
SETUP = os.path.join(ROOT, "templates", "mcp_setup.py")
CATALOG = os.path.join(ROOT, "docs", "errors.md")


def find_sdk():
    """DEWFPGA_MCP_TEST_PYTHON, else the owned venv that `dewfpga install` built in $FPGA_HOME (read only, never built here)."""
    py = os.environ.get("DEWFPGA_MCP_TEST_PYTHON")
    if not py:
        venv = os.path.join(os.environ.get("FPGA_HOME") or os.path.expanduser("~/fpga"), "mcp-venv")
        if os.path.isfile(os.path.join(venv, ".dewfpga-owned")):
            py = os.path.join(venv, "bin", "python")
    return py if py and os.access(py, os.X_OK) else None


SDK_PY = find_sdk()
HAVE_SDK = SDK_PY is not None
if os.environ.get("DEWFPGA_MCP_REQUIRE_SDK") == "1" and not HAVE_SDK:
    sys.exit("DEWFPGA_MCP_REQUIRE_SDK=1 but no python with mcp==2.3.0 (set DEWFPGA_MCP_TEST_PYTHON or run dewfpga install)")
REAL_CLI = os.environ.get("DEWFPGA_MCP_TEST_CLI") or os.path.join(ROOT, "bin", "dewfpga")
ENV = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C", "LANG": "C", "LC_CTYPE": "C",
       "PYTHONDONTWRITEBYTECODE": "1", "HOME": tempfile.mkdtemp(prefix="mcp-home-")}

FAKE_CLI = r'''#!/bin/sh
# fake dewfpga: records argv + cwd, prints what the test asked for
printf '%s\n' "$PWD" > "$FAKE_LOG.cwd"
: > "$FAKE_LOG"
for a in "$@"; do printf '%s\n' "$a" >> "$FAKE_LOG"; done
case "$1" in
  new) [ -e "$2" ] && { echo "ERROR [folder-exists]: $2 already exists. Fix: pick another name. https://x.test/folder-exists/" >&2; exit 1; }
       mkdir -p "$2/.vscode" && : > "$2/blink.sv" && : > "$2/blink.xdc" && : > "$2/.vscode/tasks.json"; echo "$2/ ready"; exit 0 ;;
esac
case "$FAKE_MODE" in
  ok)      echo '{"schema":"dewfpga/result@1","command":"'"$1"'","ok":true,"exit_code":0,"code":null,"diagnostics":[],"artifacts":[{"kind":"bit","path":"blink.bit","state":"new"}]}' ;;
  fail)    echo '{"schema":"dewfpga/result@1","command":"'"$1"'","ok":false,"exit_code":1,"code":"undefined-name","diagnostics":[{"file":"top.sv","line":7,"severity":"error","code":"undefined-name","message":"foo is not declared","fix":"declare it","url":"https://x.test/undefined-name/"}],"log":{"tail":["a","b"]}}'; exit 1 ;;
  garbage) echo "not json"; echo "two lines"; echo "stderr noise" >&2; exit 70 ;;
  hang)    sleep 30 ;;
  nest)    python3 -c 'import os; os.setsid(); os.execvp("sleep", ["sleep", "300"])' & echo $! > "$FAKE_LOG.child"; wait ;;
esac
'''

# fake python3 for mcp_setup: -m venv [--clear] <dir> | -m pip install ... | -c <code>. Creates bin/python; --clear
# empties the dir like the real one; pip fails when the ownership marker is gone mid-build; FAKE_PY_SLEEP stalls pip.
FAKE_PY = r'''#!/bin/sh
[ -n "$FAKE_PY_FAIL" ] && [ "$FAKE_PY_FAIL" = "$2" ] && { echo "fake failure at $2"; exit 9; }
case "$2" in
  venv) for d; do :; done
        [ "$3" = "--clear" ] && find "$d" -mindepth 1 -delete
        mkdir -p "$d/bin" && cp "$0" "$d/bin/python" && echo ok ;;
  pip)  [ -f "$(dirname "$(dirname "$0")")/.dewfpga-owned" ] || { echo "marker missing during the build"; exit 8; }
        [ -n "$FAKE_PY_SLEEP" ] && sleep "$FAKE_PY_SLEEP"
        echo "fake pip: $*" ;;
  *)    echo ok ;;
esac
exit 0
'''


def make_exec(path, body):
    with open(path, "w") as f:
        f.write(body)
    os.chmod(path, stat.S_IRWXU)
    return path


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mcp-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.cli = make_exec(os.path.join(self.tmp, "dewfpga"), FAKE_CLI)
        self.log = os.path.join(self.tmp, "argv.log")
        self.project = os.path.join(self.tmp, "proj with space ü")
        os.mkdir(self.project)

    def env(self, mode="ok"):
        e = dict(ENV)
        e.update({"FAKE_LOG": self.log, "FAKE_MODE": mode})
        return e

    def argv(self):
        with open(self.log) as f:
            return f.read().splitlines()


class StdlibTests(Base):
    """Run with any python3; the server module is imported only where the SDK exists, so these go through subprocesses."""

    def test_missing_sdk_exit_3(self):
        empty = os.path.join(self.tmp, "nosdk")
        os.mkdir(empty)
        with open(os.path.join(empty, "mcp.py"), "w") as f:
            f.write("raise ImportError('fake: no mcp here')\n")
        e = self.env()
        e["PYTHONPATH"] = empty
        p = subprocess.run([sys.executable, "-I", SERVER, "--cli", self.cli], env=e, stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 3, p.stderr)
        self.assertEqual(p.stdout, b"")
        self.assertIn(b"ERROR [mcp-not-installed]", p.stderr)
        self.assertIn(b"dewfpga install", p.stderr)

    def test_usage_error(self):
        p = subprocess.run([sys.executable, SERVER, "--bogus"], env=self.env(), stdin=subprocess.DEVNULL,
                           capture_output=True, timeout=60)
        self.assertIn(p.returncode, (2, 3))
        self.assertEqual(p.stdout, b"")

    def test_requirements_pinned(self):
        with open(os.path.join(ROOT, "templates", "mcp-requirements.txt")) as f:
            lines = [l.strip() for l in f if l.strip()]
        self.assertEqual(lines, ["mcp==2.3.0", "mcp-types==2.3.0"])

    # ---- mcp_setup.py: owned venv lifecycle with a fake python
    def setup_run(self, *args, fail=None):
        e = dict(ENV)
        if fail:
            e["FAKE_PY_FAIL"] = fail
        return subprocess.run([sys.executable, SETUP, *args], env=e, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=120)

    def test_setup_install_uninstall_owned(self):
        home = os.path.join(self.tmp, "fpga home")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        p = self.setup_run("install", home, fpy)
        self.assertEqual(p.returncode, 0, p.stderr)
        venv = os.path.join(home, "mcp-venv")
        self.assertTrue(os.path.isfile(os.path.join(venv, ".dewfpga-owned")))
        self.assertTrue(os.access(os.path.join(venv, "bin", "python"), os.X_OK))
        self.assertEqual([d for d in os.listdir(home) if d.startswith("mcp-venv.")], [], "no staging left behind")
        self.assertEqual(self.setup_run("status", home).returncode, 0)
        # second install replaces the owned venv atomically, still exactly one dir
        with open(os.path.join(venv, "stamp"), "w") as f:
            f.write("old")
        p = self.setup_run("install", home, fpy)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(os.path.join(venv, "stamp")))
        self.assertEqual(sorted(os.listdir(home)), ["mcp-venv"])
        # foreign neighbours survive uninstall
        foreign = os.path.join(home, "mcp-venv.old-foreign")
        os.mkdir(foreign)
        os.symlink(self.tmp, os.path.join(home, "mcp-venv.new-link"))
        other = os.path.join(home, "venv")
        os.mkdir(other)
        p = self.setup_run("uninstall", home)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(venv))
        self.assertTrue(os.path.isdir(foreign) and os.path.islink(os.path.join(home, "mcp-venv.new-link")))
        self.assertTrue(os.path.isdir(other))
        self.assertEqual(self.setup_run("status", home).returncode, 1)

    def test_setup_failure_rolls_back_and_keeps_previous(self):
        home = os.path.join(self.tmp, "fh")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        self.assertEqual(self.setup_run("install", home, fpy).returncode, 0)
        venv = os.path.join(home, "mcp-venv")
        with open(os.path.join(venv, "stamp"), "w") as f:
            f.write("keep me")
        p = self.setup_run("install", home, fpy, fail="pip")
        self.assertEqual(p.returncode, 1, p.stderr)
        self.assertIn("pip install", p.stderr)
        self.assertTrue(os.path.isfile(os.path.join(venv, "stamp")), "previous venv untouched")
        self.assertEqual(sorted(os.listdir(home)), ["mcp-venv"], "staging dir removed")
        p = self.setup_run("install", home, fpy, fail="venv")
        self.assertEqual(p.returncode, 1, p.stderr)
        self.assertEqual(sorted(os.listdir(home)), ["mcp-venv"])

    def test_setup_refuses_foreign_destination(self):
        home = os.path.join(self.tmp, "fh2")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        foreign = os.path.join(home, "mcp-venv")
        os.mkdir(foreign)
        with open(os.path.join(foreign, "precious"), "w") as f:
            f.write("x")
        p = self.setup_run("install", home, fpy)
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("not made by dewfpga", p.stderr)
        self.assertTrue(os.path.isfile(os.path.join(foreign, "precious")))
        self.assertEqual(self.setup_run("uninstall", home).returncode, 0)
        self.assertTrue(os.path.isfile(os.path.join(foreign, "precious")), "uninstall keeps foreign dir")
        # a symlink at the destination is foreign too, and its target is not followed
        shutil.rmtree(foreign)
        target = os.path.join(self.tmp, "target")
        os.mkdir(target)
        with open(os.path.join(target, ".dewfpga-owned"), "w") as f:
            f.write("marker in target must not make the link ours\n")
        os.symlink(target, foreign)
        self.assertEqual(self.setup_run("install", home, fpy).returncode, 2)
        self.assertEqual(self.setup_run("uninstall", home).returncode, 0)
        self.assertTrue(os.path.islink(foreign) and os.path.isdir(target))

    def test_setup_marker_stays_during_build_and_bad_timeout_env(self):
        home = os.path.join(self.tmp, "fh3")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        e = dict(ENV, DEWFPGA_MCP_BUILD_TIMEOUT="soon")
        p = subprocess.run([sys.executable, SETUP, "install", home, fpy], env=e, capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("marker missing", p.stderr)

    def test_setup_uninstall_waits_for_running_install(self):
        home = os.path.join(self.tmp, "fh4")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        e = dict(ENV, FAKE_PY_SLEEP="4")
        inst = subprocess.Popen([sys.executable, SETUP, "install", home, fpy], env=e, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: inst.poll() is None and inst.kill())
        deadline = time.time() + 20
        while not [n for n in os.listdir(home) if n.startswith("mcp-venv.new-")] and time.time() < deadline:
            time.sleep(0.05)
        u = self.setup_run("uninstall", home)
        self.assertEqual(u.returncode, 1, u.stderr)
        self.assertIn("install is running", u.stderr)
        self.assertTrue([n for n in os.listdir(home) if n.startswith("mcp-venv.new-")], "staging dir left alone")
        _, ierr = inst.communicate(timeout=30)
        self.assertEqual(inst.returncode, 0, ierr)
        self.assertTrue(os.path.isfile(os.path.join(home, "mcp-venv", ".dewfpga-owned")))
        self.assertEqual(self.setup_run("uninstall", home).returncode, 0)
        self.assertEqual(os.listdir(home), [])

    def test_cli_uninstall_refuses_sdk_lock_before_removing_toolchain(self):
        import fcntl
        home = os.path.join(self.tmp, "cli-home")
        os.mkdir(home)
        chip = os.path.join(home, "chipdb")
        os.mkdir(chip)
        sentinel = os.path.join(chip, "keep")
        with open(sentinel, "w") as f:
            f.write("present during install")
        with open(os.path.join(home, "mcp-venv.lock"), "w") as lockfile:
            fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
            p = subprocess.run([os.path.join(ROOT, "bin", "dewfpga"), "uninstall"],
                               env=dict(ENV, FPGA_HOME=home, DEWFPGA_SKIP_VSCODE="1"),
                               capture_output=True, text=True, timeout=30)
            self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
            self.assertIn("install is running", p.stderr)
            self.assertTrue(os.path.isfile(sentinel), "CLI removed toolchain while SDK install was active")

    def test_setup_failed_swap_and_failed_restore_keeps_backup(self):
        import importlib.util
        from unittest import mock
        spec = importlib.util.spec_from_file_location("mcp_setup_t", SETUP)
        ms = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ms)
        home = os.path.join(self.tmp, "fh5")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        with mock.patch.dict(os.environ, ENV, clear=True):
            self.assertEqual(ms.install(home, fpy), 0)
        with open(os.path.join(home, "mcp-venv", "stamp"), "w") as f:
            f.write("old")
        real, calls = os.rename, []

        def flaky(a, b):
            calls.append((a, b))
            if len(calls) == 1:  # the old venv steps aside
                return real(a, b)
            raise OSError(5, "simulated I/O error")  # the new one cannot take its place, and the old cannot come back
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch("os.rename", flaky):
            self.assertEqual(ms.install(home, fpy), 1)
        backups = [n for n in os.listdir(home) if n.startswith("mcp-venv.old-")]
        self.assertEqual(len(backups), 1, os.listdir(home))
        self.assertTrue(os.path.isfile(os.path.join(home, backups[0], "stamp")), "previous venv kept, not deleted")
        self.assertFalse([n for n in os.listdir(home) if n.startswith("mcp-venv.new-")], "staging removed")

    def test_setup_foreign_neighbours_survive(self):
        home = os.path.join(self.tmp, "fh6")
        os.mkdir(home)
        fpy = make_exec(os.path.join(self.tmp, "python3"), FAKE_PY)
        target = os.path.join(self.tmp, "elsewhere")
        os.mkdir(target)
        open(os.path.join(target, ".dewfpga-owned"), "w").close()
        os.mkdir(os.path.join(home, "mcp-venv.new-theirs"))
        os.symlink(target, os.path.join(home, "mcp-venv.old-link"))
        os.mkdir(os.path.join(home, "mcp-venv-notes"))
        os.mkdir(os.path.join(home, "projects"))
        self.assertEqual(self.setup_run("install", home, fpy).returncode, 0)
        self.assertEqual(self.setup_run("uninstall", home).returncode, 0)
        self.assertEqual(sorted(os.listdir(home)), ["mcp-venv-notes", "mcp-venv.new-theirs", "mcp-venv.old-link", "projects"])
        self.assertTrue(os.path.isfile(os.path.join(target, ".dewfpga-owned")), "symlink target not followed")


def sdk_eval(code, timeout=120, env=None):
    """Runs code with the SDK python and the server module imported as `m`; returns the JSON it prints last."""
    pre = ("import json, sys, importlib.util\nspec = importlib.util.spec_from_file_location('m', %r)\n"
           "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n" % SERVER)
    p = subprocess.run([SDK_PY, "-c", pre + code], env=env or ENV, capture_output=True, text=True, timeout=timeout,
                       stdin=subprocess.DEVNULL)
    if p.returncode != 0:
        raise AssertionError(p.stderr[-4000:])
    return json.loads(p.stdout.strip().splitlines()[-1])


# a CLI that lies in --json: each mode breaks one rule of dewfpga/result@1, or floods stdout, or leaves an orphan
LIE = r"""#!/bin/sh
case "$LIE" in
  str)      echo '{"schema":"dewfpga/result@1","command":"sim","ok":"yes","exit_code":0}'; exit 5 ;;
  rc)       echo '{"schema":"dewfpga/result@1","command":"sim","ok":true,"exit_code":0}'; exit 9 ;;
  noschema) echo '{"command":"sim","ok":true,"exit_code":0}' ;;
  exitbool) echo '{"schema":"dewfpga/result@1","command":"sim","ok":false,"exit_code":true}'; exit 1 ;;
  mismatch) echo '{"schema":"dewfpga/result@1","command":"sim","ok":true,"exit_code":2}'; exit 2 ;;
  command)  echo '{"schema":"dewfpga/result@1","command":"bit","ok":true,"exit_code":0}' ;;
  big)      head -c 209715200 /dev/zero ;;
  orphan)   python3 -c 'import os, sys, time
if os.fork(): sys.exit(0)
os.setsid()
if os.fork(): sys.exit(0)
open(os.environ["ORPHAN_PID"], "w").write(str(os.getpid())); time.sleep(100)'
            echo '{"schema":"dewfpga/result@1","command":"sim","ok":true,"exit_code":0}' ;;
esac
"""


@unittest.skipUnless(HAVE_SDK, "set DEWFPGA_MCP_TEST_PYTHON to a python with mcp==2.3.0")
class ProcessTests(Base):
    """run_json/run_cli inside the server module: false success, output caps, a pipe held by an orphan."""

    def test_false_success_is_tool_error(self):
        lie = make_exec(os.path.join(self.tmp, "lie"), LIE)
        for mode in ("str", "rc", "noschema", "exitbool", "mismatch", "command"):
            v = sdk_eval("import os\nos.environ['LIE'] = %r\n"
                         "try:\n    m.run_json(%r, 'sim', [], %r, 10); print(json.dumps('accepted'))\n"
                         "except m.ToolError as exc:\n    print(json.dumps('ToolError: ' + str(exc)))\n"
                         % (mode, lie, self.project))
            self.assertTrue(v.startswith("ToolError:"), (mode, v))
            self.assertIn("cannot be trusted", v, mode)

    def test_stdout_cap_bounds_memory_and_time(self):
        lie = make_exec(os.path.join(self.tmp, "lie"), LIE)
        r = sdk_eval("import os, resource, time\nos.environ['LIE'] = 'big'\n"
                     "t = time.time(); rc, out, err, info = m.run_cli(%r, [], %r, 60)\n"
                     "kib = 1 << 10 if sys.platform == 'darwin' else 1\n"
                     "print(json.dumps({'len': len(out), 'info': info, 's': time.time() - t,"
                     " 'rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / kib / 1024}))\n"
                     % (lie, self.project))
        self.assertEqual(r["info"].get("stopped"), "cap", r)
        self.assertLessEqual(r["len"], 4 << 20)
        self.assertLess(r["rss_mib"], 150, r)
        self.assertLess(r["s"], 15, r)

    def test_orphan_holding_stdout_does_not_hang(self):
        lie = make_exec(os.path.join(self.tmp, "lie"), LIE)
        pidf = os.path.join(self.tmp, "orphan.pid")
        e = dict(ENV, LIE="orphan", ORPHAN_PID=pidf)

        def reap():
            try:
                with open(pidf) as f:
                    os.kill(int(f.read()), 9)
            except (OSError, ValueError):
                pass
        self.addCleanup(reap)
        r = sdk_eval("import time\nt = time.time(); res = m.run_json(%r, 'sim', [], %r, 5)\n"
                     "print(json.dumps({'ok': res['ok'], 's': time.time() - t}))\n" % (lie, self.project),
                     env=e, timeout=60)
        self.assertTrue(r["ok"])
        self.assertLess(r["s"], 10, r)


@unittest.skipUnless(HAVE_SDK, "set DEWFPGA_MCP_TEST_PYTHON to a python with mcp==2.3.0")
class ClientTests(Base):
    """Real stdio client against the server, with the fake CLI."""

    def client_script(self, mode, actions):
        return r'''
import asyncio, json, sys
from mcp.client.client import Client
from mcp.client.stdio import StdioServerParameters
params = StdioServerParameters(command=sys.argv[1], args=json.loads(sys.argv[2]), env=json.loads(sys.argv[3]))
actions = json.loads(sys.argv[4])
async def main():
    out = {}
    async with Client(params, mode=%r) as c:
        out["protocol_version"] = str(getattr(c, "protocol_version", None))
        tools = (await c.list_tools()).tools
        out["tools"] = {t.name: {"desc": t.description, "ann": t.annotations.model_dump(by_alias=True) if t.annotations else None,
                                 "schema": t.input_schema} for t in tools}
        out["calls"] = []
        for name, args in actions:
            r = await c.call_tool(name, args)
            out["calls"].append({"tool": name, "is_error": r.is_error, "structured": r.structured_content,
                                 "text": [getattr(x, "text", None) for x in r.content]})
    print(json.dumps(out))
asyncio.run(main())
''' % mode

    def run_client(self, mode, actions, fake_mode="ok", server_args=None):
        env = self.env(fake_mode)
        args = [SERVER, "--cli", self.cli, "--catalog", CATALOG] + (server_args or [])
        p = subprocess.run([SDK_PY, "-c", self.client_script(mode, actions), SDK_PY, json.dumps(args), json.dumps(env),
                            json.dumps(actions)], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stderr[-4000:])
        return json.loads(p.stdout.strip().splitlines()[-1]), p.stderr

    def test_modern_discover_lists_six_tools_with_annotations(self):
        out, err = self.run_client("2026-07-28", [])
        self.assertEqual(out["protocol_version"], "2026-07-28")
        self.assertEqual(sorted(out["tools"]), ["bit", "check", "explain_error", "flash", "new", "sim"])
        fl = out["tools"]["flash"]
        self.assertTrue(fl["ann"]["destructiveHint"] and fl["ann"]["openWorldHint"])
        self.assertIn("WRITES THE CONNECTED BOARD", fl["desc"])
        for t in ("sim", "bit"):
            self.assertFalse(out["tools"][t]["ann"]["readOnlyHint"])
            self.assertIn("not read-only", out["tools"][t]["desc"])
        self.assertTrue(out["tools"]["check"]["ann"]["readOnlyHint"])
        self.assertTrue(out["tools"]["explain_error"]["ann"]["readOnlyHint"])
        self.assertEqual(out["tools"]["new"]["schema"]["required"], ["name", "parent"])

    def test_auto_mode_discovers_modern(self):
        out, _ = self.run_client("auto", [["explain_error", {"code": "board-not-found"}]])
        self.assertEqual(out["protocol_version"], "2026-07-28")
        c = out["calls"][0]
        self.assertFalse(c["is_error"])
        s = c["structured"]
        self.assertEqual(s["code"], "board-not-found")
        self.assertEqual(s["step"], "flash")
        self.assertTrue(s["why"] and s["fix"] and s["title"] and s["summary"])
        self.assertTrue(s["url"].endswith("/errors/board-not-found/"))

    def test_explain_unknown_and_validation_errors(self):
        out, _ = self.run_client("2026-07-28", [
            ["explain_error", {"code": "board-not-fund"}],
            ["explain_error", {"code": "../etc/passwd"}],
            ["sim", {"project": "relative/dir"}],
            ["sim", {"project": self.project, "testbench": "../x.sv"}],
            ["sim", {"project": self.project, "testbench": "--help"}],
            ["bit", {"project": self.project, "top": "a b"}],
            ["bit", {"project": self.project, "timeout_s": 0}],
            ["flash", {"project": os.path.join(self.tmp, "missing")}],
            ["new", {"name": "-rf", "parent": self.project}],
            ["new", {"name": "ok", "parent": "not/abs"}],
        ])
        for c in out["calls"]:
            self.assertTrue(c["is_error"], c)
        self.assertIn("board-not-found", out["calls"][0]["text"][0])
        self.assertIn("Nearest", out["calls"][0]["text"][0])
        self.assertFalse(os.path.exists(self.log), "no CLI call for rejected arguments")

    def test_structured_failure_is_error_true(self):
        out, _ = self.run_client("2026-07-28", [["bit", {"project": self.project, "top": "blink", "timeout_s": 7}]],
                                 fake_mode="fail")
        c = out["calls"][0]
        self.assertTrue(c["is_error"])
        self.assertEqual(c["structured"]["code"], "undefined-name")
        self.assertEqual(c["structured"]["diagnostics"][0]["line"], 7)
        self.assertIn("top.sv:7: [undefined-name]: foo is not declared Fix: declare it", c["text"][0])
        self.assertEqual(self.argv(), ["bit", "--json", "--timeout=7", "blink"])
        with open(self.log + ".cwd") as f:
            self.assertEqual(os.path.realpath(f.read().strip()), os.path.realpath(self.project))

    def test_success_argv_and_unicode_cwd(self):
        out, _ = self.run_client("2026-07-28", [["sim", {"project": self.project, "testbench": "tüb_tb.sv"}]])
        c = out["calls"][0]
        self.assertFalse(c["is_error"])
        self.assertTrue(c["structured"]["ok"])
        self.assertEqual(self.argv(), ["sim", "--json", "--timeout=120", "tüb_tb.sv"])
        out, _ = self.run_client("2026-07-28", [["check", {}]])
        self.assertEqual(self.argv(), ["check", "--json", "--timeout=60"])
        out, _ = self.run_client("2026-07-28", [["flash", {"project": self.project}]])
        self.assertEqual(self.argv(), ["flash", "--json", "--timeout=120"])
        self.assertIn("blink.bit", out["calls"][0]["text"][0])

    def test_garbage_output_is_tool_error_not_success(self):
        out, _ = self.run_client("2026-07-28", [["check", {}]], fake_mode="garbage")
        c = out["calls"][0]
        self.assertTrue(c["is_error"])
        self.assertIn("2 lines", c["text"][0])
        self.assertIn("stderr noise", c["text"][0])

    def test_new_creates_and_refuses_existing(self):
        out, _ = self.run_client("2026-07-28", [["new", {"name": "lab-1", "parent": self.project}],
                                                ["new", {"name": "lab-1", "parent": self.project}]])
        a, b = out["calls"]
        self.assertFalse(a["is_error"], a)
        self.assertEqual(a["structured"]["files"], [".vscode/tasks.json", "blink.sv", "blink.xdc"])
        self.assertTrue(b["is_error"])
        self.assertEqual(b["structured"]["code"], "folder-exists")

    def test_clean_eof_and_quiet_stdout(self):
        p = subprocess.run([SDK_PY, SERVER, "--cli", self.cli, "--catalog", CATALOG], env=self.env(),
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, b"", "stdout is protocol only")

    def test_cancel_kills_child_session_and_server_stays_responsive(self):
        env = self.env("nest")
        args = [SERVER, "--cli", self.cli, "--catalog", CATALOG]
        script = r"""
import anyio, json, sys, time
from mcp.client.client import Client
from mcp.client.stdio import StdioServerParameters
params = StdioServerParameters(command=sys.argv[1], args=json.loads(sys.argv[2]), env=json.loads(sys.argv[3]))
async def main():
    async with Client(params, mode="2026-07-28") as c:
        with anyio.move_on_after(3) as sc:
            await c.call_tool("sim", {"project": sys.argv[4]})
        t = time.time(); r = await c.call_tool("explain_error", {"code": "board-not-found"})
        print(json.dumps({"cancelled": sc.cancelled_caught, "next_s": time.time() - t, "next_err": r.is_error}))
anyio.run(main)
"""
        p = subprocess.run([SDK_PY, "-c", script, SDK_PY, json.dumps(args), json.dumps(env), self.project], env=env,
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stderr[-4000:])
        out = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertTrue(out["cancelled"])
        self.assertFalse(out["next_err"])
        self.assertLess(out["next_s"], 5, "event loop not blocked by the cancelled call")
        with open(self.log + ".child") as f:
            child = int(f.read())
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                os.kill(child, 0)
            except ProcessLookupError:
                break
            time.sleep(0.2)
        else:
            os.kill(child, 9)
            self.fail("the CLI's own session (pid %d) outlived the cancelled call" % child)


@unittest.skipUnless(HAVE_SDK and REAL_CLI, "set DEWFPGA_MCP_TEST_CLI to a dewfpga with --json")
class RealCliTests(Base):
    """Real stdio client, real JSON CLI: sim of the blink template passes, check reports through the result schema."""

    def test_real_cli_sim_check_explain(self):
        tpl = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(REAL_CLI))), "templates")
        for f in ("blink.sv", "blink_tb.sv", "blink.xdc"):
            shutil.copy(os.path.join(tpl, f), self.project)
        env = dict(ENV, FPGA_HOME=os.path.join(self.tmp, "fpga"))
        args = [SERVER, "--cli", REAL_CLI, "--catalog", CATALOG]
        script = r"""
import anyio, json, sys
from mcp.client.client import Client
from mcp.client.stdio import StdioServerParameters
params = StdioServerParameters(command=sys.argv[1], args=json.loads(sys.argv[2]), env=json.loads(sys.argv[3]))
async def main():
    out = {}
    async with Client(params, mode="2026-07-28") as c:
        for name, a in (("sim", {"project": sys.argv[4]}), ("check", {"project": sys.argv[4]}),
                        ("explain_error", {"code": "board-not-found"})):
            r = await c.call_tool(name, a)
            out[name] = {"is_error": r.is_error, "sc": r.structured_content}
    print(json.dumps(out))
anyio.run(main)
"""
        p = subprocess.run([SDK_PY, "-c", script, SDK_PY, json.dumps(args), json.dumps(env), self.project], env=env,
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300)
        self.assertEqual(p.returncode, 0, p.stderr[-4000:])
        out = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertFalse(out["sim"]["is_error"], out["sim"])
        s = out["sim"]["sc"]
        self.assertEqual((s["schema"], s["ok"], s["exit_code"]), ("dewfpga/result@1", True, 0))
        c = out["check"]["sc"]
        self.assertEqual(c["schema"], "dewfpga/result@1")
        self.assertEqual(out["check"]["is_error"], c["ok"] is not True)
        self.assertFalse(out["explain_error"]["is_error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
