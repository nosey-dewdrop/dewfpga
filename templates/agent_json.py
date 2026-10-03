#!/usr/bin/env python3
"""dewfpga --json: run the text CLI once, print exactly one JSON object (schema dewfpga/result@1), exit with a mapped code.

bin/dewfpga hands over here before it prints anything:  agent_json.py --cli <bin/dewfpga> -- <command> [args...]
The command runs in text mode as a child (argument array, no shell, its own process group); both streams are
drained concurrently into a bounded log file; the message lines ([file:line: ]{ERROR|warning|note} [code]: ...)
become diagnostics. Nothing the child prints reaches our stdout. Standard library only.

Exit codes (JSON mode only; text mode keeps its own):
  0 ok  1 design or project problem (any other ERROR code, or a failed child without a message)
  2 usage (unknown-option, unknown-command, run-inside-the-folder, bad --timeout, --json on another command)
  3 toolchain (toolchain-not-installed, yosys-slang-does-not-load, yosys-crashed, second-reader-missing, mcp-not-installed)
  4 board (board-not-found, openfpgaloader-failed)
  124 wall-clock timeout of the whole command (code command-timeout; the child's process group gets TERM, then KILL)
  70 the wrapper itself failed (code internal)
Timeout: --timeout=<seconds> (1..3600) or env DEWFPGA_JSON_TIMEOUT (seconds, for tests); default per command below.
"""
import collections
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

SCHEMA = "dewfpga/result@1"
COMMANDS = ("check", "sim", "bit", "flash")
DEFAULT_TIMEOUT = {"check": 60, "sim": 180, "bit": 900, "flash": 120}
EXIT_FOR_CODE = {
    "unknown-option": 2, "unknown-command": 2, "run-inside-the-folder": 2,
    "toolchain-not-installed": 3, "yosys-slang-does-not-load": 3, "yosys-crashed": 3, "second-reader-missing": 3,
    "mcp-not-installed": 3,
    "board-not-found": 4, "openfpgaloader-failed": 4,
}
EXIT_FALLBACK = 1          # child failed, no ERROR line parsed: a failure we cannot name (cause "child-exit")
EXIT_TIMEOUT, EXIT_INTERNAL, EXIT_USAGE = 124, 70, 2
SITE = "https://nosey-dewdrop.github.io/dewfpga/errors/"
# Multi-driver errors join source locations with " and ": retain the first location; the full line remains in log.tail.
# the file may hold spaces: the #12 CLI with DEWFPGA_ABSPATH=1 prefixes $PWD (same shape as its abspath())
MSG = re.compile(r"^(?:(?P<file>[^\s:][^:\n]*):(?P<line>\d{1,9})(?: and [^\s:][^:\n]*:\d{1,9})*: )?(?P<severity>ERROR|warning|note) \[(?P<code>[a-z0-9-]+)\]: "
                 r"(?P<message>.*?)(?: Fix: (?P<fix>.*?))? (?P<url>https://\S+/)\s*$")
MAX_DIAG = 50              # per kind: up to 50 errors and up to 50 warnings/notes, so a warning flood cannot hide an error
TAIL_LINES, TAIL_BYTES = 60, 8192   # the tail is at most 60 lines and 8192 UTF-8 bytes in total
LOG_CAP = 8 * 1024 * 1024  # bytes kept on disk; past that the stream is counted, not stored
ARTIFACT_GLOBS = (".bit", ".vcd", ".log")
PROJECT_LEVELS = 7         # the #12 CLI walks up at most 6 levels from <name>.srcs to the folder with the .xpr
USAGE_CODES = ("unknown-option", "unknown-command", "run-inside-the-folder")


def emit(obj, code):
    out = json.dumps(obj, ensure_ascii=False).encode("utf-8", "replace") + b"\n"
    try:
        sys.stdout.buffer.write(out)
        sys.stdout.buffer.flush()
    except (BrokenPipeError, OSError):
        pass
    return code


def result(command, **kw):
    r = {"schema": SCHEMA, "version": None, "command": command, "ok": False, "exit_code": EXIT_INTERNAL, "cause": None,
         "code": None, "top": None, "testbench": None, "diagnostics": [], "diagnostics_truncated": False,
         "sim": None, "artifacts": [], "log": None, "child_exit": None, "duration_ms": 0}
    r.update(kw)
    return r


