#!/usr/bin/env python3
"""dewfpga vscode: set up VS Code for dewfpga, or undo it.

    python3 vscode_setup.py --here DIR                     install the companion extension, then the user tasks
    python3 vscode_setup.py --here DIR --remove            remove the user tasks, then the extension this setup installed
    python3 vscode_setup.py --here DIR --print             print what setup would write and run; touches nothing

DIR is the dewfpga checkout or install folder (holds bin/dewfpga, vscode/, templates/vscode_tasks.py).

Order on setup: find the `code` command (PATH, then the app bundles) and the editor it belongs to (Code, Code -
Insiders or VSCodium: the .app on its real path, else its name) -> build the companion VSIX from the vscode/ sources
into a private temporary folder (no network, no Node) -> `code --install-extension <vsix> --force` -> `code
--install-extension mshr-h.veriloghdl` only when that extension is absent -> the same for every profile of that
editor whose name VS Code recorded (User/globalStorage/storage.json, key userDataProfiles; `code --profile NAME`) ->
only where the companion is really listed by `--list-extensions`, write the user tasks (templates/vscode_tasks.py)
into that editor's User folder and those profiles. The tasks need the extension (their top-module picker is the
extension's command), so a failed extension install writes no task there. A profile folder without a recorded name,
or one that shares the Default profile's extensions or tasks, is skipped with a reason; other editors are not touched.

No `code` on this Mac: one note, exit 0 (the toolchain is complete without the editor).

Removal: the tasks go first (vscode_tasks.py --remove, which only removes entries its own record proves it wrote).
The companion extension goes only when this setup installed it (recorded in $FPGA_HOME/vscode-setup.json together
with the editor and profiles), only through a `code` command of that same editor, and only when the user's
verilog.linting.path does not point at the extension's lint shim; a settings value pointing there means the
extension's own command (dewfpga.removeLinter) has to undo it first, so the extension is kept and the command is
named. settings.json is read with the JSONC parser of vscode_tasks.py (comments do not count); one that cannot be
parsed also keeps the extension. Nothing of the user's is read beyond that one settings key, nothing is written to
settings, and extensions this setup did not install stay.

The record is written through a private temporary file (mkstemp) and os.replace; a record path that is a symlink or
not a regular file is refused before anything is installed, and a record whose content does not match the schema
counts as no record (the extension is then kept).

DEWFPGA_SKIP_VSCODE=1 is honoured by the callers that run automatically (install.sh, dewfpga uninstall), not here:
an explicit `dewfpga vscode` always runs.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile

SITE = "https://nosey-dewdrop.github.io/dewfpga/errors"
EXT_ID = "nosey-dewdrop.dewfpga"
DEP_ID = "mshr-h.veriloghdl"
LINT_KEY = "verilog.linting.path"
STATE_NAME = "vscode-setup.json"
EDITORS = ("Code", "Code - Insiders", "VSCodium")
# app bundle -> (relative path of its `code` command inside the bundle)
APP_BUNDLES = (
    ("Visual Studio Code.app", os.path.join("Contents", "Resources", "app", "bin", "code")),
    ("Visual Studio Code - Insiders.app", os.path.join("Contents", "Resources", "app", "bin", "code-insiders")),
    ("VSCodium.app", os.path.join("Contents", "Resources", "app", "bin", "codium")),
)
# the editor (its folder under ~/Library/Application Support) a command belongs to, by .app bundle and by command name
EDITOR_OF_APP = {"Visual Studio Code.app": "Code", "Visual Studio Code - Insiders.app": "Code - Insiders", "VSCodium.app": "VSCodium"}
EDITOR_OF_BIN = {"code": "Code", "code-insiders": "Code - Insiders", "codium": "VSCodium"}
BIN_OF_EDITOR = {v: k for k, v in EDITOR_OF_BIN.items()}


def note(code, text):
    print("note [%s]: %s %s/%s/" % (code, text, SITE, code))


def err(code, text):
    sys.stderr.write("ERROR [%s]: %s %s/%s/\n" % (code, text, SITE, code))


def q(s):
    """shell-quote for display only (every real call is an argument list)"""
    if re.match(r"^[A-Za-z0-9_./=:@%+-]+$", s):
        return s
    return "'" + s.replace("'", "'\\''") + "'"


def load_writer(tasks_py):
    """templates/vscode_tasks.py as a module (its JSONC parser reads settings.json here); no .pyc is written"""
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("vscode_tasks", tasks_py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ----------------------------------------------------------------------------- code CLI
def usable(p):
    return bool(p) and os.path.isfile(p) and os.access(p, os.X_OK)


def find_code(path_env, app_dirs, editor=None):
    """the `code` command: first on PATH, then inside the app bundles. None when neither exists.
    With editor, only that editor's command and bundle count."""
    for name in ("code", "code-insiders", "codium"):
        if editor and EDITOR_OF_BIN[name] != editor:
            continue
        p = shutil.which(name, path=path_env)
        # another editor's bundle can ship a command with the same name (Cursor.app has bin/code): skip it
        if p and editor_of(p) is not None and (editor is None or editor_of(p) == editor):
            return os.path.abspath(p)
    for d in app_dirs:
        for app, rel in APP_BUNDLES:
            if editor and EDITOR_OF_APP[app] != editor:
                continue
            p = os.path.join(d, app, rel)
            if usable(p):
                return p
    return None


