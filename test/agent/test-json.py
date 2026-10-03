#!/usr/bin/env python3
"""Tests for dewfpga --json (templates/agent_json.py + the bin/dewfpga hunk). Standard library only.

Runs with a scratch HOME and a scratch work folder; never installs, never touches a board, never pushes.
Real toolchain tests (sim/bit/flash on blink) are skipped only when neither yosys nor iverilog is there, and say so.
Exactly one heavy build (bit). Text parity builds its own base CLI (this CLI with the --json hunk cut out), so it never skips."""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CLI = os.path.join(ROOT, "bin", "dewfpga")
WRAPPER = os.path.join(ROOT, "templates", "agent_json.py")
FIX = os.path.join(HERE, "fixtures")
REAL_FPGA_HOME = os.environ.get("FPGA_HOME") or os.path.join(os.path.expanduser("~"), "fpga")
HAVE_TOOLS = os.path.exists(os.path.join(REAL_FPGA_HOME, "bin", "yosys")) or shutil.which("iverilog") is not None
SCRATCH_HOME = tempfile.mkdtemp(prefix="dewfpga-json-home-")
ENV = dict(os.environ, HOME=SCRATCH_HOME, LC_ALL="C", LC_CTYPE="C", LANG="C", PYTHONDONTWRITEBYTECODE="1",
           FPGA_HOME=REAL_FPGA_HOME)
ENV.pop("DEWFPGA_JSON_TIMEOUT", None)