def diag(d, code, message, fix=None, severity="error"):
    return {"severity": severity, "code": code, "file": None, "line": None, "message": message, "fix": fix,
            "url": SITE + code + "/"}


def usage(command, code, message, fix, version):
    r = result(command, version=version, exit_code=EXIT_USAGE, cause="usage", code=code,
               diagnostics=[diag(None, code, message, fix)])
    return emit(r, EXIT_USAGE)


class Drain(threading.Thread):
    """Reads one child stream to the end: appends to the shared bounded log, keeps a bounded tail, parses messages."""

    def __init__(self, stream, name, sink):
        super().__init__(daemon=True)
        self.stream, self.name, self.sink = stream, name, sink
        self.buf = b""
        self.error = None

    def run(self):
        try:
            while True:
                chunk = self.stream.read(65536)
                if not chunk:
                    break
                self.sink.write(chunk)
                self.buf += chunk
                *lines, self.buf = self.buf.split(b"\n")
                for ln in lines:
                    self.sink.line(ln)
                if len(self.buf) > 1 << 20:  # a line longer than 1 MiB is never a message: drop its head
                    self.buf = self.buf[-65536:]
            if self.buf:
                self.sink.line(self.buf)
        except Exception as e:  # recorded: a reader that stopped early means the diagnostics are incomplete
            self.error = "%s: %s" % (type(e).__name__, e)
        finally:
            try:
                self.stream.close()
            except Exception:
                pass


class Sink:
    def __init__(self, path):
        self.f = open(path, "wb")
        self.lock = threading.Lock()
        self.written = 0
        self.dropped = 0
        self.tail = collections.deque(maxlen=TAIL_LINES)
        self.diagnostics = []
        self.kept = {"error": 0, "other": 0}
        self.truncated = False
        self.log_error = None
        self.top = None
        self.testbench = None
        self.sim_errors = None
        self.extra = {}

    def write(self, chunk):
        with self.lock:
            room = LOG_CAP - self.written if self.log_error is None else 0
            if room > 0:
                try:
                    self.f.write(chunk[:room])
                    self.written += min(room, len(chunk))
                except OSError as e:   # disk full, file size limit: the log stops, parsing goes on
                    self.log_error = str(e)
                    room = 0
            if len(chunk) > room:
                self.dropped += len(chunk) - max(room, 0)

    def line(self, raw):
        text = raw.decode("utf-8", "replace").rstrip("\r")
        with self.lock:
            self.tail.append(text[:TAIL_BYTES])
            m = MSG.match(text)
            if m:
                g = m.groupdict()
                sev = {"ERROR": "error", "warning": "warning", "note": "note"}[g["severity"]]
                kind = "error" if sev == "error" else "other"
                if self.kept[kind] < MAX_DIAG:
                    self.kept[kind] += 1
                    self.diagnostics.append({
                        "severity": sev,
                        "code": g["code"], "file": g["file"], "line": int(g["line"]) if g["line"] else None,
                        "message": g["message"], "fix": g["fix"], "url": g["url"]})
                else:
                    self.truncated = True
                if m.group("code") == "testbench-error":
                    n = re.search(r"reported (\d+) error", text)
                    if n:
                        self.sim_errors = int(n.group(1))
                return
            if text.startswith("iverilog ") and " -o " in text:   # the sim command line names top and the testbench
                m2 = re.search(r" -o (\S+)_sim (.*)$", text)
                if m2:
                    self.top = self.top or m2.group(1)
                    tb = [w for w in m2.group(2).split() if re.search(r"_tb\.s?v$", w)]
                    if tb:
                        self.testbench = tb[-1][:-3] if tb[-1].endswith(".sv") else tb[-1][:-2]
            elif text.startswith("VCD info: dumpfile ") and self.top is None:   # cached sim binary: make did not print iverilog
                m2 = re.search(r"dumpfile (\S+)\.vcd ", text)
                if m2:
                    self.top = m2.group(1)
            elif re.match(r"\S+_tb\.s?v:\d+: \$finish called", text) and self.testbench is None:
                self.testbench = text.split(":", 1)[0].rsplit(".", 1)[0]
            elif text.startswith("top module: "):
                self.top = text[len("top module: "):].split(" (")[0]
            elif text.startswith("vivado project: "):
                self.extra["vivado_project"] = text[len("vivado project: "):].split(" (")[0]
                m2 = re.search(r" \(top from the project: (\S+)\)$", text)
                if m2:
                    self.top = self.top or m2.group(1)
            elif re.match(r"[^\s/]+\.bit  [0-9.]+ MB$", text):     # the bit recipe names the file it just wrote
                self.top = self.top or text.split(".bit  ")[0]
            elif re.match(r"[^\s/]+\.bit is up to date ", text):   # the CLI names the file make left alone
                self.top = self.top or text.split(".bit is up to date ")[0]
            elif text.startswith("FAIL: "):
                n = re.match(r"FAIL: (\d+) of (\d+)", text)
                if n:
                    self.sim_errors = int(n.group(1))
            elif text.startswith("PASS: ") and self.sim_errors is None:
                self.sim_errors = 0

    def close(self):
        with self.lock:
            try:
                if self.dropped and self.log_error is None:
                    self.f.write(("\n[dewfpga --json: %d more bytes not kept]\n" % self.dropped).encode())
                self.f.close()
            except OSError as e:
                self.log_error = self.log_error or str(e)
                try:
                    self.f.close()
                except OSError:
                    pass

    def tail_out(self):
        """the newest lines that fit in TAIL_BYTES UTF-8 bytes in total; a line longer than what is left keeps its head"""
        out, room = [], TAIL_BYTES
        for text in reversed(self.tail):
            b = text.encode("utf-8", "replace")
            if len(b) > room:
                if room > 0:
                    out.append(b[:room].decode("utf-8", "ignore"))
                break
            out.append(text)
            room -= len(b)
        return out[::-1]