def editor_of(code):
    """the editor a `code` command belongs to: the .app bundle on its real path, else (no .app on that path) the command's
    name; None when neither, or when the real path is inside another app's bundle"""
    parts = os.path.realpath(code).split(os.sep)
    for part in parts:
        if part in EDITOR_OF_APP:
            return EDITOR_OF_APP[part]
    if any(part.endswith(".app") for part in parts):
        return None
    return EDITOR_OF_BIN.get(os.path.basename(code))


def run(argv, log=None):
    """run an argument list, never a shell string; returns (rc, stdout, stderr) and never raises for a failed command"""
    if log is not None:
        log.append(list(argv))
    try:
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    except OSError as e:
        return 127, "", str(e)
    except subprocess.TimeoutExpired:
        return 124, "", "timed out after 600 s"
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def prof_args(profile):
    """the `code` arguments that select a profile; the Default profile (None) needs none"""
    return ["--profile", profile] if profile else []


def list_extensions(code, profile=None, log=None):
    rc, out, errtxt = run([code] + prof_args(profile) + ["--list-extensions"], log)
    if rc != 0:
        return None, errtxt.strip() or out.strip()
    return set(line.strip().lower() for line in out.splitlines() if line.strip()), ""


def where(profile):
    """suffix for messages: nothing for the Default profile, ' in profile NAME' otherwise"""
    return " in profile %s" % profile if profile else ""


# ----------------------------------------------------------------------------- state
class RecordUnsafe(Exception):
    pass


def state_path(fpga_home):
    return os.path.join(fpga_home, STATE_NAME)


def check_record_path(fpga_home):
    """the record must be absent or a plain file: a symlink (or a device, a directory) there is never followed or replaced"""
    p = state_path(fpga_home)
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return
    if not stat.S_ISREG(st.st_mode):
        raise RecordUnsafe("%s is %s, not a plain file, so the setup record cannot be used; move it away first"
                           % (p, "a symlink" if stat.S_ISLNK(st.st_mode) else "a directory" if stat.S_ISDIR(st.st_mode) else "a special file"))


def valid_state(d):
    """the record dewfpga wrote (version 2); anything else counts as no record"""
    if not isinstance(d, dict) or d.get("version") != 2 or d.get("extension") != EXT_ID:
        return False
    if d.get("editor") not in EDITORS or not isinstance(d.get("code"), str):
        return False
    for k in ("installed_by_dewfpga", "veriloghdl_installed_by_dewfpga"):
        if not isinstance(d.get(k), bool):
            return False
    profiles = d.get("profiles")
    if not isinstance(profiles, list):
        return False
    for p in profiles:
        if not isinstance(p, dict) or not isinstance(p.get("name"), str) or not p["name"]:
            return False
        if not isinstance(p.get("dir"), str) or not isinstance(p.get("installed_by_dewfpga"), bool) \
                or not isinstance(p.get("veriloghdl_installed_by_dewfpga"), bool):
            return False
    return True