def run(args, cwd, env=None, timeout=900, cli=CLI):
    p = subprocess.run([cli] + args, cwd=cwd, env=env or ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def one_json(out):
    """stdout must be exactly one JSON object and nothing else."""
    text = out.decode("utf-8")
    objs = [ln for ln in text.split("\n") if ln.strip()]
    assert len(objs) == 1, "expected one line on stdout, got %d: %r" % (len(objs), text[:400])
    d = json.loads(objs[0])
    assert d["schema"] == "dewfpga/result@1", d
    return d


REVIEW = os.path.join(FIX, "fake-review-cli")


def base_cli(into):
    """bin/dewfpga without the --json hunk, next to the same templates: the CLI as it was before --json"""
    with open(CLI) as f:
        lines = f.read().split("\n")
    start = [i for i, ln in enumerate(lines) if ln.startswith("# --json (any position)")]
    assert len(start) == 1, "the --json hunk marker is missing from bin/dewfpga"
    end = [i for i in range(start[0], len(lines)) if lines[i].strip().endswith("; fi")][0]
    base = lines[:start[0]] + lines[end + 1:]
    assert not any("--json" in ln for ln in base), "bin/dewfpga mentions json outside its hunk"
    os.makedirs(os.path.join(into, "bin"))
    os.symlink(os.path.join(ROOT, "templates"), os.path.join(into, "templates"))
    path = os.path.join(into, "bin", "dewfpga")
    with open(path, "w") as f:
        f.write("\n".join(base))
    os.chmod(path, 0o755)
    return path


def wrapper(fake_cli, args, cwd, extra_env=None, timeout=60):
    env = dict(ENV, **(extra_env or {}))
    p = subprocess.run([sys.executable, WRAPPER, "--cli", fake_cli, "--"] + args, cwd=cwd, env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


class Scratch(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dewfpga-json-work-")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def blink(self):
        for n in ("blink.sv", "blink_tb.sv", "blink.xdc"):
            shutil.copy(os.path.join(ROOT, "templates", n), self.d)


class ArtifactScope(Scratch):
    def test_similar_name_is_not_attributed_to_top(self):
        root = os.path.join(self.d, "project")
        nested = os.path.join(root, "p.srcs", "sources_1", "new")
        os.makedirs(nested)
        open(os.path.join(root, "p.xpr"), "w").close()
        for name in ("blink.bit", "blink_old.bit", "blink.backup.bit"):
            with open(os.path.join(root, name), "wb") as f:
                f.write(b"unchanged")
        rc, out, _ = wrapper(REVIEW, ["bit"], nested, {"FAKE_MODE": "vivado", "FAKE_ROOT": root, "FAKE_RC": "0"})
        self.assertEqual(rc, 0)
        self.assertEqual([(os.path.basename(a["path"]), a["state"]) for a in one_json(out)["artifacts"]], [("blink.bit", "cached")])

    def test_root_walk_matches_xprless_and_flat_boundaries(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("agent_json_root_test", WRAPPER)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        project = os.path.join(self.d, "project")
        nested = os.path.join(project, "p.srcs", "sources_1", "new")
        os.makedirs(nested)
        self.assertEqual(mod.project_dirs(nested), [os.path.realpath(project)])
        flat = os.path.join(project, "unrelated")
        os.mkdir(flat)
        open(os.path.join(project, "p.xpr"), "w").close()
        self.assertEqual(mod.project_dirs(flat), [])


class Usage(Scratch):
    def test_unknown_argument_is_json_exit_2(self):
        for argv in (["sim", "--json", "--bogus"], ["--json", "sim", "--bogus"], ["sim", "--bogus", "--json"]):
            rc, out, err = run(argv, self.d)
            d = one_json(out)
            self.assertEqual((rc, d["exit_code"], d["code"], d["ok"]), (2, 2, "unknown-option", False), argv)
            self.assertEqual(err, b"", "stderr must stay empty in JSON mode")

    def test_unknown_command(self):
        rc, out, err = run(["frobnicate", "--json"], self.d)
        d = one_json(out)
        self.assertEqual((rc, d["code"], d["cause"]), (2, "unknown-command", "usage"))
        self.assertEqual(err, b"")

    def test_json_alone_and_json_on_other_commands(self):
        for argv in (["--json"], ["clean", "--json"], ["install", "--json"], ["new", "x", "--json"]):
            rc, out, err = run(argv, self.d)
            d = one_json(out)
            self.assertEqual((rc, d["exit_code"]), (2, 2), argv)
            self.assertIn(d["code"], ("unknown-option", "unknown-command"))
            self.assertEqual(err, b"")

    def test_bad_timeout(self):
        for t in ("0", "-5", "abc", "3601", ""):
            rc, out, _ = run(["sim", "--json", "--timeout=" + t], self.d)
            d = one_json(out)
            self.assertEqual((rc, d["code"]), (2, "unknown-option"), t)
        rc, out, _ = wrapper(os.path.join(FIX, "fake-unicode-cli"), ["sim"], self.d, {"DEWFPGA_JSON_TIMEOUT": "nope"})
        self.assertEqual((rc, one_json(out)["code"]), (2, "unknown-option"))

    def test_wrapper_started_by_hand_is_internal(self):
        p = subprocess.run([sys.executable, WRAPPER, "sim"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
        self.assertEqual((p.returncode, one_json(p.stdout)["code"]), (70, "internal"))


class FakeCli(Scratch):
    def test_noisy_huge_output_no_deadlock_bounded_log(self):
        t0 = time.monotonic()
        rc, out, err = wrapper(os.path.join(FIX, "fake-noisy-cli"), ["bit"], self.d, timeout=120)
        d = one_json(out)
        self.assertEqual((rc, d["exit_code"], d["code"], d["cause"]), (1, 1, "undefined-name", "diagnostic"))
        self.assertEqual(d["child_exit"], 1)
        self.assertTrue(d["log"]["truncated"], "40 MB of noise must not be kept whole")
        self.assertLessEqual(len(d["log"]["tail"]), 60)
        self.assertLess(os.path.getsize(d["log"]["path"]), 9 * 1024 * 1024)
        self.assertLess(len(out), 64 * 1024, "the JSON object itself stays small")
        self.assertEqual(d["diagnostics"][0]["file"], "a.sv")
        self.assertEqual(d["diagnostics"][0]["line"], 3)
        self.assertEqual(d["diagnostics"][0]["fix"], "declare it.")
        self.assertLess(time.monotonic() - t0, 90)
        os.unlink(d["log"]["path"])

    def test_invalid_utf8_and_emoji(self):
        rc, out, _ = wrapper(os.path.join(FIX, "fake-unicode-cli"), ["check"], self.d)
        d = one_json(out)
        self.assertEqual((rc, d["ok"], d["exit_code"]), (0, True, 0))
        self.assertEqual(d["diagnostics"][0]["code"], "latch-inferred")
        self.assertEqual(d["diagnostics"][0]["severity"], "warning")
        self.assertIn("\U0001F600", d["diagnostics"][0]["message"])
        self.assertIn("�", d["top"])
        os.unlink(d["log"]["path"])

    def test_timeout_kills_grandchild(self):
        pidfile = os.path.join(self.d, "grandchild.pid")
        t0 = time.monotonic()
        rc, out, _ = wrapper(os.path.join(FIX, "fake-slow-cli"), ["bit"], self.d,
                             {"DEWFPGA_JSON_TIMEOUT": "1", "FAKE_PID_FILE": pidfile}, timeout=60)
        d = one_json(out)
        self.assertEqual((rc, d["exit_code"], d["code"], d["cause"]), (124, 124, "command-timeout", "timeout"))
        self.assertLess(time.monotonic() - t0, 20)
        with open(pidfile) as f:
            pid = int(f.read())
        time.sleep(0.3)
        try:
            os.kill(pid, 0)
            alive = True
        except ProcessLookupError:
            alive = False
        if alive:
            os.kill(pid, signal.SIGKILL)
        self.assertFalse(alive, "sleep grandchild %d survived the timeout" % pid)
        os.unlink(d["log"]["path"])

    def test_parent_signals_stop_the_cli_session(self):
        for sig in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=sig):
                pidfile = os.path.join(self.d, "signal-%s.pid" % sig)
                env = dict(ENV, FAKE_PID_FILE=pidfile)
                p = subprocess.Popen([sys.executable, WRAPPER, "--cli", os.path.join(FIX, "fake-slow-cli"), "--", "bit"],
                                     cwd=self.d, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                child = None
                try:
                    deadline = time.monotonic() + 10
                    while not os.path.exists(pidfile) and p.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertTrue(os.path.exists(pidfile), "CLI did not start")
                    with open(pidfile) as f:
                        child = int(f.read())
                    p.send_signal(sig)
                    out, err = p.communicate(timeout=15)
                    d = one_json(out)
                    self.assertEqual((p.returncode, d["exit_code"], d["ok"], err), (128 + sig, 128 + sig, False, b""))
                    with self.assertRaises(ProcessLookupError):
                        os.kill(child, 0)
                finally:
                    if p.poll() is None:
                        p.kill()
                        p.communicate()
                    if child:
                        try:
                            os.kill(child, signal.SIGKILL)
                        except ProcessLookupError:
                            pass

    def test_failed_child_without_message_is_exit_1_not_success(self):
        rc, out, _ = wrapper(os.path.join(FIX, "fake-silent-fail-cli"), ["bit"], self.d)
        d = one_json(out)
        self.assertEqual((rc, d["ok"], d["code"], d["cause"], d["child_exit"]), (1, False, None, "child-exit", 2))
        self.assertIn("make: *** [bit] Error 2", d["log"]["tail"])
        os.unlink(d["log"]["path"])

    def test_stale_bit_is_not_reported_as_success(self):
        with open(os.path.join(self.d, "old.bit"), "wb") as f:
            f.write(b"\x00" * 100)
        rc, out, _ = wrapper(os.path.join(FIX, "fake-silent-fail-cli"), ["bit"], self.d)
        d = one_json(out)
        self.assertEqual(rc, 1)
        # no output names a top, so old.bit is not proven to be this design's: left out, never "cached"
        self.assertEqual((d["top"], d["artifacts"]), (None, []))
        os.unlink(d["log"]["path"])


class MissingTools(Scratch):
    def test_missing_toolchain_exit_3(self):
        self.blink()
        empty = tempfile.mkdtemp(prefix="dewfpga-json-nofpga-")
        env = dict(ENV, FPGA_HOME=empty, PATH="/usr/bin:/bin")
        try:
            for cmd in ("check", "bit", "flash"):
                rc, out, err = run([cmd, "--json"], self.d, env)
                d = one_json(out)
                self.assertEqual((rc, d["exit_code"], d["code"]), (3, 3, "toolchain-not-installed"), cmd)
                self.assertEqual(err, b"")
                self.assertEqual(d["artifacts"], [])
                os.unlink(d["log"]["path"])
            # the Makefile reports iverilog-refused; --json sees that iverilog is not on PATH and says so (exit 3)
            rc, out, err = run(["sim", "--json"], self.d, env)
            d = one_json(out)
            self.assertEqual((rc, d["ok"], d["code"], d["cause"]), (3, False, "toolchain-not-installed", "diagnostic"))
            self.assertIn("iverilog-refused", [x["code"] for x in d["diagnostics"]])
            self.assertEqual(err, b"")
            os.unlink(d["log"]["path"])
        finally:
            shutil.rmtree(empty, ignore_errors=True)


@unittest.skipUnless(HAVE_TOOLS, "no yosys in FPGA_HOME/bin and no iverilog on PATH: the real sim/bit cannot run")
class RealToolchain(Scratch):
    def test_sim_any_json_position(self):
        self.blink()
        for argv in (["--json", "sim"], ["sim", "--json"], ["sim", "blink", "--json"], ["sim", "--json", "blink"]):
            rc, out, err = run(argv, self.d, timeout=180)
            d = one_json(out)
            self.assertEqual((rc, d["ok"], d["exit_code"], d["code"]), (0, True, 0, None), argv)
            self.assertEqual(err, b"", argv)
            self.assertEqual(d["sim"], {"testbench_errors": 0})
            self.assertEqual(d["top"], "blink")
            self.assertEqual(d["testbench"], "blink_tb")
            self.assertIn(("vcd", "new" if argv == ["--json", "sim"] else d["artifacts"][0]["state"]),
                          [(a["kind"], a["state"]) for a in d["artifacts"]])
            os.unlink(d["log"]["path"])

    def test_sim_syntax_error_exit_1(self):
        shutil.copy(os.path.join(FIX, "syntax.sv"), self.d)
        shutil.copy(os.path.join(FIX, "syntax_tb.sv"), self.d)
        rc, out, err = run(["sim", "--json"], self.d, timeout=180)
        d = one_json(out)
        self.assertEqual((rc, d["ok"], d["exit_code"], d["cause"]), (1, False, 1, "diagnostic"))
        self.assertEqual(d["code"], d["diagnostics"][0]["code"])
        self.assertTrue(d["code"], d)
        self.assertEqual(err, b"")
        os.unlink(d["log"]["path"])

    def test_bit_then_cached_then_fake_flashers(self):
        """the one heavy build: bit on blink, then rerun (cached), then flash with two fake openFPGALoaders"""
        self.blink()
        rc, out, _ = run(["bit", "--json"], self.d, timeout=900)
        d = one_json(out)
        self.assertEqual((rc, d["ok"], d["exit_code"]), (0, True, 0), d["log"]["tail"][-5:])
        bits = [a for a in d["artifacts"] if a["kind"] == "bit"]
        self.assertEqual(len(bits), 1)
        self.assertEqual(bits[0]["state"], "new")
        self.assertTrue(bits[0]["path"].endswith("/blink.bit"))
        self.assertGreater(bits[0]["bytes"], 100000)
        self.assertEqual(d["top"], "blink")
        os.unlink(d["log"]["path"])
        rc, out, _ = run(["bit", "--json"], self.d, timeout=900)
        d = one_json(out)
        self.assertEqual(rc, 0)
        self.assertEqual([a["state"] for a in d["artifacts"] if a["kind"] == "bit"], ["cached"])
        self.assertEqual(d["top"], "blink")   # from "blink.bit is up to date", not guessed from the folder
        os.unlink(d["log"]["path"])
        for fixture, code in (("flasher-noboard", "board-not-found"), ("flasher-other", "openfpgaloader-failed")):
            env = dict(ENV, PATH=os.path.join(FIX, fixture) + os.pathsep + ENV["PATH"])
            rc, out, err = run(["flash", "--json"], self.d, env, timeout=120)
            d = one_json(out)
            self.assertEqual((rc, d["exit_code"], d["code"]), (4, 4, code), fixture)
            self.assertEqual(err, b"")
            # flash names no top (the Makefile hides the openFPGALoader line), so blink.bit is not attributed to it
            self.assertEqual((d["top"], [a for a in d["artifacts"] if a["kind"] == "bit"]), (None, []))
            os.unlink(d["log"]["path"])


class TextParity(Scratch):
    """without --json the patched CLI must behave byte-for-byte like the base CLI"""

    @classmethod
    def setUpClass(cls):
        cls.base_dir = tempfile.mkdtemp(prefix="dewfpga-json-base-")
        cls.base = base_cli(cls.base_dir)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base_dir, ignore_errors=True)

    def same(self, argv, timeout=180):
        """each CLI runs in its own identical copy of the folder, so make caching cannot differ between the two"""
        da, db = self.d + "-a", self.d + "-b"
        for x in (da, db):
            shutil.rmtree(x, ignore_errors=True)
            shutil.copytree(self.d, x)
        try:
            a = run(argv, da, cli=self.base, timeout=timeout)
            b = run(argv, db, timeout=timeout)
        finally:
            shutil.rmtree(da, ignore_errors=True)
            shutil.rmtree(db, ignore_errors=True)
        self.assertEqual(a, b, argv)
        return a

    def test_usage_and_help(self):
        self.same(["--bogus"])
        self.same(["frobnicate"])
        self.same(["help"])
        self.same([])

    @unittest.skipUnless(HAVE_TOOLS, "no yosys in FPGA_HOME/bin and no iverilog on PATH: the real sim cannot run")
    def test_probes(self):
        self.blink()
        rc, out, err = self.same(["sim"])
        self.assertEqual(rc, 0)
        self.assertIn(b"PASS: 3 checks", out)
        shutil.copy(os.path.join(FIX, "syntax.sv"), self.d)
        shutil.copy(os.path.join(FIX, "syntax_tb.sv"), self.d)
        rc, out, err = self.same(["sim", "syntax"])
        self.assertNotEqual(rc, 0)
        text_code = [ln for ln in err.decode("utf-8", "replace").split("\n") if "ERROR [" in ln][0].split("ERROR [")[1].split("]")[0]
        rc2, out2, _ = run(["sim", "syntax", "--json"], self.d)
        self.assertEqual(one_json(out2)["code"], text_code)



class Review(Scratch):
    """counterexamples found in review, each reproduced on the first --json version (fixtures/fake-review-cli)"""

    def fake(self, mode, args=("check",), cwd=None, env=None, **kw):
        rc, out, err = wrapper(REVIEW, list(args), cwd or self.d, dict({"FAKE_MODE": mode}, **(env or {})), **kw)
        d = one_json(out)
        self.assertEqual(err, b"")
        if d.get("log") and d["log"]["path"]:
            os.unlink(d["log"]["path"])
        return rc, d

    def test_absolute_path_with_space_is_parsed(self):
        sp = os.path.join(self.d, "my lab")
        os.mkdir(sp)
        rc, d = self.fake("space", cwd=sp)
        self.assertEqual((rc, d["code"], d["cause"]), (1, "undefined-name", "diagnostic"))
        f = d["diagnostics"][0]["file"]
        self.assertEqual((os.path.realpath(f), d["diagnostics"][0]["line"]), (os.path.realpath(os.path.join(sp, "a.sv")), 3))

    def test_multiple_source_locations_keep_the_diagnostic(self):
        sp = os.path.join(self.d, "my lab")
        os.mkdir(sp)
        rc, d = self.fake("multi-location", cwd=sp)
        self.assertEqual((rc, d["code"], d["cause"]), (1, "two-always-drivers", "diagnostic"))
        item = d["diagnostics"][0]
        self.assertEqual((item["file"], item["line"], item["fix"]),
                         (os.path.join(os.path.realpath(sp), "a.sv"), 5, "use one block."))

    def test_nested_vivado_root_artifact_is_not_new(self):
        root = os.path.realpath(self.d)
        nested = os.path.join(root, "p.srcs", "sources_1", "new")
        os.makedirs(nested)
        open(os.path.join(root, "p.xpr"), "w").close()
        with open(os.path.join(root, "blink.bit"), "wb") as f:
            f.write(b"\x01" * 64)
        with open(os.path.join(root, "other.bit"), "wb") as f:
            f.write(b"\x02" * 64)
        for rc_in, state in (("1", "stale"), ("0", "cached")):
            # the CLI reports the root through /tmp while getcwd says /private/tmp on macOS: one folder, one entry
            rc, d = self.fake("vivado", cwd=nested, env={"FAKE_ROOT": self.d, "FAKE_RC": rc_in})
            self.assertEqual((rc, d["top"]), (int(rc_in), "blink"))
            self.assertEqual([(os.path.basename(a["path"]), a["state"]) for a in d["artifacts"]], [("blink.bit", state)])

    def test_vivado_folder_not_hashed_before_is_not_new(self):
        far = tempfile.mkdtemp(prefix="dewfpga-json-far-")
        try:
            with open(os.path.join(far, "blink.bit"), "wb") as f:
                f.write(b"\x01" * 64)
            rc, d = self.fake("vivado", env={"FAKE_ROOT": far, "FAKE_RC": "0"})
            self.assertEqual([(os.path.basename(a["path"]), a["state"]) for a in d["artifacts"]], [("blink.bit", None)])
        finally:
            shutil.rmtree(far, ignore_errors=True)

    def test_unrelated_files_are_not_listed_or_used_as_top(self):
        for n in ("other.bit", "notes.log"):
            with open(os.path.join(self.d, n), "wb") as f:
                f.write(b"x")
        rc, d = self.fake("quiet-ok", args=("bit",))
        self.assertEqual((rc, d["ok"], d["top"], d["artifacts"]), (0, True, None, []))

    def test_tail_is_8192_bytes_in_total(self):
        rc, d = self.fake("tail")
        self.assertLessEqual(sum(len(t.encode()) for t in d["log"]["tail"]), 8192)
        self.assertTrue(d["log"]["tail"])

    def test_warning_flood_does_not_hide_the_error(self):
        rc, d = self.fake("warnflood", args=("flash",))
        self.assertEqual((rc, d["code"], d["cause"], d["diagnostics_truncated"]), (4, "board-not-found", "diagnostic", True))
        self.assertEqual(sum(x["severity"] == "warning" for x in d["diagnostics"]), 50)

    def test_descendant_holding_the_pipes_is_internal_and_stopped(self):
        pid_file = os.path.join(self.d, "pid")
        t = time.time()
        rc, d = self.fake("orphan", env={"FAKE_PID_FILE": pid_file})
        self.assertLess(time.time() - t, 8)
        self.assertEqual((rc, d["ok"], d["code"], d["child_exit"]), (70, False, "internal", 0))
        with open(pid_file) as f:
            pid = int(f.read())
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_log_write_failure_keeps_the_diagnostics(self):
        def limit():
            import resource
            signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
            resource.setrlimit(resource.RLIMIT_FSIZE, (2048, 2048))
        p = subprocess.run([sys.executable, WRAPPER, "--cli", REVIEW, "--", "check"], cwd=self.d,
                           env=dict(ENV, FAKE_MODE="logfail"), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=60, preexec_fn=limit)
        d = one_json(p.stdout)
        os.unlink(d["log"]["path"])
        self.assertEqual((p.returncode, d["log"]["truncated"]), (0, True))
        self.assertEqual([x["code"] for x in d["diagnostics"]], ["latch-inferred"])

    def test_huge_line_number_is_not_a_crash(self):
        rc, d = self.fake("readerdies")
        self.assertEqual((rc, [x["code"] for x in d["diagnostics"]]), (0, ["latch-inferred"]))

    def test_reader_failure_is_never_ok(self):
        code = ("import sys, runpy; sys.argv[0] = %r; g = runpy.run_path(%r, run_name='w'); S = g['Sink']; old = S.line\n"
                "def line(self, raw):\n    if b'latch' in raw: raise RuntimeError('boom')\n    return old(self, raw)\n"
                "S.line = line; sys.exit(g['main'](sys.argv[1:]))" % (WRAPPER, WRAPPER))
        p = subprocess.run([sys.executable, "-c", code, "--cli", REVIEW, "--", "check"], cwd=self.d,
                           env=dict(ENV, FAKE_MODE="logfail"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        d = one_json(p.stdout)
        os.unlink(d["log"]["path"])
        self.assertEqual((p.returncode, d["ok"], d["code"], d["child_exit"]), (70, False, "internal", 0))
        self.assertIn("RuntimeError: boom", d["diagnostics"][0]["message"])


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        shutil.rmtree(SCRATCH_HOME, ignore_errors=True)
