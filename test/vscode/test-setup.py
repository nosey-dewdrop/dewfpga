#!/usr/bin/env python3
"""Tests for templates/vscode_setup.py and its wiring (bin/dewfpga vscode, uninstall, install.sh, package.json).

    LC_ALL=C PYTHONDONTWRITEBYTECODE=1 python3 test/vscode/test-setup.py        -> last line: passed N, failed 0

Nothing here touches the real editor, HOME, FPGA_HOME or Homebrew: every run gets a scratch HOME (with a space
in its name), a scratch FPGA_HOME, a fake `code` command that records its argv and keeps an "installed
extensions" file, and TMPDIR under the scratch so the private VSIX folder can be checked for leftovers.
The fake `code` opens the VSIX it is given and reads extension/package.json, so a run proves a real, well-formed
VSIX was built and handed over, not that some string was printed.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PY = sys.executable
EXT_ID = "nosey-dewdrop.dewfpga"
DEP_ID = "mshr-h.veriloghdl"

passed = 0
failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  PASS %s" % name)
    else:
        failed += 1
        print("  FAIL %s" % name)
        if detail:
            for line in str(detail).splitlines()[:30]:
                print("       " + line)


FAKE_CODE = r'''#!%s
# fake `code`: records argv, keeps installed extension ids in $FAKE_CODE_STORE (one per line), fails on demand
import json, os, sys, zipfile
store = os.environ["FAKE_CODE_STORE"]
# another command name (codium, code-insiders) is another editor with its own store; a profile has its own store too
if os.path.basename(sys.argv[0]) != "code":
    store += "." + os.path.basename(sys.argv[0])
fail = set(os.environ.get("FAKE_CODE_FAIL", "").split(","))
with open(os.environ["FAKE_CODE_LOG"], "a") as f:
    f.write(json.dumps(sys.argv) + "\n")
def load():
    try:
        return [l.strip() for l in open(store) if l.strip()]
    except FileNotFoundError:
        return []
def save(ids):
    with open(store, "w") as f:
        f.write("".join(i + "\n" for i in ids))
a = sys.argv[1:]
if a[:1] == ["--profile"] and len(a) >= 3:
    store += "@" + a[1]
    a = a[2:]
if a == ["--list-extensions"]:
    if "list" in fail:
        sys.stderr.write("fake code: list failed on purpose\n"); sys.exit(3)
    sys.stdout.write("".join(i + "\n" for i in load())); sys.exit(0)
if a[:1] == ["--install-extension"] and len(a) in (2, 3) and (len(a) == 2 or a[2] == "--force"):
    what = a[1]
    if what.endswith(".vsix"):
        if not os.path.isfile(what):
            sys.stderr.write("fake code: %%s is not a file\n" %% what); sys.exit(4)
        with zipfile.ZipFile(what) as z:
            pkg = json.loads(z.read("extension/package.json").decode("utf-8"))
            names = set(z.namelist())
        for need in ("extension.vsixmanifest", "extension/extension.js", "extension/bin/iverilog", "extension/LICENSE"):
            if need not in names:
                sys.stderr.write("fake code: VSIX lacks %%s\n" %% need); sys.exit(4)
        ext = "%%s.%%s" %% (pkg["publisher"], pkg["name"])
        if "install" in fail:
            sys.stderr.write("fake code: install failed on purpose\n"); sys.exit(5)
        if "install-silent" in fail:
            print("fake code: pretending"); sys.exit(0)
    else:
        ext = what
        if "install-dep" in fail:
            sys.stderr.write("fake code: no marketplace\n"); sys.exit(6)
    ids = load()
    if ext not in ids:
        ids.append(ext)
    save(ids)
    print("Extension '%%s' was successfully installed." %% ext); sys.exit(0)
if a[:1] == ["--uninstall-extension"] and len(a) == 2:
    if "uninstall" in fail:
        sys.stderr.write("fake code: uninstall failed on purpose\n"); sys.exit(7)
    ids = [i for i in load() if i != a[1]]
    save(ids)
    print("Extension '%%s' was successfully uninstalled!" %% a[1]); sys.exit(0)
sys.stderr.write("fake code: unexpected arguments %%r\n" %% a); sys.exit(9)
''' % PY


class Scratch:
    """one scratch world: HOME with a space, a code command, a store, an argv log"""

    def __init__(self, base, name, with_code=True, store_ids=()):
        self.dir = os.path.join(base, name)
        self.home = os.path.join(self.dir, "my home")
        self.user = os.path.join(self.home, "Library", "Application Support", "Code", "User")
        self.fpga_home = os.path.join(self.dir, "fpga")
        self.apps = os.path.join(self.dir, "apps")
        self.tmp = os.path.join(self.dir, "tmp")
        self.bin = os.path.join(self.dir, "fake bin")
        for d in (self.user, self.fpga_home, self.apps, self.tmp, self.bin):
            os.makedirs(d)
        self.store = os.path.join(self.dir, "installed.txt")
        with open(self.store, "w") as f:
            f.write("".join(i + "\n" for i in store_ids))
        self.code_log = os.path.join(self.dir, "code.log")
        self.argv_log = os.path.join(self.dir, "argv.log")
        self.code = os.path.join(self.bin, "code")
        if with_code:
            with open(self.code, "w") as f:
                f.write(FAKE_CODE)
            os.chmod(self.code, 0o755)

    def env(self, fail="", code_on_path=True, extra=None):
        path = [os.path.dirname(PY), "/usr/bin", "/bin"]
        if code_on_path and os.path.exists(self.code):
            path.insert(0, self.bin)
        e = {"PATH": ":".join(path), "HOME": self.home, "FPGA_HOME": self.fpga_home, "TMPDIR": self.tmp,
             "DEWFPGA_VSCODE_APP_DIRS": self.apps,   # never /Applications: the real editor must not be found by any test
             "LC_ALL": "C", "LANG": "C", "LC_CTYPE": "C", "PYTHONDONTWRITEBYTECODE": "1",
             "DEWFPGA_SKIP_VSCODE": "0",            # explicit: the hooks run here (test/run.sh exports 1 for the real install test)
             "FAKE_CODE_STORE": self.store, "FAKE_CODE_LOG": self.code_log, "FAKE_CODE_FAIL": fail}
        if extra:
            e.update(extra)
        return e

    def installed(self):
        return [l.strip() for l in open(self.store) if l.strip()]

    def code_calls(self):
        return read_log(self.code_log)

    def argv_calls(self):
        return read_log(self.argv_log)

    def clear_logs(self):
        for p in (self.code_log, self.argv_log):
            if os.path.exists(p):
                os.unlink(p)

    @property
    def tasks(self):
        return os.path.join(self.user, "tasks.json")

    @property
    def state(self):
        return os.path.join(self.fpga_home, "vscode-setup.json")

    def leftovers(self):
        return [n for n in os.listdir(self.tmp) if n.startswith("dewfpga-vsix.")]


def read_log(p):
    try:
        return [json.loads(l) for l in open(p) if l.strip()]
    except FileNotFoundError:
        return []


def read(p):
    with open(p, "rb") as f:
        return f.read()


def setup_argv(here, s, *args, user_dir=True, app_dir=True):
    argv = [PY, os.path.join(here, "templates", "vscode_setup.py"), "--here", here, "--fpga-home", s.fpga_home,
            "--home", s.home, "--argv-log", s.argv_log]
    if user_dir:
        argv += ["--user-dir", s.user]
    if app_dir:
        argv += ["--app-dir", s.apps]
    return argv + list(args)


def run(argv, env, cwd=None):
    p = subprocess.run(argv, env=env, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def copy_tree(dst):
    """the files a dewfpga folder needs for `dewfpga vscode`: what package.json ships, nothing from .git or out/"""
    os.makedirs(dst)
    for item in ("bin", "templates", "vscode", "install.sh", "package.json", "LICENSE", "README.md"):
        src = os.path.join(ROOT, item)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(dst, item), ignore=shutil.ignore_patterns("out", "__pycache__", ".git"))
        else:
            shutil.copy2(src, os.path.join(dst, item))
    return dst


def name_profiles(user, names, flags=None):
    """what VS Code records about its profiles: User/globalStorage/storage.json, key userDataProfiles (name + location)"""
    gs = os.path.join(user, "globalStorage")
    os.makedirs(gs, exist_ok=True)
    entries = []
    for folder, name in names.items():
        e = {"location": folder, "name": name}
        if flags and folder in flags:
            e["useDefaultFlags"] = flags[folder]
        entries.append(e)
    with open(os.path.join(gs, "storage.json"), "w") as f:
        json.dump({"telemetry.machineId": "x", "userDataProfiles": entries}, f)


def our_tasks(tasks_file):
    d = json.loads(read(tasks_file).decode("utf-8"))
    return [t for t in d.get("tasks", []) if t.get("detail") == "added by dewfpga vscode"]


def main():
    base = tempfile.mkdtemp(prefix="dewfpga-vscode-test.")
    try:
        body(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print("passed %d, failed %d" % (passed, failed))
    return 1 if failed else 0


def body(base):
    here = copy_tree(os.path.join(base, "dew fpga"))          # a space in the dewfpga folder too
    setup_py = os.path.join(here, "templates", "vscode_setup.py")
    tasks_py = os.path.join(here, "templates", "vscode_tasks.py")
    cli = os.path.join(here, "bin", "dewfpga")
    # the reference VSIX: built straight from the sources, used to compare hashes below
    ref_dir = os.path.join(base, "ref")
    os.makedirs(ref_dir)
    rc, out, err = run([PY, os.path.join(here, "vscode", "build-vsix.py"), "--out", ref_dir], {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    ref_vsix = out.strip().splitlines()[-1] if out.strip() else ""
    check("reference VSIX builds from the copied sources with no .git, no node on PATH", rc == 0 and os.path.isfile(ref_vsix), out + err)
    ref_sha = hashlib.sha256(read(ref_vsix)).hexdigest() if ref_vsix else ""
    version = os.path.basename(ref_vsix)[len("dewfpga-"):-len(".vsix")] if ref_vsix else ""

    print("== --print is read only")
    s = Scratch(base, "print")
    rc, out, err = run(setup_argv(here, s, "--print"), s.env())
    check("--print exits 0 and says nothing was run", rc == 0 and "Nothing below was run or written." in out, out + err)
    check("--print shows both install commands and the tasks", "--install-extension '<private temp dir>/dewfpga-<version>.vsix' --force" in out
          and "--install-extension mshr-h.veriloghdl" in out and "dewfpgaTop" in out and '"dewfpga: flash (build + program)"' in out, out)
    check("--print quotes the code path with a space for display", "'%s' --install-extension" % s.code in out, out)
    check("--print called code zero times, wrote no task, no state, no log", s.code_calls() == [] and not os.path.exists(s.tasks)
          and not os.path.exists(s.state) and os.listdir(s.user) == [] and s.leftovers() == [], "%r %r" % (s.code_calls(), os.listdir(s.user)))
    s2 = Scratch(base, "print-nocode", with_code=False)
    rc, out, err = run(setup_argv(here, s2, "--print"), s2.env())
    check("--print without code still prints the tasks and says how to get `code`", rc == 0 and "no `code` command found" in out and "dewfpgaTop" in out, out + err)
    rc, out, err = run(setup_argv(here, s2, "--print", "--remove"), s2.env())
    check("--print with --remove is refused (exit 2)", rc == 2 and "exclude each other" in err, out + err)

    print("== no editor")
    s = Scratch(base, "nocode", with_code=False)
    rc, out, err = run(setup_argv(here, s), s.env())
    check("no code: exit 0 with the vscode-not-found note, nothing written", rc == 0 and out.startswith("note [vscode-not-found]:") and "dewfpga vscode --print" in out
          and not os.path.exists(s.tasks) and not os.path.exists(s.state) and s.argv_calls() == [], out + err)
    s = Scratch(base, "nocode-remove", with_code=False)
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("no code, nothing installed: --remove exits 0 and keeps whatever is there", rc == 0 and "kept: VS Code extension %s if present (no record" % EXT_ID in out, out + err)

    print("== app bundle detection")
    s = Scratch(base, "bundle", with_code=False)
    bundle = os.path.join(s.apps, "Visual Studio Code.app", "Contents", "Resources", "app", "bin")
    os.makedirs(bundle)
    with open(os.path.join(bundle, "code"), "w") as f:
        f.write(FAKE_CODE)
    os.chmod(os.path.join(bundle, "code"), 0o755)
    rc, out, err = run(setup_argv(here, s), s.env())
    calls = s.argv_calls()
    check("no code on PATH: the app bundle's code is used", rc == 0 and calls and calls[0] == [os.path.join(bundle, "code"), "--list-extensions"]
          and os.path.exists(s.tasks), out + err + repr(calls[:1]))
    s = Scratch(base, "bundle-dir-only", with_code=False)
    os.makedirs(os.path.join(s.apps, "Visual Studio Code.app", "Contents"))
    rc, out, err = run(setup_argv(here, s), s.env())
    check("an app bundle without its code command counts as no code", rc == 0 and out.startswith("note [vscode-not-found]:") and s.argv_calls() == [], out + err)

    print("== setup: exact commands, spaces in every path")
    s = Scratch(base, "setup")
    rc, out, err = run(setup_argv(here, s), s.env())
    calls = s.argv_calls()
    check("setup exits 0", rc == 0, out + err)
    tmpdir = calls[1][3] if len(calls) > 1 and len(calls[1]) == 4 else ""
    expect = [
        [s.code, "--list-extensions"],
        [PY, os.path.join(here, "vscode", "build-vsix.py"), "--out", tmpdir],
        [s.code, "--install-extension", os.path.join(tmpdir, "dewfpga-%s.vsix" % version), "--force"],
        [s.code, "--list-extensions"],
        [s.code, "--install-extension", DEP_ID],
        [PY, tasks_py, "--cli", cli, "--user-dir", s.user, "--home", s.home],
    ]
    check("the six commands, in order, as argument lists", calls == expect, json.dumps(calls, indent=1) + "\nexpected\n" + json.dumps(expect, indent=1))
    check("the VSIX folder is private (under TMPDIR, prefix dewfpga-vsix.) and gone afterwards",
          tmpdir.startswith(os.path.join(s.tmp, "dewfpga-vsix.")) and not os.path.exists(tmpdir) and s.leftovers() == [], tmpdir)
    check("the fake code saw the same calls (it was really run)", [c[1:] for c in s.code_calls()] == [c[1:] for c in calls if c[0] == s.code], repr(s.code_calls()))
    check("both extensions are installed in the store, ours from the VSIX's package.json", s.installed() == [EXT_ID, DEP_ID], repr(s.installed()))
    check("output names the install and the written tasks", "installed: VS Code extension %s %s (new)" % (EXT_ID, version) in out
          and "installed: VS Code extension %s" % DEP_ID in out and "wrote %s (new file: 3 tasks, 1 input)" % s.tasks in out, out + err)
    t = our_tasks(s.tasks) if os.path.exists(s.tasks) else []
    check("tasks.json holds 3 dewfpga tasks running the CLI path with spaces, as a process, with the top picker",
          len(t) == 3 and all(x["type"] == "process" and x["command"] == cli and x["args"][1] == "${input:dewfpgaTop}" for x in t)
          and sorted(x["args"][0] for x in t) == ["bit", "flash", "sim"], json.dumps(t, indent=1))
    st = json.load(open(s.state)) if os.path.exists(s.state) else {}
    check("the record in FPGA_HOME: ours, veriloghdl ours, code path, VSIX hash = reference build",
          st.get("installed_by_dewfpga") is True and st.get("veriloghdl_installed_by_dewfpga") is True and st.get("code") == s.code
          and st.get("vsix_sha256") == ref_sha and st.get("extension_version") == version and st.get("preexisting") is False, json.dumps(st, indent=1))
    first_tasks = read(s.tasks)
    first_state = read(s.state)

    print("== second setup is idempotent")
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s), s.env())
    calls = s.argv_calls()
    check("second setup exits 0, tasks.json byte-identical, record identical",
          rc == 0 and read(s.tasks) == first_tasks and read(s.state) == first_state, out + err)
    check("second setup reinstalls ours (updated), keeps veriloghdl without a marketplace call",
          "(updated)" in out and "kept: VS Code extension %s (already installed)" % DEP_ID in out and "unchanged %s" % s.tasks in out
          and [c for c in calls if c[1:2] == ["--install-extension"] and c[2] == DEP_ID] == [], out + "\n" + json.dumps(calls))
    check("store unchanged", s.installed() == [EXT_ID, DEP_ID], repr(s.installed()))

    print("== extension install failure leaves the tasks untouched")
    for mode, label in (("install", "install exits non-zero"), ("install-silent", "install exits 0 but the extension is not listed"), ("list", "list-extensions fails")):
        s = Scratch(base, "fail-" + mode)
        own = b'{\n  // mine\n  "version": "2.0.0",\n  "tasks": [ { "label": "mine", "type": "shell", "command": "echo hi", }, ],\n}\n'
        with open(s.tasks, "wb") as f:
            f.write(own)
        rc, out, err = run(setup_argv(here, s), s.env(fail=mode))
        calls = s.argv_calls()
        check("%s: exit 1, ERROR [vscode-extension-install-failed], no task written" % label,
              rc == 1 and err.startswith("ERROR [vscode-extension-install-failed]:") and "no task was written" in err
              and [c for c in calls if c[1:2] == [tasks_py]] == [] and read(s.tasks) == own and not os.path.exists(s.state)
              and s.leftovers() == [] and os.listdir(s.user) == ["tasks.json"], out + err + json.dumps(calls))
        if mode == "list":
            check("list-extensions failure: nothing built, nothing installed", calls == [[s.code, "--list-extensions"]] and s.installed() == [], json.dumps(calls))

    print("== veriloghdl: installed only when absent, never removed when the user installed it")
    s = Scratch(base, "dep-user", store_ids=[DEP_ID, "ms-python.python"])
    rc, out, err = run(setup_argv(here, s), s.env())
    st = json.load(open(s.state))
    check("user's veriloghdl: kept, no install call, record says not ours", rc == 0 and "kept: VS Code extension %s (already installed)" % DEP_ID in out
          and [c for c in s.argv_calls() if c[1:] == ["--install-extension", DEP_ID]] == [] and st["veriloghdl_installed_by_dewfpga"] is False, out + err)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("remove: ours goes, user's veriloghdl and the unrelated extension stay, record gone",
          rc == 0 and s.installed() == [DEP_ID, "ms-python.python"] and "removed: VS Code extension %s" % EXT_ID in out
          and "kept: VS Code extension %s (installed by you, not by dewfpga)" % DEP_ID in out and not os.path.exists(s.state)
          and [c[1:] for c in s.code_calls()] == [["--list-extensions"], ["--uninstall-extension", EXT_ID]], out + err + repr(s.installed()) + repr(s.code_calls()))
    check("remove: the tasks are gone, the writer ran first", not os.path.exists(s.tasks) or our_tasks(s.tasks) == [], os.listdir(s.user))
    check("remove: the task writer ran before any code call", s.argv_calls()[0][1:2] == [tasks_py] and s.argv_calls()[0][-1] == "--remove", json.dumps(s.argv_calls()))
    s = Scratch(base, "dep-fail")
    rc, out, err = run(setup_argv(here, s), s.env(fail="install-dep"))
    check("veriloghdl marketplace failure: note, exit 0, tasks still written, record says not ours",
          rc == 0 and "note [vscode-extension-install-failed]:" in out and os.path.exists(s.tasks) and json.load(open(s.state))["veriloghdl_installed_by_dewfpga"] is False
          and s.installed() == [EXT_ID], out + err)

    print("== a companion the user installed before dewfpga is never removed")
    s = Scratch(base, "preexisting", store_ids=[EXT_ID])
    rc, out, err = run(setup_argv(here, s), s.env())
    st = json.load(open(s.state))
    check("setup over a user-installed companion: updated, record says preexisting, note about --remove",
          rc == 0 and "(updated)" in out and st["installed_by_dewfpga"] is False and st["preexisting"] is True and "will leave it in place" in out, out + err)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("remove keeps it, deletes the record, calls code zero times",
          rc == 0 and "kept: VS Code extension %s (it was installed before" % EXT_ID in out and EXT_ID in s.installed()
          and not os.path.exists(s.state) and s.code_calls() == [] and (not os.path.exists(s.tasks) or our_tasks(s.tasks) == []), out + err)

    print("== lint shim: unset path -> removal; configured path -> retention")
    s = Scratch(base, "shim")
    rc, out, err = run(setup_argv(here, s), s.env())
    check("setup for the shim case", rc == 0 and os.path.exists(s.state), out + err)
    settings = os.path.join(s.user, "settings.json")
    shim_values = [
        os.path.join(s.home, ".vscode", "extensions", "%s-%s" % (EXT_ID, version), "bin"),
        "~/.vscode/extensions/%s-%s/bin" % (EXT_ID, version),
        "~/.vscode/extensions/Nosey-Dewdrop.dewfpga-9.9.9/bin",
    ]
    for v in shim_values:
        with open(settings, "w") as f:
            f.write('{\n  // my settings\n  "editor.fontSize": 14,\n  "verilog.linting.path": %s,\n}\n' % json.dumps(v))
        before_settings = read(settings)
        s.clear_logs()
        rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
        check("shim path %s: retained with the removeLinter command named, no uninstall, settings untouched, record kept" % v,
              rc == 0 and "note [vscode-linter-shim-retained]: kept: VS Code extension %s" % EXT_ID in out
              and '"dewfpga: stop using the dewfpga iverilog lint shim" (dewfpga.removeLinter)' in out and "dewfpga vscode --remove  again" in out
              and s.code_calls() == [] and s.installed() == [EXT_ID, DEP_ID] and read(settings) == before_settings and os.path.exists(s.state), out + err + repr(s.code_calls()))
    check("retention still removed the tasks", not os.path.exists(s.tasks) or our_tasks(s.tasks) == [], os.listdir(s.user))
    os.chmod(settings, 0)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    os.chmod(settings, 0o644)
    check("unreadable settings.json: retained (the key may point at the shim)", rc == 0 and "cannot be read" in out and s.code_calls() == [] and os.path.exists(s.state), out + err)
    with open(settings, "w") as f:
        f.write('{\n  // my settings\n  "editor.fontSize": 14,\n  "verilog.linting.path": "/opt/homebrew/bin/iverilog",\n}\n')
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("lint path elsewhere: both extensions removed (both ours), record gone, settings untouched",
          rc == 0 and s.installed() == [] and "removed: VS Code extension %s" % EXT_ID in out and "removed: VS Code extension %s" % DEP_ID in out
          and not os.path.exists(s.state) and b"/opt/homebrew/bin/iverilog" in read(settings), out + err + repr(s.installed()))
    s = Scratch(base, "shim-unset")
    rc, out, err = run(setup_argv(here, s), s.env())
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("no settings.json at all: removal", rc == 0 and s.installed() == [] and not os.path.exists(s.state), out + err)
    s = Scratch(base, "remove-nocode")
    rc, out, err = run(setup_argv(here, s), s.env())
    os.unlink(s.code)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("code gone at removal: tasks removed, note vscode-not-found, exit 0, record kept",
          rc == 0 and "note [vscode-not-found]: the `code` command is gone" in out and os.path.exists(s.state)
          and (not os.path.exists(s.tasks) or our_tasks(s.tasks) == []), out + err)
    s = Scratch(base, "remove-uninstall-fails")
    rc, out, err = run(setup_argv(here, s), s.env())
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env(fail="uninstall"))
    check("code --uninstall-extension fails: exit 1, ERROR line, record kept for a retry", rc == 1 and "ERROR [vscode-extension-install-failed]" in err
          and "--uninstall-extension %s failed" % EXT_ID in err and os.path.exists(s.state), out + err)

    print("== discovery through --home (no --user-dir): User and profiles")
    s = Scratch(base, "discover")
    prof = os.path.join(s.user, "profiles", "-1a2b3c")
    os.makedirs(prof)
    name_profiles(s.user, {"-1a2b3c": "Lab"})
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    check("tasks land in User and in the named profile (both named to the writer by --user-dir, never its own discovery)",
          rc == 0 and len(our_tasks(s.tasks)) == 3 and len(our_tasks(os.path.join(prof, "tasks.json"))) == 3
          and [c for c in s.argv_calls() if c[1] == tasks_py and "--user-dir" not in c] == [], out + err + json.dumps(s.argv_calls()))
    with open(os.path.join(prof, "settings.json"), "w") as f:
        f.write('{"verilog.linting.path": "~/.vscode/extensions/%s-%s/bin"}' % (EXT_ID, version))
    rc, out, err = run(setup_argv(here, s, "--remove", user_dir=False), s.env())
    check("a profile's settings pointing at the shim also retains the extension", rc == 0 and "note [vscode-linter-shim-retained]" in out and EXT_ID in s.installed(), out + err)

    print("== the setup record: a symlink there is never followed or replaced")
    s = Scratch(base, "state-symlink")
    victim = os.path.join(s.dir, "victim.json")
    with open(victim, "wb") as f:
        f.write(b'{"mine": true}\n')
    os.symlink(victim, s.state)
    rc, out, err = run(setup_argv(here, s), s.env())
    check("setup over a symlinked record: exit 1, ERROR, victim byte-identical, link kept, no code call, no task",
          rc == 1 and "ERROR [vscode-extension-install-failed]" in err and "is a symlink" in err and read(victim) == b'{"mine": true}\n'
          and os.path.islink(s.state) and s.code_calls() == [] and not os.path.exists(s.tasks), out + err)
    s = Scratch(base, "state-symlink-remove")
    rc, out, err = run(setup_argv(here, s), s.env())
    os.unlink(s.state)
    os.symlink(victim, s.state)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("remove with a symlinked record: tasks removed, extension retained with the reason, link and victim untouched, no code call",
          rc == 0 and "note [vscode-linter-shim-retained]" in out and "is a symlink" in out and os.path.islink(s.state) and read(victim) == b'{"mine": true}\n'
          and s.code_calls() == [] and s.installed() == [EXT_ID, DEP_ID] and (not os.path.exists(s.tasks) or our_tasks(s.tasks) == []), out + err)
    s = Scratch(base, "state-tmp-symlink")
    victim2 = os.path.join(s.dir, "victim2.json")
    with open(victim2, "wb") as f:
        f.write(b'{"theirs": 1}\n')
    os.symlink(victim2, s.state + ".tmp")
    rc, out, err = run(setup_argv(here, s), s.env())
    check("a foreign vscode-setup.json.tmp symlink: setup writes through its own private temp file; the symlink's target is untouched, no temp left",
          rc == 0 and read(victim2) == b'{"theirs": 1}\n' and os.path.islink(s.state + ".tmp") and os.path.isfile(s.state) and not os.path.islink(s.state)
          and [n for n in os.listdir(s.fpga_home) if n.startswith(".vscode-setup.")] == [] and json.load(open(s.state))["version"] == 2, out + err)
    s = Scratch(base, "state-schema", store_ids=[EXT_ID])
    with open(s.state, "w") as f:
        f.write('{"version": 1, "installed_by_dewfpga": true, "extension": "%s"}\n' % EXT_ID)
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("a record that is not dewfpga's schema counts as no record: extension kept, no code call, file left",
          rc == 0 and "no record that dewfpga installed it" in out and s.installed() == [EXT_ID] and s.code_calls() == [] and os.path.exists(s.state), out + err)

    print("== removal is bound to the editor the record names, not to whatever `code` PATH finds now")
    s = Scratch(base, "editor-bound")
    rc, out, err = run(setup_argv(here, s), s.env())
    check("setup through Code", rc == 0 and json.load(open(s.state))["editor"] == "Code", out + err)
    os.unlink(s.code)
    codium = os.path.join(s.bin, "codium")
    with open(codium, "w") as f:
        f.write(FAKE_CODE)
    os.chmod(codium, 0o755)
    with open(s.store + ".codium", "w") as f:        # the user's own VSCodium has the same extensions
        f.write(EXT_ID + "\n" + DEP_ID + "\n")
    e = s.env()
    e["PATH"] = s.bin + ":" + e["PATH"]
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), e)
    check("code gone, codium on PATH: the extension is NOT uninstalled through codium; note names Code, record kept, codium untouched",
          rc == 0 and "note [vscode-not-found]" in out and "Code installed the extension" in out and s.code_calls() == [] and os.path.exists(s.state)
          and [l.strip() for l in open(s.store + ".codium")] == [EXT_ID, DEP_ID], out + err + json.dumps(s.code_calls()))
    with open(s.code, "w") as f:
        f.write(FAKE_CODE)
    os.chmod(s.code, 0o755)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove", "--code", codium), e)
    check("the found command is codium but the record says Code: removal goes through the recorded Code command, codium untouched",
          rc == 0 and s.code_calls() and all(c[0] == s.code for c in s.code_calls()) and s.installed() == [] and not os.path.exists(s.state)
          and [l.strip() for l in open(s.store + ".codium")] == [EXT_ID, DEP_ID], out + err + json.dumps(s.code_calls()))
    s = Scratch(base, "editor-unknown")
    odd = os.path.join(s.bin, "code-oss")
    shutil.copy2(s.code, odd)
    rc, out, err = run(setup_argv(here, s, "--code", odd), s.env())
    check("a command that is none of the three editors: note, exit 0, nothing installed, no task",
          rc == 0 and "note [vscode-not-found]" in out and "is not a command of Visual Studio Code" in out and s.code_calls() == [] and not os.path.exists(s.tasks), out + err)

    print("== profiles: extension and tasks go to this editor's User folder and the profiles VS Code has a name for, nowhere else")
    s = Scratch(base, "profiles")
    named = os.path.join(s.user, "profiles", "-named")
    anon = os.path.join(s.user, "profiles", "-anon")
    insiders = os.path.join(s.home, "Library", "Application Support", "Code - Insiders", "User")
    for d in (named, anon, insiders):
        os.makedirs(d)
    name_profiles(s.user, {"-named": "FPGA"})
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    calls = [c[1:] for c in s.code_calls()]
    check("setup: tasks in User and in profile FPGA; the unnamed folder is skipped with its reason; Code - Insiders untouched",
          rc == 0 and len(our_tasks(s.tasks)) == 3 and len(our_tasks(os.path.join(named, "tasks.json"))) == 3
          and not os.path.exists(os.path.join(anon, "tasks.json")) and os.listdir(insiders) == []
          and "note: profile folder %s has no name" % anon in out and "dewfpga vscode --print" in out, out + err)
    check("the extension is installed and verified with --profile FPGA (the name VS Code recorded), never with the folder name",
          ["--profile", "FPGA", "--list-extensions"] in calls and any(c[:3] == ["--profile", "FPGA", "--install-extension"] and c[-1] == "--force" for c in calls)
          and ["--profile", "FPGA", "--install-extension", DEP_ID] in calls and not any("-named" in c or "-anon" in c for c in calls)
          and [l.strip() for l in open(s.store + "@FPGA")] == [EXT_ID, DEP_ID] and s.installed() == [EXT_ID, DEP_ID], json.dumps(calls))
    st = json.load(open(s.state))
    check("the record names the editor and the profile it installed into",
          st["version"] == 2 and st["editor"] == "Code" and [(p["name"], p["dir"], p["installed_by_dewfpga"], p["veriloghdl_installed_by_dewfpga"]) for p in st["profiles"]] == [("FPGA", named, True, True)], json.dumps(st))
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove", user_dir=False), s.env())
    calls = [c[1:] for c in s.code_calls()]
    check("remove: --profile FPGA --uninstall-extension for both, the Default profile too; tasks gone from User and FPGA; record gone",
          rc == 0 and ["--profile", "FPGA", "--uninstall-extension", EXT_ID] in calls and ["--profile", "FPGA", "--uninstall-extension", DEP_ID] in calls
          and ["--uninstall-extension", EXT_ID] in calls and [l.strip() for l in open(s.store + "@FPGA") if l.strip()] == [] and s.installed() == []
          and (not os.path.exists(s.tasks) or our_tasks(s.tasks) == []) and (not os.path.exists(os.path.join(named, "tasks.json")) or our_tasks(os.path.join(named, "tasks.json")) == []) and not os.path.exists(s.state),
          out + err + json.dumps(calls))
    s = Scratch(base, "profiles-shared", store_ids=[DEP_ID])
    shared = os.path.join(s.user, "profiles", "-sh")
    os.makedirs(shared)
    name_profiles(s.user, {"-sh": "Shared"}, flags={"-sh": {"extensions": True}})
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    calls = [c[1:] for c in s.code_calls()]
    check("a profile that shares the Default profile's extensions: no --profile install, tasks still written there, record says not installed by us",
          rc == 0 and not any(c[:2] == ["--profile", "Shared"] for c in calls) and len(our_tasks(os.path.join(shared, "tasks.json"))) == 3
          and "kept: profile Shared shares the Default profile's extensions" in out
          and json.load(open(s.state))["profiles"] == [{"name": "Shared", "dir": shared, "installed_by_dewfpga": False, "veriloghdl_installed_by_dewfpga": False}], out + err + json.dumps(calls))
    s = Scratch(base, "profiles-badstore")
    os.makedirs(os.path.join(s.user, "profiles", "-x"))
    os.makedirs(os.path.join(s.user, "globalStorage"))
    with open(os.path.join(s.user, "globalStorage", "storage.json"), "w") as f:
        f.write("{not json")
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    check("storage.json unreadable: the Default profile is set up, the profile folders are skipped with the reason, no --profile call",
          rc == 0 and len(our_tasks(s.tasks)) == 3 and not os.path.exists(os.path.join(s.user, "profiles", "-x", "tasks.json"))
          and "cannot be read" in out and "were skipped" in out and not any(c[1:2] == ["--profile"] for c in s.code_calls()), out + err)
    s = Scratch(base, "profiles-nouser")
    shutil.rmtree(s.user)
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    check("the editor's User folder does not exist: extension installed, note says to open the editor once, writer not called",
          rc == 0 and s.installed() == [EXT_ID, DEP_ID] and "does not exist yet" in out and not os.path.exists(s.user)
          and [c for c in s.argv_calls() if c[1] == tasks_py] == [], out + err)

    print("== settings.json is JSONC: a commented-out shim key does not retain, a real one behind comments does")
    shim = "~/.vscode/extensions/%s-%s/bin" % (EXT_ID, version)
    s = Scratch(base, "jsonc-commented")
    rc, out, err = run(setup_argv(here, s), s.env())
    with open(os.path.join(s.user, "settings.json"), "w") as f:
        f.write('{\n  // "verilog.linting.path": "%s",\n  /* "verilog.linting.path": "%s" */\n  "editor.fontSize": 14\n}\n' % (shim, shim))
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("only commented-out shim keys: removal proceeds", rc == 0 and s.installed() == [] and not os.path.exists(s.state), out + err)
    s = Scratch(base, "jsonc-real")
    rc, out, err = run(setup_argv(here, s), s.env())
    with open(os.path.join(s.user, "settings.json"), "w") as f:
        f.write('{\n  /* block */ "editor.fontSize": 14, // trailing\n  "verilog.linting.path": /* odd */ "%s", // set by the extension\n}\n' % shim)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("the real key behind comments and a trailing comma: retained, no uninstall", rc == 0 and "note [vscode-linter-shim-retained]" in out
          and s.code_calls() == [] and s.installed() == [EXT_ID, DEP_ID] and os.path.exists(s.state), out + err)
    s = Scratch(base, "jsonc-malformed")
    rc, out, err = run(setup_argv(here, s), s.env())
    with open(os.path.join(s.user, "settings.json"), "w") as f:
        f.write('{"editor.fontSize": 14, "verilog.linting.path": "%s' % shim)
    s.clear_logs()
    rc, out, err = run(setup_argv(here, s, "--remove"), s.env())
    check("a settings.json that does not parse: retained with the reason, no uninstall", rc == 0 and "cannot be read as JSON with comments" in out
          and s.code_calls() == [] and s.installed() == [EXT_ID, DEP_ID] and os.path.exists(s.state), out + err)

    print("== bad arguments")
    s = Scratch(base, "badargs")
    rc, out, err = run([PY, setup_py, "--here", s.dir, "--home", s.home], s.env())
    check("--here without the dewfpga files: exit 2", rc == 2 and "is missing; --here must be the dewfpga folder" in err, out + err)

    print("== bin/dewfpga: the vscode command, uninstall order, nonfatal failures")
    cli_tree = copy_tree(os.path.join(base, "cli", "dewfpga"))   # the CLI refuses spaces in HERE
    cli2 = os.path.join(cli_tree, "bin", "dewfpga")
    rc, out, err = run(["bash", "-n", cli2], {"PATH": "/usr/bin:/bin"})
    check("bash -n bin/dewfpga", rc == 0, err)
    rc, out, err = run([cli2, "--help"], {"PATH": "/usr/bin:/bin", "HOME": base})
    check("--help lists the vscode command on one line with --remove|--print", rc == 0 and "dewfpga vscode [--remove|--print]" in out and out.strip().endswith(out.strip().splitlines()[-1]) and "--version" in out, out + err)
    s = Scratch(base, "cli")
    rc, out, err = run([cli2, "vscode", "--print"], s.env())
    check("dewfpga vscode --print: read only, through the CLI", rc == 0 and "Nothing below was run or written." in out and s.code_calls() == [] and os.listdir(s.user) == [], out + err)
    rc, out, err = run([cli2, "vscode"], s.env())
    check("dewfpga vscode: installs through PATH's code, writes the tasks under HOME, records under FPGA_HOME",
          rc == 0 and s.installed() == [EXT_ID, DEP_ID] and len(our_tasks(s.tasks)) == 3 and json.load(open(s.state))["code"] == s.code, out + err)
    rc, out, err = run([cli2, "vscode", "--bogus"], s.env())
    check("dewfpga vscode --bogus: exit 2 from argparse", rc == 2 and "--bogus" in err, out + err)
    # uninstall: the VS Code removal runs before the toolchain is deleted; a failure there never stops the uninstall
    for e in ("venv", "chipdb"):
        os.makedirs(os.path.join(s.fpga_home, e))
    rc, out, err = run([cli2, "uninstall"], s.env())
    lines = out.splitlines()
    i_ext = next((i for i, l in enumerate(lines) if l == "removed: VS Code extension %s" % EXT_ID), -1)
    i_rm = next((i for i, l in enumerate(lines) if l.startswith("removing: ")), -1)
    check("uninstall: extension and tasks removed before 'removing:' the toolchain; exit 0; done.",
          rc == 0 and 0 <= i_ext < i_rm and s.installed() == [] and not os.path.exists(s.state) and not os.path.exists(os.path.join(s.fpga_home, "venv"))
          and lines[-1] == "done." and (not os.path.exists(s.tasks) or our_tasks(s.tasks) == []), out + err)
    rc, out, err = run([cli2, "vscode"], s.env())
    for e in ("venv", "chipdb"):
        os.makedirs(os.path.join(s.fpga_home, e), exist_ok=True)
    rc, out, err = run([cli2, "uninstall"], s.env(fail="list"))
    check("uninstall with a failing code: the note, the toolchain still removed, exit 0",
          rc == 0 and "note: the VS Code setup could not be fully removed" in out and "ERROR [vscode-extension-install-failed]" in err
          and not os.path.exists(os.path.join(s.fpga_home, "venv")) and out.splitlines()[-1] == "done." and os.path.exists(s.state), out + err)
    for e in ("venv", "chipdb"):
        os.makedirs(os.path.join(s.fpga_home, e), exist_ok=True)
    # a PATH with everything the CLI needs except python3 (macOS always has /usr/bin/python3, so build one without it)
    nopy = os.path.join(base, "cli", "nopy")
    os.makedirs(nopy)
    for d in ("/usr/bin", "/bin"):
        for n in os.listdir(d):
            if not n.startswith("python") and not os.path.exists(os.path.join(nopy, n)):
                os.symlink(os.path.join(d, n), os.path.join(nopy, n))
    rc, out, err = run([cli2, "uninstall"], s.env(code_on_path=False, extra={"PATH": nopy}))
    check("uninstall without python3 on PATH: the die line, the toolchain still removed, exit 0",
          rc == 0 and "note: the VS Code setup could not be fully removed" in out and "python3 is missing" in err and out.splitlines()[-1] == "done.", out + err)
    bare = os.path.join(base, "cli", "bare")
    os.makedirs(bare)
    shutil.copytree(os.path.join(cli_tree, "bin"), os.path.join(bare, "bin"))
    shutil.copy2(os.path.join(cli_tree, "package.json"), bare)
    os.makedirs(os.path.join(s.fpga_home, "venv"), exist_ok=True)
    s.clear_logs()
    rc, out, err = run([os.path.join(bare, "bin", "dewfpga"), "uninstall"], s.env())
    check("uninstall from a copy without templates/ (test/run.sh's un_copy): no VS Code step, no code call, exit 0",
          rc == 0 and "VS Code" not in out and s.code_calls() == [] and out.splitlines()[-1] == "done.", out + err)

    s = Scratch(base, "skip-hook")
    rc, out, err = run([cli2, "vscode"], s.env(extra={"DEWFPGA_SKIP_VSCODE": "1"}))
    check("DEWFPGA_SKIP_VSCODE=1 does not stop an explicit dewfpga vscode", rc == 0 and s.installed() == [EXT_ID, DEP_ID] and len(our_tasks(s.tasks)) == 3, out + err)
    for e in ("venv", "chipdb"):
        os.makedirs(os.path.join(s.fpga_home, e))
    s.clear_logs()
    rc, out, err = run([cli2, "uninstall"], s.env(extra={"DEWFPGA_SKIP_VSCODE": "1"}))
    check("DEWFPGA_SKIP_VSCODE=1 on uninstall: no code call, extension, tasks and record untouched, note printed, toolchain removed, done.",
          rc == 0 and s.code_calls() == [] and s.installed() == [EXT_ID, DEP_ID] and len(our_tasks(s.tasks)) == 3 and os.path.exists(s.state)
          and "note: DEWFPGA_SKIP_VSCODE=1" in out and not os.path.exists(os.path.join(s.fpga_home, "venv")) and out.splitlines()[-1] == "done.", out + err)
    for e in ("venv", "chipdb"):
        os.makedirs(os.path.join(s.fpga_home, e), exist_ok=True)
    s.clear_logs()
    rc, out, err = run([cli2, "uninstall"], s.env(extra={"DEWFPGA_SKIP_VSCODE": "0"}))
    check("DEWFPGA_SKIP_VSCODE=0: the uninstall hook runs as usual", rc == 0 and s.installed() == [] and not os.path.exists(s.state) and out.splitlines()[-1] == "done.", out + err)

    print("== install.sh: the setup is nonfatal")
    rc, out, err = run(["bash", "-n", os.path.join(cli_tree, "install.sh")], {"PATH": "/usr/bin:/bin"})
    check("bash -n install.sh", rc == 0, err)
    line = [l for l in open(os.path.join(cli_tree, "install.sh")) if l.startswith('"$CLI" vscode')]
    check("install.sh calls \"$CLI\" vscode once, after check, with a fallback echo", len(line) == 1 and "||" in line[0] and "Retry:  dewfpga vscode" in line[0], repr(line))
    src = open(os.path.join(cli_tree, "install.sh")).read()
    check("install.sh runs the vscode step after `check` and before the Total line", 0 < src.find('"$CLI" check') < src.find('"$CLI" vscode') < src.find('echo "Total:'), "")
    fake_cli = os.path.join(base, "cli", "failing-cli")
    with open(fake_cli, "w") as f:
        f.write("#!/bin/sh\n[ \"$1\" = vscode ] && { echo 'ERROR [vscode-extension-install-failed]: x' >&2; exit 1; }\nexit 0\n")
    os.chmod(fake_cli, 0o755)
    script = "set -euo pipefail\nCLI=%s\n%secho after\n" % (json.dumps(fake_cli), line[0] if line else "false\n")
    rc, out, err = run(["bash", "-c", script], {"PATH": "/usr/bin:/bin"})
    check("that exact line under set -e: a failing vscode step prints the note and the installer goes on", rc == 0 and "VS Code setup did not finish" in out and out.strip().endswith("after"), out + err)
    src_lines = src.splitlines(True)
    i0 = next((i for i, l in enumerate(src_lines) if l.startswith('if [ "${DEWFPGA_SKIP_VSCODE:-}" = 1 ]')), -1)
    i1 = next((i for i in range(max(i0, 0), len(src_lines)) if src_lines[i].rstrip() == "fi"), -1)
    block = "".join(src_lines[i0:i1 + 1]) if 0 <= i0 < i1 else "false\n"
    check("install.sh guards the vscode step with DEWFPGA_SKIP_VSCODE=1 (the block holds the call and a skip note naming dewfpga vscode)",
          0 <= i0 < i1 and '"$CLI" vscode' in block and "DEWFPGA_SKIP_VSCODE=1" in block and "dewfpga vscode" in block, block)
    loud_cli = os.path.join(base, "cli", "loud-cli")
    with open(loud_cli, "w") as f:
        f.write("#!/bin/sh\necho CLI-WAS-CALLED \"$@\"\nexit 99\n")
    os.chmod(loud_cli, 0o755)
    script = "set -euo pipefail\nCLI=%s\n%secho after\n" % (json.dumps(loud_cli), block)
    rc, out, err = run(["bash", "-c", script], {"PATH": "/usr/bin:/bin", "DEWFPGA_SKIP_VSCODE": "1"})
    check("that block with DEWFPGA_SKIP_VSCODE=1: the CLI is not called, the skip note is printed, the installer goes on",
          rc == 0 and "CLI-WAS-CALLED" not in out and "DEWFPGA_SKIP_VSCODE=1" in out and out.strip().endswith("after"), out + err)
    rc, out, err = run(["bash", "-c", script], {"PATH": "/usr/bin:/bin"})
    check("that block without the flag: the CLI is called with `vscode`, its failure is the note, the installer goes on",
          rc == 0 and "CLI-WAS-CALLED vscode" in out and "VS Code setup did not finish" in out and out.strip().endswith("after"), out + err)

    print("== templates/.vscode/tasks.json (the per-project file dewfpga new copies)")
    tj = json.load(open(os.path.join(ROOT, "templates", ".vscode", "tasks.json")))
    sys.dont_write_bytecode = True
    sys.path.insert(0, os.path.join(ROOT, "templates"))
    import vscode_tasks  # noqa: E402
    check("3 make tasks, each with DEWFPGA_ABSPATH=1 and the dewfpga problem matcher (same regexp as the user tasks)",
          len(tj["tasks"]) == 3 and all(t["options"]["env"] == {"DEWFPGA_ABSPATH": "1"} and t["problemMatcher"]["pattern"]["regexp"] == vscode_tasks.MATCHER_REGEXP
                                       and t["command"].startswith("make ") for t in tj["tasks"]), json.dumps(tj, indent=1)[:1500])
    rc, out, err = run(["sed", 's/"make /"dewfpga /', os.path.join(ROOT, "templates", ".vscode", "tasks.json")], {"PATH": "/usr/bin:/bin"})
    check("dewfpga new's sed turns every command into dewfpga and the JSON stays valid", rc == 0 and all(t["command"].startswith("dewfpga ") for t in json.loads(out)["tasks"]), out[:500])

    print("== the npm package ships what `dewfpga vscode` needs and nothing private")
    npm = shutil.which("npm")
    if not npm:
        check("npm is available for the package test", False, "npm not on PATH")
    else:
        os.makedirs(os.path.join(cli_tree, "vscode", "out"))
        with open(os.path.join(cli_tree, "vscode", "out", "dewfpga-0.0.0.vsix"), "w") as f:
            f.write("junk")
        os.makedirs(os.path.join(cli_tree, "test"))
        with open(os.path.join(cli_tree, "test", "x"), "w") as f:
            f.write("x")
        packdir = os.path.join(base, "pack")
        os.makedirs(packdir)
        rc, out, err = run([npm, "pack", "--silent", "--pack-destination", packdir], dict(os.environ, LC_ALL="C"), cwd=cli_tree)
        tgz = [n for n in os.listdir(packdir) if n.endswith(".tgz")]
        check("npm pack produced one tarball", rc == 0 and len(tgz) == 1, out + err)
        names = []
        if tgz:
            with tarfile.open(os.path.join(packdir, tgz[0])) as tf:
                names = [m.name for m in tf.getmembers() if m.isfile()]
                tf.extractall(packdir, filter="data")
        need = ["package/bin/dewfpga", "package/install.sh", "package/templates/vscode_setup.py", "package/templates/vscode_tasks.py",
                "package/templates/.vscode/tasks.json", "package/vscode/package.json", "package/vscode/extension.js", "package/vscode/bin/iverilog",
                "package/vscode/build-vsix.py", "package/LICENSE"]
        missing = [n for n in need if n not in names]
        stray = [n for n in names if n.startswith(("package/vscode/out/", "package/test/", "package/site/", "package/docs/", "package/.claude/"))]
        check("tarball holds every file the setup needs", missing == [], repr(missing) + "\n" + "\n".join(names))
        check("tarball holds nothing from vscode/out, test, site, docs", stray == [], repr(stray))
        pkg = os.path.join(packdir, "package")
        s = Scratch(base, "packed")
        rc, out, err = run(setup_argv(pkg, s), s.env())
        pk_state = json.load(open(s.state)) if os.path.exists(s.state) else {}
        check("setup from the packed tree (no .git, no node on PATH): VSIX hash equals the source build, tasks written",
              rc == 0 and pk_state.get("vsix_sha256") == ref_sha and len(our_tasks(s.tasks)) == 3 and s.installed() == [EXT_ID, DEP_ID], out + err + json.dumps(pk_state))


if __name__ == "__main__":
    sys.exit(main())
