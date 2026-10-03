#!/usr/bin/env python3
"""dewfpga mcp: a Model Context Protocol server (stdio only) over the dewfpga CLI.

Started by  bin/dewfpga mcp  with the interpreter of the owned venv $FPGA_HOME/mcp-venv (templates/mcp_setup.py builds it).
Six tools: check, new, sim, bit, flash, explain_error. Every build tool runs the same CLI the student runs, in JSON mode
(`dewfpga <command> --json`, templates/agent_json.py) as an argv list, never through a shell, and hands the one JSON object
back as structuredContent. A failing build is a normal result with isError=true (the model needs the diagnostics), never a
JSON-RPC error. stdout carries protocol frames only; everything else goes to stderr.

    mcp_server.py [--cli <bin/dewfpga>] [--catalog <docs/errors.md>]

Exit codes: 0 on client EOF, 3 when the mcp package is missing (dewfpga install builds the venv), 2 on a usage error.
"""
import difflib
import json
import os
import re
import selectors
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.realpath(__file__))
ROOT = os.path.dirname(HERE)
SITE = "https://nosey-dewdrop.github.io/dewfpga/errors"
EXIT_MISSING_SDK = 3
EXIT_USAGE = 2
STDOUT_CAP = 4 * 1024 * 1024    # the JSON object of the CLI; a line this long is a wrapper bug, not a result
STDERR_CAP = 64 * 1024          # kept for the error message only
CLI_DEFAULT = os.path.join(ROOT, "bin", "dewfpga")
CATALOG_DEFAULT = os.path.join(ROOT, "docs", "errors.md")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,127}$")
FILE_RE = re.compile(r"^[\w][\w.-]{0,127}$")  # a file name in the project: no slash, no leading dash, Unicode letters fine
CODE_RE = re.compile(r"^[a-z0-9-]{1,64}$")
DIAG_RE = re.compile(r"^(?:(?P<file>[^:\s]+):(?P<line>\d+): )?(?P<severity>ERROR|warning|note) \[(?P<code>[a-z0-9-]+)\]: "
                     r"(?P<message>.*?)(?: Fix: (?P<fix>.*?))? (?P<url>https://\S+/)$")

try:
    import anyio
    from mcp.server.mcpserver import MCPServer
    from mcp.server.mcpserver.exceptions import ToolError
    from mcp_types import CallToolResult, TextContent, ToolAnnotations
except ImportError as exc:  # the plain CLI keeps working without this; only `dewfpga mcp` needs the package
    sys.stderr.write("ERROR [mcp-not-installed]: the mcp Python package is not available to %s (%s). "
                     "Fix: dewfpga install  (it builds $FPGA_HOME/mcp-venv from templates/mcp-requirements.txt; "
                     "the rest of dewfpga works without it). %s/mcp-not-installed/\n" % (sys.executable, exc, SITE))
    sys.exit(EXIT_MISSING_SDK)


def log(msg):
    sys.stderr.write("dewfpga mcp: %s\n" % msg)
    sys.stderr.flush()


# ------------------------------------------------------------------ argument checks (before anything runs)
def check_project(project):
    if not isinstance(project, str) or not project:
        raise ToolError("project must be the absolute path of the project folder (the one holding the .sv and .xdc files).")
    if not os.path.isabs(project):
        raise ToolError("project must be an absolute path, got %r." % project)
    real = os.path.realpath(project)
    if not os.path.isdir(real):
        raise ToolError("project folder does not exist or is not a folder: %s" % project)
    return real


def check_match(value, rx, what, example):
    if value is None:
        return None
    if not isinstance(value, str) or not rx.match(value):
        raise ToolError("%s must match %s (for example %s), got %r." % (what, rx.pattern, example, value))
    return value


def check_timeout(t, hi, default):
    if t is None:
        return default
    if not isinstance(t, int) or isinstance(t, bool) or not 1 <= t <= hi:
        raise ToolError("timeout_s must be an integer from 1 to %d, got %r." % (hi, t))
    return t