def load_state(fpga_home):
    """the record, or None (absent, unreadable, not ours). Raises RecordUnsafe for a symlink or a non-file."""
    check_record_path(fpga_home)
    try:
        with open(state_path(fpga_home), "rb") as f:
            d = json.loads(f.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    return d if valid_state(d) else None


def save_state(fpga_home, state):
    """write through a private temporary file (mkstemp, 0600) and os.replace: the old record stays intact if anything fails"""
    os.makedirs(fpga_home, exist_ok=True)
    check_record_path(fpga_home)
    fd, tmp = tempfile.mkstemp(prefix=".vscode-setup.", suffix=".tmp", dir=fpga_home)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write((json.dumps(state, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        os.replace(tmp, state_path(fpga_home))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ----------------------------------------------------------------------------- the editor's folders
def editor_user_dir(home, editor):
    return os.path.join(home, "Library", "Application Support", editor, "User")


def profile_names(user):
    """{profile folder name: (profile name, useDefaultFlags)} as VS Code recorded it in User/globalStorage/storage.json,
    key userDataProfiles (each entry: name, location = the folder name or a file URI). Second value: a reason when the
    file exists but cannot be read; no file means no profiles were ever created."""
    p = os.path.join(user, "globalStorage", "storage.json")
    try:
        with open(p, "rb") as f:
            d = json.loads(f.read().decode("utf-8"))
    except FileNotFoundError:
        return {}, None
    except (OSError, ValueError) as e:
        return {}, "%s cannot be read (%s)" % (p, e)
    names = {}
    entries = d.get("userDataProfiles") if isinstance(d, dict) else None
    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("name"), str) or not e["name"]:
            continue
        loc = e.get("location")
        if isinstance(loc, dict):
            loc = loc.get("path")
        if isinstance(loc, str) and loc.strip("/"):
            flags = e.get("useDefaultFlags")
            names[os.path.basename(loc.rstrip("/"))] = (e["name"], flags if isinstance(flags, dict) else {})
    return names, None


def profile_targets(user):
    """[(dir, name, flags)] for the editor's named profiles, plus the notes for the folders that were skipped"""
    names, why = profile_names(user)
    found, notes = [], []
    prof = os.path.join(user, "profiles")
    if why:
        notes.append("%s; the profiles under %s were skipped (the Default profile is set up)" % (why, prof))
        return found, notes
    if not os.path.isdir(prof) or os.path.islink(prof):
        return found, notes
    for n in sorted(os.listdir(prof)):
        d = os.path.join(prof, n)
        if not os.path.isdir(d) or os.path.islink(d):
            continue
        if n not in names:
            notes.append("profile folder %s has no name in %s, so it was skipped: open that profile in VS Code once, then  dewfpga vscode  again "
                         "(or add the tasks yourself: dewfpga vscode --print)" % (d, os.path.join(user, "globalStorage", "storage.json")))
            continue
        found.append((d, names[n][0], names[n][1]))
    return found, notes


def settings_dirs(home, editor, explicit):
    """where a settings.json may point at the lint shim: the editor's User folder and every profile folder under it"""
    if explicit:
        return list(explicit)
    user = editor_user_dir(home, editor)
    found = [user] if os.path.isdir(user) else []
    prof = os.path.join(user, "profiles")
    if os.path.isdir(prof):
        found += [os.path.join(prof, p) for p in sorted(os.listdir(prof)) if os.path.isdir(os.path.join(prof, p))]
    return found


# ----------------------------------------------------------------------------- settings (read one key)
def linting_path(settings_file, writer):
    """the verilog.linting.path value in a settings.json, or None; 'unreadable' when the file exists but cannot be read or
    parsed. settings.json is JSONC, so the writer's parser reads it (a commented-out key does not count); nothing is
    written back. A file that does not parse is 'unreadable' on purpose: the key may still be in there."""
    try:
        with open(settings_file, "rb") as f:
            text = f.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return None
    except OSError:
        return "unreadable"
    try:
        root = writer.parse_jsonc(text)
    except writer.JsoncError:
        return "unreadable"
    if root.kind != "object":
        return "unreadable" if text.strip() else None
    node = writer.find_entry(root, LINT_KEY)
    if node is None:
        return None
    return node.value if node.kind == "string" else None


def points_at_shim(value, home):
    """True when a verilog.linting.path value is inside our installed extension (…/nosey-dewdrop.dewfpga-<v>/bin)"""
    if not value:
        return False
    v = os.path.expanduser(value)
    if v.startswith("~") and home:
        v = home + v[1:]
    parts = os.path.normpath(v).split(os.sep)
    return any(p.lower().startswith(EXT_ID) for p in parts)


# ----------------------------------------------------------------------------- the three modes
def tasks_argv(a, tasks_py, cli, dirs, extra):
    argv = [sys.executable, tasks_py, "--cli", cli]
    for d in dirs:
        argv += ["--user-dir", d]
    if a.home_override:
        argv += ["--home", a.home_override]
    return argv + extra


def run_tasks(a, tasks_py, cli, dirs, extra, log):
    rc, out, errtxt = run(tasks_argv(a, tasks_py, cli, dirs, extra), log)
    sys.stdout.write(out)
    if errtxt:
        sys.stderr.write(errtxt)
    return rc


def do_print(a, here, tasks_py, cli, code):
    print("# dewfpga vscode --print: what `dewfpga vscode` would do. Nothing below was run or written.")
    print("# 1. companion extension (built from %s, installed with the code command):" % os.path.join(here, "vscode"))
    c = code or "code"
    if not code:
        print("#    (no `code` command found on this Mac: install VS Code, then Shell Command: Install 'code' command in PATH)")
    print("#    " + " ".join(q(x) for x in [c, "--install-extension", "<private temp dir>/dewfpga-<version>.vsix", "--force"]))
    print("#    " + " ".join(q(x) for x in [c, "--install-extension", DEP_ID]) + "   (only when it is not already installed)")
    print("#    (again with  --profile NAME  for every profile of this editor that VS Code has a name for)")
    print("# 2. user tasks (this editor's User folder and those profiles), the file below merged into tasks.json:")
    rc, out, errtxt = run(tasks_argv(a, tasks_py, cli, a.user_dir, ["--print"]))
    sys.stdout.write(out)
    if rc != 0:
        sys.stderr.write(errtxt)
    return rc


def install_into(code, profile, vsix, version, before, log):
    """install the companion (and, when absent, the dependency) into one profile; returns (ok, dep_installed_now)"""
    rc, out, errtxt = run([code] + prof_args(profile) + ["--install-extension", vsix, "--force"], log)
    after = None
    if rc == 0:
        after, why = list_extensions(code, profile, log)
    if rc != 0 or after is None or EXT_ID not in after:
        detail = (errtxt or out).strip() or (why if after is None else "") or ("%s is not in `%s --list-extensions` after the install" % (EXT_ID, q(code)))
        return False, detail, False
    print("installed: VS Code extension %s %s%s (%s)" % (EXT_ID, version, where(profile), "updated" if EXT_ID in before else "new"))
    dep_now = False
    if DEP_ID in after:
        print("kept: VS Code extension %s%s (already installed)" % (DEP_ID, where(profile)))
    else:
        rc, out, errtxt = run([code] + prof_args(profile) + ["--install-extension", DEP_ID], log)
        if rc == 0:
            dep_now = True
            print("installed: VS Code extension %s%s (the Verilog language support the companion builds on)" % (DEP_ID, where(profile)))
        else:
            note("vscode-extension-install-failed", "%s --install-extension %s failed%s (%s): no network, or the marketplace is blocked. The companion "
                 "and the tasks work without it; install it from VS Code's Extensions view when you can."
                 % (q(code), DEP_ID, where(profile), (errtxt or out).strip() or "no output"))
    return True, "", dep_now


def do_setup(a, here, tasks_py, cli, code, fpga_home, home, log):
    if not code:
        note("vscode-not-found", "VS Code's `code` command is not on your PATH and no Visual Studio Code.app is in /Applications or ~/Applications, "
             "so the editor setup was skipped (the toolchain is complete without it). Fix: install VS Code, run its command "
             "\"Shell Command: Install 'code' command in PATH\", then  dewfpga vscode  (or paste the tasks yourself: dewfpga vscode --print).")
        return 0
    editor = editor_of(code)
    if editor is None:
        note("vscode-not-found", "%s is not a command of Visual Studio Code, Code - Insiders or VSCodium, so the editor setup was skipped: "
             "its settings folder is unknown. Fix: put VS Code's own `code` command on your PATH, then  dewfpga vscode  "
             "(or paste the tasks yourself: dewfpga vscode --print)." % q(code))
        return 0
    try:
        state = load_state(fpga_home) or {}
    except RecordUnsafe as e:
        err("vscode-extension-install-failed", "%s. Nothing was installed and no task was written." % e)
        return 1
    before, why = list_extensions(code, None, log)
    if before is None:
        err("vscode-extension-install-failed", "%s --list-extensions failed (%s), so nothing was installed and no task was written. "
            "Fix: open VS Code once, then  dewfpga vscode  again." % (q(code), why or "no output"))
        return 1
    same_editor = state.get("editor") == editor
    preexisting = EXT_ID in before and not (same_editor and state.get("installed_by_dewfpga"))
    old_profiles = {p["name"]: p for p in state.get("profiles", [])} if same_editor else {}
    # the targets: the editor's User folder (Default profile) and its named profiles; --user-dir names them exactly (Default semantics)
    if a.user_dir:
        task_dirs, profiles, skipped = list(a.user_dir), [], []
    else:
        user = editor_user_dir(home, editor)
        task_dirs = [user] if os.path.isdir(user) else []
        profiles, skipped = profile_targets(user) if os.path.isdir(user) else ([], [])
        if not task_dirs:
            skipped.append("%s does not exist yet, so no task was written: open %s once, then  dewfpga vscode  again" % (user, editor))
    # build the VSIX in a private folder (mkdtemp: 0700), delete it whatever happens
    tmpdir = tempfile.mkdtemp(prefix="dewfpga-vsix.")
    try:
        rc, out, errtxt = run([sys.executable, os.path.join(here, "vscode", "build-vsix.py"), "--out", tmpdir], log)
        vsix = out.strip().splitlines()[-1] if out.strip() else ""
        if rc != 0 or not os.path.isfile(vsix):
            err("vscode-extension-install-failed", "the companion extension did not build from %s (%s), so no task was written. Fix: "
                "dewfpga install  rewrites the files; then  dewfpga vscode  again." % (os.path.join(here, "vscode"), (errtxt or out).strip() or "no output"))
            return 1
        with open(vsix, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        version = os.path.basename(vsix)[len("dewfpga-"):-len(".vsix")]
        ok, detail, dep_now = install_into(code, None, vsix, version, before, log)
        if not ok:
            err("vscode-extension-install-failed", "%s --install-extension did not install the dewfpga companion (%s), so no task was written: the tasks "
                "need the extension's top-module picker. Fix: open VS Code once, then  dewfpga vscode  again." % (q(code), detail))
            return 1
        dep_by_us = dep_now or (same_editor and bool(state.get("veriloghdl_installed_by_dewfpga")))
        recorded = []
        for d, name, flags in profiles:
            old = old_profiles.get(name, {})
            if flags.get("extensions"):
                print("kept: profile %s shares the Default profile's extensions, so the companion is already there" % name)
                p_before, installed_by_us, p_dep = before, False, False
            else:
                p_before, why = list_extensions(code, name, log)
                if p_before is None:
                    skipped.append("%s --profile %s --list-extensions failed (%s), so profile %s was skipped" % (q(code), name, why or "no output", name))
                    if old:
                        recorded.append(old)
                    continue
                ok, detail, dep_now = install_into(code, name, vsix, version, p_before, log)
                if not ok:
                    skipped.append("the companion did not install in profile %s (%s), so no task was written there; retry:  dewfpga vscode" % (name, detail))
                    if old:
                        recorded.append(old)
                    continue
                installed_by_us = EXT_ID not in p_before or bool(old.get("installed_by_dewfpga"))
                p_dep = dep_now or bool(old.get("veriloghdl_installed_by_dewfpga"))
            recorded.append({"name": name, "dir": d, "installed_by_dewfpga": installed_by_us, "veriloghdl_installed_by_dewfpga": p_dep})
            if flags.get("tasks"):
                print("kept: profile %s shares the Default profile's tasks, so its tasks.json was not touched" % name)
            else:
                task_dirs.append(d)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    try:
        save_state(fpga_home, {
            "version": 2,
            "extension": EXT_ID,
            "extension_version": version,
            "editor": editor,
            "code": code,
            "installed_by_dewfpga": not preexisting,
            "preexisting": preexisting,
            "veriloghdl_installed_by_dewfpga": dep_by_us,
            "profiles": recorded,
            "vsix_sha256": digest,
        })
    except (RecordUnsafe, OSError) as e:
        err("vscode-extension-install-failed", "the setup record could not be written (%s): the extension is installed, but  dewfpga vscode --remove  "
            "will not know it and will keep it. No task was written. Fix: make %s writable, then  dewfpga vscode  again." % (e, fpga_home))
        return 1
    if preexisting:
        print("note: %s was already installed before dewfpga's first setup, so  dewfpga vscode --remove  will leave it in place" % EXT_ID)
    for s in skipped:
        print("note: " + s)
    if not task_dirs:
        return 0
    return run_tasks(a, tasks_py, cli, task_dirs, [], log)


def code_for_removal(state, code, path_env, app_dirs):
    """a `code` command of the editor the record names: the one found now if it is that editor's, else the recorded
    path if it still runs, else that editor's own command on PATH or in its bundle; None when there is none"""
    want = state["editor"]
    for c in (code, state["code"]):
        if usable(c) and editor_of(c) == want:
            return c
    return find_code(path_env, app_dirs, editor=want)


def do_remove(a, here, tasks_py, cli, code, fpga_home, home, log, writer, path_env, app_dirs):
    rc = run_tasks(a, tasks_py, cli, a.user_dir, ["--remove"], log)
    try:
        state = load_state(fpga_home)
    except RecordUnsafe as e:
        note("vscode-linter-shim-retained", "kept: VS Code extension %s: %s; it was neither read nor removed." % (EXT_ID, e))
        return rc
    if state is None:
        print("kept: VS Code extension %s if present (no record that dewfpga installed it; "
              "`code --uninstall-extension %s` removes it)" % (EXT_ID, EXT_ID))
        return rc
    ours = [(None, state)] + [(p["name"], p) for p in state["profiles"]]
    if not any(p["installed_by_dewfpga"] for _, p in ours):
        print("kept: VS Code extension %s (it was installed before dewfpga's setup, so it is yours)" % EXT_ID)
        os.unlink(state_path(fpga_home))
        return rc
    # a settings value pointing at the shim would break linting the moment the extension folder is gone
    for d in settings_dirs(home, state["editor"], a.user_dir):
        sf = os.path.join(d, "settings.json")
        v = linting_path(sf, writer)
        if v == "unreadable" or points_at_shim(v, home):
            reason = ("%s cannot be read as JSON with comments, so %s may still point at the extension's lint shim" % (sf, LINT_KEY) if v == "unreadable"
                      else "%s in %s is %s, inside the extension" % (LINT_KEY, sf, v))
            note("vscode-linter-shim-retained", "kept: VS Code extension %s: %s; removing the extension now would leave the Verilog "
                 "linter pointing at a folder that no longer exists. Fix: in VS Code run the command "
                 "\"dewfpga: stop using the dewfpga iverilog lint shim\" (dewfpga.removeLinter), then  dewfpga vscode --remove  again "
                 "(or  code --uninstall-extension %s)." % (EXT_ID, reason, EXT_ID))
            return rc
    code = code_for_removal(state, code, path_env, app_dirs)
    if not code:
        note("vscode-not-found", "the `%s` command is gone (%s installed the extension %s through %s and no other command of that editor "
             "is on your PATH or in its app bundle), so the extension stays installed; remove it from the editor's Extensions view if the "
             "editor is still there." % (BIN_OF_EDITOR[state["editor"]], state["editor"], EXT_ID, state["code"]))
        return rc
    for profile, p in ours:
        installed, why = list_extensions(code, profile, log)
        if installed is None:
            err("vscode-extension-install-failed", "%s%s --list-extensions failed (%s); the extension %s was left as it is. Fix: "
                "code%s --uninstall-extension %s" % (q(code), where(profile), why or "no output", EXT_ID, " " + " ".join(prof_args(profile)) if profile else "", EXT_ID))
            rc = 1
            continue
        for ext, by_us in ((EXT_ID, p["installed_by_dewfpga"]), (DEP_ID, p["veriloghdl_installed_by_dewfpga"])):
            if ext not in installed:
                continue
            if not by_us:
                print("kept: VS Code extension %s%s (installed by you, not by dewfpga)" % (ext, where(profile)))
                continue
            urc, out, errtxt = run([code] + prof_args(profile) + ["--uninstall-extension", ext], log)
            if urc == 0:
                print("removed: VS Code extension %s%s" % (ext, where(profile)))
            else:
                err("vscode-extension-install-failed", "%s --uninstall-extension %s failed%s (%s). Fix: remove it from VS Code's Extensions view."
                    % (q(code), ext, where(profile), (errtxt or out).strip() or "no output"))
                rc = 1
    if rc == 0:
        os.unlink(state_path(fpga_home))
    return rc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--here", required=True, help="the dewfpga folder (bin/dewfpga, vscode/, templates/)")
    ap.add_argument("--fpga-home", default=None, help="where install.sh put the toolchain (default $FPGA_HOME or ~/fpga); holds the setup record")
    ap.add_argument("--user-dir", action="append", default=[], help="VS Code User (or profile) directory, used exactly as given (Default profile); repeatable; default: this editor's User folder and its named profiles")
    ap.add_argument("--remove", action="store_true")
    ap.add_argument("--print", action="store_true")
    ap.add_argument("--home", dest="home_override", default=None, help=argparse.SUPPRESS)       # tests: a scratch home
    ap.add_argument("--code", default=None, help=argparse.SUPPRESS)                              # tests: the code command
    ap.add_argument("--app-dir", action="append", default=None, help=argparse.SUPPRESS)         # tests: where .app bundles are
    ap.add_argument("--argv-log", default=None, help=argparse.SUPPRESS)                          # tests: every command run, as JSON lines
    a = ap.parse_args(argv)
    if a.remove and a.print:
        sys.stderr.write("vscode_setup: --remove and --print exclude each other\n")
        return 2
    here = os.path.abspath(a.here)
    cli = os.path.join(here, "bin", "dewfpga")
    tasks_py = os.path.join(here, "templates", "vscode_tasks.py")
    for p in (tasks_py, os.path.join(here, "vscode", "build-vsix.py")):
        if not os.path.isfile(p):
            sys.stderr.write("vscode_setup: %s is missing; --here must be the dewfpga folder\n" % p)
            return 2
    home = a.home_override or os.path.expanduser("~")
    fpga_home = a.fpga_home or os.environ.get("FPGA_HOME") or os.path.join(home, "fpga")
    # where the .app bundles live; DEWFPGA_VSCODE_APP_DIRS (colon separated) exists so the tests can point `dewfpga uninstall`,
    # which takes no arguments, at a scratch folder instead of the real /Applications
    if a.app_dir is not None:
        app_dirs = a.app_dir
    elif os.environ.get("DEWFPGA_VSCODE_APP_DIRS") is not None:
        app_dirs = [d for d in os.environ["DEWFPGA_VSCODE_APP_DIRS"].split(":") if d]
    else:
        app_dirs = ["/Applications", os.path.join(home, "Applications")]
    path_env = os.environ.get("PATH", "")
    code = a.code or find_code(path_env, app_dirs)
    if code and not usable(code):
        code = None
    log = []
    try:
        if a.print:
            return do_print(a, here, tasks_py, cli, code)
        if a.remove:
            return do_remove(a, here, tasks_py, cli, code, fpga_home, home, log, load_writer(tasks_py), path_env, app_dirs)
        return do_setup(a, here, tasks_py, cli, code, fpga_home, home, log)
    finally:
        if a.argv_log:
            with open(a.argv_log, "a") as f:
                for argv_ in log:
                    f.write(json.dumps(argv_) + "\n")


if __name__ == "__main__":
    sys.exit(main())