def snapshot(dirs):
    seen = {}
    for d in dirs:
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if n.endswith(ARTIFACT_GLOBS):
                p = os.path.join(d, n)
                try:
                    st = os.stat(p)
                    if not os.path.isfile(p) or st.st_size > 64 << 20:
                        continue
                    h = hashlib.sha256()
                    with open(p, "rb") as f:
                        for chunk in iter(lambda: f.read(1 << 20), b""):
                            h.update(chunk)
                    seen[p] = (h.hexdigest(), st.st_size)
                except OSError:
                    continue
    return seen


def project_dirs(cwd):
    """Mirror the bounded project-root walk before taking any artifact snapshot."""
    d = os.path.realpath(cwd)
    for _ in range(PROJECT_LEVELS):
        try:
            names = [n for n in os.listdir(d) if not n.startswith(".")]
        except OSError:
            return []
        xprs = [n for n in names if n.endswith(".xpr") and os.path.isfile(os.path.join(d, n))]
        if len(xprs) > 1:
            return []
        if len(xprs) == 1 or any(n.endswith(".srcs") and os.path.isdir(os.path.join(d, n, "sources_1")) for n in names):
            return [d] if d != os.path.realpath(cwd) else []
        if not (d.endswith(".srcs") or ".srcs/" in d):
            break
        parent = os.path.dirname(d)
        if parent == d or d == os.path.realpath(os.path.expanduser("~")):
            break
        d = parent
    return []


def artifacts(before, after, rc, scanned, top):
    """Content is compared by sha256, not mtime. new = absent or different before the run (this run wrote it);
    an unchanged file is listed only when the CLI named its top (cached = the run succeeded, stale = it failed:
    yesterday's output, never a success signal); any other unchanged file is left out, it is not proven to be this
    design's. A file in a folder that was not hashed before the run has state null (not proven either way)."""
    out = []
    for p in sorted(after):
        digest, size = after[p]
        kind = p.rsplit(".", 1)[-1]
        name = os.path.basename(p)
        if os.path.dirname(p) not in scanned:
            state = None
        elif p not in before or before[p][0] != digest:
            state = "new"
        elif top and name in {top + ext for ext in (".bit", ".vcd", ".log", ".slang.log", ".yosys.log")}:
            state = "cached" if rc == 0 else "stale"
        else:
            continue
        out.append({"kind": kind, "path": os.path.abspath(p), "state": state, "sha256": digest, "bytes": size})
    return out