# ------------------------------------------------------------------ the CLI, in JSON mode
SCHEMA = "dewfpga/result@1"
EOF_GRACE = 2.0        # after the CLI exits, how long a pipe may stay open (held by an escaped grandchild) before we stop reading
TERM_GRACE = 5.0       # SIGTERM to every process group the CLI made, then SIGKILL to the ones still alive
CANCEL_WAIT = 15.0     # a cancelled tool call waits this long (shielded, the event loop keeps running) for the tree to be gone


class Stopped(Exception):
    pass


def process_table():
    """{pid: (ppid, pgid)} from ps; {} when ps is unavailable (then only the CLI's own group is known)."""
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,pgid="], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    table = {}
    for line in out.decode("ascii", "replace").splitlines():
        f = line.split()
        if len(f) == 3 and all(x.isdigit() for x in f):
            table[int(f[0])] = (int(f[1]), int(f[2]))
    return table


class Tree:
    """Every pid and process group the CLI started, remembered while it runs: `dewfpga <cmd> --json` puts the build in a
    session of its own (agent_json.py start_new_session), so killing the CLI's group alone leaves that build running."""

    def __init__(self, proc):
        self.proc, self.pids, self.groups, self.mine = proc, {proc.pid}, {proc.pid}, os.getpgrp()

    def scan(self):
        table = process_table()
        grew = True
        while grew:
            grew = False
            for pid, (ppid, pgid) in table.items():
                if ppid in self.pids and pid not in self.pids:
                    self.pids.add(pid)
                    grew = True
        for pid in self.pids:
            if pid in table and table[pid][1] not in (0, 1, self.mine):
                self.groups.add(table[pid][1])
        return table

    def alive(self):
        """Remembered groups that still hold a remembered pid (a recycled group number of a stranger is never signalled)."""
        self.proc.poll()  # reap the CLI itself, a zombie would count as alive
        table = self.scan()
        return sorted({pg for pid, (_, pg) in table.items() if pg in self.groups and pid in self.pids})

    def kill(self):
        for sig, wait in ((signal.SIGTERM, TERM_GRACE), (signal.SIGKILL, 2.0)):
            groups = self.alive()
            if not groups:
                return True
            for g in groups:
                try:
                    os.killpg(g, sig)
                except (ProcessLookupError, PermissionError):
                    pass
            end = time.monotonic() + wait
            while time.monotonic() < end and self.alive():
                time.sleep(0.1)
        return not self.alive()