def run(cli, argv, env_timeout):
    t0 = time.monotonic()
    here = os.path.dirname(os.path.dirname(os.path.abspath(cli)))
    version = None
    try:
        with open(os.path.join(here, "package.json"), encoding="utf-8") as f:
            version = json.load(f).get("version")
    except Exception:
        pass
    command, args, timeout = None, [], None
    for a in argv:
        if a.startswith("--timeout="):
            v = a[len("--timeout="):]
            if not v.isdigit() or not 1 <= int(v) <= 3600:
                return usage(command, "unknown-option", "--timeout takes a whole number of seconds from 1 to 3600, not %r." % v,
                             "dewfpga <command> --json --timeout=600", version)
            timeout = int(v)
        elif command is None and not a.startswith("-"):
            command = a
        else:
            args.append(a)
    if command not in COMMANDS:
        if command is None:
            return usage(None, "unknown-command", "--json needs a command: one of check, sim, bit, flash.",
                         "dewfpga check --json", version)
        if command in ("install", "uninstall", "new", "clean", "tops", "help", "version"):
            return usage(command, "unknown-option", "dewfpga %s has no --json output; --json is for check, sim, bit and flash." % command,
                         "dewfpga %s   (text mode)" % command, version)
        return usage(command, "unknown-command", "unknown command: %s." % command, "one of check, sim, bit, flash (dewfpga --help lists all)", version)
    if timeout is None and env_timeout:
        try:
            timeout = float(env_timeout)
            if not 0 < timeout <= 3600:
                raise ValueError
        except ValueError:
            return usage(command, "unknown-option", "DEWFPGA_JSON_TIMEOUT must be seconds in (0, 3600], not %r." % env_timeout,
                         "unset it, or DEWFPGA_JSON_TIMEOUT=600", version)
    if timeout is None:
        timeout = DEFAULT_TIMEOUT[command]
    for a in args:
        if "\0" in a:
            return usage(command, "unknown-option", "an argument contains a NUL byte.", "dewfpga %s [top]" % command, version)

    fd, log_path = tempfile.mkstemp(prefix="dewfpga-json-%s-" % command, suffix=".log")
    os.close(fd)
    sink = Sink(log_path)
    dirs = [os.path.realpath(os.getcwd())] + project_dirs(os.getcwd())
    scanned = set(dirs)
    before = snapshot(dirs)
    env = dict(os.environ)
    env.pop("DEWFPGA_JSON_TIMEOUT", None)
    timed_out = False
    try:
        p = subprocess.Popen([cli, command] + args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True, env=env, shell=False)
    except OSError as e:
        sink.close()
        r = result(command, version=version, cause="internal", code="internal", log={"path": log_path, "tail": [], "truncated": False},
                   diagnostics=[diag(None, "internal", "could not start %s: %s" % (cli, e))],
                   duration_ms=int((time.monotonic() - t0) * 1000))
        return emit(r, EXIT_INTERNAL)
    readers = [Drain(p.stdout, "stdout", sink), Drain(p.stderr, "stderr", sink)]
    for r_ in readers:
        r_.start()
    try:
        try:
            rc = p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            rc = kill_group(p)
        held = False
        if not timed_out:
            for r_ in readers:          # both pipes reach EOF once every writer is gone; the child has exited
                r_.join(timeout=1.0)
            held = any(r_.is_alive() for r_ in readers)   # a process the child started still holds its output
        stop_rest(p.pid)                # whatever is left in the child's process group is stopped, success or not
        for r_ in readers:
            r_.join(timeout=5)
        sink.close()
    except BaseException:
        # Parent cancellation must also stop the CLI's separate session and drain its pipes.
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, signal.SIG_IGN)
        try:
            kill_group(p)
            stop_rest(p.pid)
        finally:
            for reader in readers:
                reader.join(timeout=5)
            sink.close()
        raise
    if sink.extra.get("vivado_project"):
        d = os.path.dirname(sink.extra["vivado_project"])
        known = {os.path.realpath(x): x for x in dirs}    # /tmp and /private/tmp are one folder
        if d and os.path.isdir(d) and os.path.realpath(d) not in known:
            dirs.append(os.path.abspath(d))
    after = snapshot(dirs)
    arts = artifacts(before, after, rc if not timed_out else 1, scanned, sink.top)
    if sink.top is None and command == "bit":   # one .bit written by this run names the top; an old one does not
        bits = [a for a in arts if a["kind"] == "bit" and a["state"] == "new"]
        if len(bits) == 1:
            sink.top = os.path.basename(bits[0]["path"])[:-4]
            arts = artifacts(before, after, rc, scanned, sink.top)
    errors = [d for d in sink.diagnostics if d["severity"] == "error"]
    primary = errors[0]["code"] if errors else None
    r = result(command, version=version, top=sink.top, testbench=sink.testbench, child_exit=rc,
               diagnostics=sink.diagnostics, diagnostics_truncated=sink.truncated,
               artifacts=arts, log={"path": log_path, "tail": sink.tail_out(), "truncated": sink.dropped > 0 or sink.log_error is not None},
               duration_ms=int((time.monotonic() - t0) * 1000))
    if command == "sim":
        r["sim"] = {"testbench_errors": sink.sim_errors}
    if timed_out:
        r["cause"], r["code"], r["exit_code"] = "timeout", "command-timeout", EXIT_TIMEOUT
        r["diagnostics"].insert(0, diag(None, "command-timeout",
                                        "dewfpga %s did not finish in %g s and was stopped (its process group got TERM, then KILL)." % (command, timeout),
                                        "run it again with more time: dewfpga %s --json --timeout=%d" % (command, min(3600, int(timeout) * 2 or 60))))
        return emit(r, EXIT_TIMEOUT)
    broken = [r_.error for r_ in readers if r_.error] + ["a reader did not finish"] * sum(r_.is_alive() for r_ in readers)
    if held or broken:              # the output is not known to be complete: never ok, whatever the exit code
        why = ("dewfpga %s exited (exit %s) but a process it started still held its output open; that process group was stopped, "
               "so the output may be incomplete." % (command, rc)) if held else "reading the output of dewfpga %s failed (%s)." % (command, "; ".join(broken))
        r["cause"], r["code"], r["exit_code"] = "internal", "internal", EXIT_INTERNAL
        r["diagnostics"].insert(0, diag(None, "internal", why, "run it again; the full output is in log.path"))
        return emit(r, EXIT_INTERNAL)
    if rc == 0:
        r["ok"], r["exit_code"], r["cause"], r["code"] = True, 0, None, None
        return emit(r, 0)
    if command == "sim" and primary not in USAGE_CODES and not all(shutil.which(t, path=env.get("PATH", "")) for t in ("iverilog", "vvp")):
        # the Makefile has no iverilog check of its own and reports iverilog-refused; the tool is not there at all
        primary = "toolchain-not-installed"
        r["diagnostics"].insert(0, diag(None, primary, "iverilog or vvp is not on PATH, so dewfpga sim cannot run.",
                                        "dewfpga install   (status: dewfpga check)"))
    if primary:
        r["cause"], r["code"], r["exit_code"] = "diagnostic", primary, EXIT_FOR_CODE.get(primary, 1)
    else:
        r["cause"], r["code"], r["exit_code"] = "child-exit", None, EXIT_FALLBACK
    return emit(r, r["exit_code"])