def run_cli(cli, argv, cwd, timeout, stop=None):
    """argv list, no shell, stdin closed. Reads both pipes while the CLI runs with bounded memory: stdout keeps its first
    STDOUT_CAP bytes (one more byte and the tree is stopped: no JSON object is that long), stderr keeps its last STDERR_CAP.
    Ends on exit (+EOF_GRACE for pipes an escaped grandchild holds), on the deadline, or when `stop` is set (MCP
    cancellation); in the last two cases every process group the CLI made gets SIGTERM, then SIGKILL.
    Returns (rc, stdout, stderr, info) where info has truncated, held, stopped ('timeout'|'cancelled'|'cap'|None)."""
    try:
        p = subprocess.Popen([cli] + argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True)
    except OSError as exc:
        raise ToolError("cannot start the dewfpga CLI at %s: %s" % (cli, exc))
    tree, out, err = Tree(p), bytearray(), bytearray()
    info = {"truncated": False, "held": False, "stopped": None, "stderr_dropped": 0}
    sel = selectors.DefaultSelector()
    for f, buf in ((p.stdout, out), (p.stderr, err)):
        os.set_blocking(f.fileno(), False)
        sel.register(f, selectors.EVENT_READ, buf)
    deadline, exited_at, next_scan = time.monotonic() + timeout, None, 0.0
    try:
        while sel.get_map():
            now = time.monotonic()
            if stop is not None and stop.is_set():
                info["stopped"] = "cancelled"
            elif now >= deadline:
                info["stopped"] = "timeout"
            if info["stopped"]:
                break
            if exited_at is None and p.poll() is not None:
                exited_at = now
            if exited_at is not None and now - exited_at > EOF_GRACE:
                info["held"] = True  # the CLI is gone, something it started still holds the pipe: stop reading, clean up below
                break
            if now >= next_scan:
                tree.scan()
                next_scan = now + 0.5
            for key, _ in sel.select(0.1):
                try:
                    chunk = os.read(key.fd, 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    sel.unregister(key.fileobj)
                    continue
                buf = key.data
                buf += chunk
                if buf is out and len(out) > STDOUT_CAP:
                    del out[STDOUT_CAP:]
                    info["truncated"], info["stopped"] = True, "cap"
                    break
                if buf is err and len(err) > STDERR_CAP:
                    info["stderr_dropped"] += len(err) - STDERR_CAP
                    del err[:len(err) - STDERR_CAP]
            if info["stopped"] == "cap":
                break
    finally:
        sel.close()
        p.stdout.close()
        p.stderr.close()
        clean = tree.kill()  # also after a normal exit: nothing the CLI started outlives the call
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            clean = False
        if not clean:
            log("warning: some processes of `dewfpga %s` did not stop: groups %s" % (" ".join(argv[:1]), tree.alive()))
    return p.returncode, bytes(out), bytes(err), info


def tail(err):
    return err.decode("utf-8", "replace")[-2000:] or "(empty)"


def run_json(cli, command, args, cwd, timeout_s, stop=None):
    """dewfpga <command> --json <args>: exactly one dewfpga/result@1 object on stdout whose ok, exit_code and the process
    exit status agree; anything else is a ToolError saying what came instead (never a success)."""
    argv = [command, "--json", "--timeout=%d" % timeout_s] + list(args)
    rc, out, err, info = run_cli(cli, argv, cwd, timeout_s + 30, stop)
    if info["stopped"] == "cancelled":
        raise Stopped()
    if info["stopped"] == "timeout":
        raise ToolError("dewfpga %s did not finish in %d s and was stopped with every process it started (the CLI's own "
                        "--timeout did not fire). stderr tail: %s" % (command, timeout_s + 30, tail(err)))
    text = out.decode("utf-8", "replace")
    lines = [l for l in text.splitlines() if l.strip()]
    if info["truncated"] or len(lines) != 1:
        raise ToolError("dewfpga %s --json printed %s instead of one JSON object (exit %s). stderr: %s" % (
            command, "more than %d bytes" % STDOUT_CAP if info["truncated"] else "%d lines" % len(lines), rc, tail(err)))
    try:
        r = json.loads(lines[0])
    except ValueError as exc:
        raise ToolError("dewfpga %s --json printed something that is not JSON (%s). stderr: %s" % (command, exc, tail(err)))
    bad = None
    if not isinstance(r, dict):
        bad = "not an object"
    elif r.get("schema") != SCHEMA:
        bad = "schema is %r, expected %r" % (r.get("schema"), SCHEMA)
    elif r.get("command") != command:
        bad = "command is %r, expected %r" % (r.get("command"), command)
    elif not isinstance(r.get("ok"), bool):
        bad = "ok is %r, not true/false" % (r.get("ok"),)
    elif not isinstance(r.get("exit_code"), int) or isinstance(r.get("exit_code"), bool):
        bad = "exit_code is %r, not an integer" % (r.get("exit_code"),)
    elif r["ok"] != (r["exit_code"] == 0):
        bad = "ok=%s contradicts exit_code=%d" % (str(r["ok"]).lower(), r["exit_code"])
    elif rc != r["exit_code"]:
        bad = "the process exited %s but the object says exit_code=%d" % (rc, r["exit_code"])
    if bad:
        raise ToolError("dewfpga %s --json printed an object that cannot be trusted (%s); not reported as a result. "
                        "stderr: %s" % (command, bad, tail(err)))
    if info["held"]:
        log("warning: `dewfpga %s` exited but a process it started held its output open; it was stopped" % command)
    return r


async def in_thread(fn, *args):
    """Runs fn(*args, stop=Event) in a worker thread. MCP cancellation (notifications/cancelled, client gone) returns to the
    event loop at once (abandon_on_cancel), sets stop, and waits, shielded and bounded, until the worker has stopped the
    CLI and its process groups; the loop keeps serving other requests meanwhile."""
    stop, done = threading.Event(), threading.Event()

    def work():
        try:
            return fn(*args, stop=stop)
        finally:
            done.set()

    try:
        return await anyio.to_thread.run_sync(work, abandon_on_cancel=True)
    except anyio.get_cancelled_exc_class():
        stop.set()
        with anyio.CancelScope(shield=True):
            with anyio.move_on_after(CANCEL_WAIT):
                while not done.is_set():
                    await anyio.sleep(0.05)
        raise


def summarize(command, r):
    """One text line the model reads next to the structured object."""
    if r.get("ok"):
        extra = ""
        if command in ("bit", "flash"):
            bits = [a["path"] for a in r.get("artifacts") or [] if a.get("kind") == "bit"]
            if bits:
                extra = " " + bits[0]
        return "dewfpga %s: ok (exit 0)%s" % (command, extra)
    diags = r.get("diagnostics") or []
    first = next((d for d in diags if d.get("severity") == "error"), diags[0] if diags else None)
    where = ""
    if first:
        if first.get("file"):
            where = "%s:%s: " % (first["file"], first.get("line") or "")
        msg = "%s[%s]: %s" % (where, first.get("code"), first.get("message"))
        if first.get("fix"):
            msg += " Fix: " + first["fix"]
        if first.get("url"):
            msg += " " + first["url"]
    else:
        tail = (r.get("log") or {}).get("tail") or []
        msg = "no diagnostic line; log tail: " + " | ".join(tail[-5:]) if tail else "no diagnostic line"
    return "dewfpga %s: FAILED (exit %s, code %s). %s" % (command, r.get("exit_code"), r.get("code"), msg)


def tool_result(command, r):
    # the build failing is data the model needs: isError=true carries it, nothing is dropped and nothing is dressed up as success
    return CallToolResult(content=[TextContent(type="text", text=summarize(command, r))],
                          structured_content=r, is_error=r["ok"] is not True)


# ------------------------------------------------------------------ the error catalog, offline
def load_catalog(path):
    """docs/errors.md: '## <code>' + 'step:'/'source:'/'title:'/'summary:'/'date:' lines, then prose with
    '## Why does it happen?' and '## What is the fix?'. Entries without a step: line (the page intro) are skipped."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as exc:
        raise ToolError("the error catalog is not readable: %s (%s)" % (path, exc))
    entries, cur, section = {}, None, None
    for raw in text.split("\n"):
        line = raw.rstrip()
        m = re.match(r"^## (\S+)$", line)
        if m and CODE_RE.match(m.group(1)):
            cur = {"code": m.group(1), "step": None, "source": None, "title": None, "summary": None,
                   "date": None, "why": [], "fix": [], "text": [], "url": "%s/%s/" % (SITE, m.group(1))}
            section = "text"
            continue
        if cur is None:
            continue
        if line.startswith("## "):
            section = {"## Why does it happen?": "why", "## What is the fix?": "fix"}.get(line, "text")
            if section == "text":  # another heading: this entry ended
                cur = None
            continue
        m = re.match(r"^(step|source|title|summary|date): (.*)$", line)
        if m and section == "text" and cur[m.group(1)] is None and not cur["text"]:
            cur[m.group(1)] = m.group(2).strip()
            if m.group(1) == "step":
                entries[cur["code"]] = cur
            continue
        cur[section].append(raw)
    for e in entries.values():
        for k in ("why", "fix", "text"):
            e[k] = "\n".join(e[k]).strip()
    return entries


def explain(catalog_path, code):
    code = check_match(code, CODE_RE, "code", "board-not-found")
    entries = load_catalog(catalog_path)
    e = entries.get(code)
    if e is None:
        near = difflib.get_close_matches(code, sorted(entries), n=5, cutoff=0.4)
        if len(near) < 5:
            near += [c for c in sorted(entries) if c not in near and (c.startswith(code[:4]) or code[:4] in c)][:5 - len(near)]
        raise ToolError("unknown error code %r; the catalog (%d codes) has nothing by that name. Nearest: %s" % (
            code, len(entries), ", ".join(near) if near else "(none)"))
    return {"code": e["code"], "step": e["step"], "source": e["source"], "title": e["title"], "summary": e["summary"],
            "why": e["why"], "fix": e["fix"], "context": e["text"], "url": e["url"]}


# ------------------------------------------------------------------ server
def build_server(cli, catalog):
    server = MCPServer("dewfpga", version=read_version(),
                       instructions="Builds SystemVerilog for the Digilent Basys3 with the open-source chain (yosys, "
                                    "nextpnr-xilinx, prjxray) on macOS. Run check once, sim before bit, and read "
                                    "diagnostics[].code; explain_error gives the why and the fix for a code. flash writes "
                                    "the connected board: only when the user asks.")
    rw = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True,
                                             open_world_hint=False),
                 description="Checks the installed toolchain (yosys, yosys-slang, nextpnr-xilinx, prjxray, chipdb, venv, "
                             "iverilog, openFPGALoader). Writes nothing. ok=false with code toolchain-not-installed means "
                             "dewfpga install is needed before bit or flash.")
    async def check() -> CallToolResult:
        r = await in_thread(run_json, cli, "check", [], tempfile.gettempdir(), 60)
        return tool_result("check", r)

    @server.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False,
                                             open_world_hint=False),
                 description="Creates a new Basys3 project folder <parent>/<name> from the blink template (blink.sv, "
                             "blink_tb.sv, blink.xdc, .vscode/). Refuses when the path already exists; never overwrites.")
    async def new(name: str, parent: str) -> CallToolResult:
        name = check_match(name, NAME_RE, "name", "blink2")
        parent = check_project(parent)
        target = os.path.join(parent, name)
        r = await in_thread(run_new, cli, name, parent, target)
        return CallToolResult(content=[TextContent(type="text", text=r["message"])], structured_content=r,
                              is_error=not r["ok"])

    @server.tool(annotations=rw,
                 description="Runs the testbench with Icarus Verilog (dewfpga sim --json) in the project folder. "
                             "Like the CLI, it may rewrite source files in that folder before building (check_xdc "
                             "--fix-ports: port directions, names for unnamed instances); it is not read-only. "
                             "testbench is a file name in the project (no path). A failing testbench or a compile error "
                             "comes back as isError=true with diagnostics[] and the log tail.")
    async def sim(project: str, testbench: str | None = None, timeout_s: int | None = None) -> CallToolResult:
        project = check_project(project)
        testbench = check_match(testbench, FILE_RE, "testbench", "blink_tb.sv")
        timeout_s = check_timeout(timeout_s, 600, 120)
        args = [testbench] if testbench else []
        r = await in_thread(run_json, cli, "sim", args, project, timeout_s)
        return tool_result("sim", r)

    @server.tool(annotations=rw,
                 description="Synthesizes, places, routes and writes <top>.bit in the project folder (dewfpga bit --json). "
                             "Like the CLI, it may rewrite source files in that folder first (check_xdc --fix-ports); it is "
                             "not read-only. Does not touch the board. top is a module name; without it the CLI picks the "
                             "project's top.")
    async def bit(project: str, top: str | None = None, timeout_s: int | None = None) -> CallToolResult:
        project = check_project(project)
        top = check_match(top, IDENT_RE, "top", "blink")
        timeout_s = check_timeout(timeout_s, 1800, 600)
        args = [top] if top else []
        r = await in_thread(run_json, cli, "bit", args, project, timeout_s)
        return tool_result("bit", r)

    @server.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False,
                                             open_world_hint=True),
                 description="WRITES THE CONNECTED BOARD: builds the bitstream if needed and programs the Basys3 over USB "
                             "with openFPGALoader (dewfpga flash --json), replacing whatever the FPGA is running. Only call "
                             "it when the user asked to flash. No board: isError=true, code board-not-found.")
    async def flash(project: str, timeout_s: int | None = None) -> CallToolResult:
        project = check_project(project)
        timeout_s = check_timeout(timeout_s, 300, 120)
        r = await in_thread(run_json, cli, "flash", [], project, timeout_s)
        return tool_result("flash", r)

    @server.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True,
                                             open_world_hint=False),
                 description="Explains a dewfpga error code (diagnostics[].code, or the [code] in a terminal line) from the "
                             "packaged catalog, offline: step, title, summary, why it happens, what the fix is, and the "
                             "page URL. Unknown code: error listing the nearest codes.")
    async def explain_error(code: str) -> CallToolResult:
        e = await anyio.to_thread.run_sync(explain, catalog, code)
        text = "%s (%s step): %s\n\nWhy does it happen?\n%s\n\nWhat is the fix?\n%s\n\n%s" % (
            e["code"], e["step"], e["summary"], e["why"], e["fix"], e["url"])
        return CallToolResult(content=[TextContent(type="text", text=text)], structured_content=e, is_error=False)

    return server


def run_new(cli, name, parent, target, stop=None):
    if os.path.lexists(target):
        return {"ok": False, "exit_code": 1, "code": "folder-exists", "path": target, "files": [],
                "message": "ERROR [folder-exists]: %s already exists, and dewfpga new does not overwrite. Fix: pick another "
                           "name, or work in that folder. %s/folder-exists/" % (target, SITE)}
    rc, out, err, info = run_cli(cli, ["new", name], parent, 60, stop)
    if info["stopped"] == "cancelled":
        raise Stopped()
    if info["stopped"] == "timeout":
        raise ToolError("dewfpga new did not finish in 60 s and was stopped. stderr tail: %s" % tail(err))
    text = (out + err).decode("utf-8", "replace")
    diags = [m.groupdict() for m in (DIAG_RE.match(l.strip()) for l in text.splitlines()) if m]
    first = next((d for d in diags if d["severity"] == "ERROR"), None)
    files = []
    if rc == 0 and os.path.isdir(target):
        for dp, dns, fns in os.walk(target):
            for fn in fns:
                files.append(os.path.relpath(os.path.join(dp, fn), target))
        files.sort()
    ok = rc == 0 and bool(files)
    msg = text.strip().splitlines()[-1] if text.strip() else "(dewfpga new printed nothing)"
    if ok:
        msg = "created %s with %d files: %s" % (target, len(files), ", ".join(files))
    return {"ok": ok, "exit_code": rc, "code": first["code"] if first else (None if ok else "internal"),
            "path": target, "files": files, "message": msg[:4000]}


def read_version():
    try:
        with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
            return str(json.load(f).get("version", ""))
    except (OSError, ValueError):
        return ""


def main(argv):
    cli, catalog = os.environ.get("DEWFPGA_CLI") or CLI_DEFAULT, CATALOG_DEFAULT
    it = iter(argv)
    for a in it:
        if a == "--cli":
            cli = next(it, None)
        elif a == "--catalog":
            catalog = next(it, None)
        else:
            sys.stderr.write("usage: mcp_server.py [--cli <bin/dewfpga>] [--catalog <docs/errors.md>]\n")
            return EXIT_USAGE
    if not cli or not catalog:
        sys.stderr.write("usage: mcp_server.py [--cli <bin/dewfpga>] [--catalog <docs/errors.md>]\n")
        return EXIT_USAGE
    cli = os.path.realpath(cli)
    if not os.access(cli, os.X_OK):
        log("warning: CLI %s is not executable; build tools will fail until it is" % cli)
    if not os.path.isfile(catalog):
        log("warning: error catalog %s is missing; explain_error will fail" % catalog)
    server = build_server(cli, catalog)
    server.run(transport="stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