def stop_rest(pgid):
    """TERM, then KILL, to what is left of the child's process group after the child itself has exited"""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            return
        for _ in range(20):
            time.sleep(0.05)
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError):
                return


def kill_group(p):
    for sig, wait in ((signal.SIGTERM, 2.0), (signal.SIGKILL, 5.0)):
        try:
            os.killpg(p.pid, sig)
        except ProcessLookupError:
            pass
        try:
            return p.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            continue
    return p.poll() if p.poll() is not None else -9


def main(argv):
    try:
        cli = None
        if len(argv) >= 3 and argv[0] == "--cli" and argv[2] == "--":
            cli, rest = argv[1], argv[3:]
        else:
            return emit(result(None, cause="internal", code="internal",
                               diagnostics=[diag(None, "internal", "agent_json.py is started by bin/dewfpga --json, not by hand.")]), EXIT_INTERNAL)
        if not os.path.isfile(cli) or not os.access(cli, os.X_OK):
            return emit(result(None, cause="internal", code="internal",
                               diagnostics=[diag(None, "internal", "%s is not an executable CLI." % cli)]), EXIT_INTERNAL)
        return run(cli, rest, os.environ.get("DEWFPGA_JSON_TIMEOUT"))
    except KeyboardInterrupt as exc:
        code = getattr(exc, "exit_code", 130)
        return emit(result(None, cause="internal", code="internal", exit_code=code,
                           diagnostics=[diag(None, "internal", "interrupted")]), code)
    except Exception as e:  # never a traceback on stdout: one object, exit 70
        return emit(result(None, cause="internal", code="internal",
                           diagnostics=[diag(None, "internal", "%s: %s" % (type(e).__name__, e))]), EXIT_INTERNAL)


def terminate(signum, frame):
    exc = KeyboardInterrupt()
    exc.exit_code = 128 + signum
    raise exc


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate)
    sys.exit(main(sys.argv[1:]))
