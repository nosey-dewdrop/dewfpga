#!/usr/bin/env python3
"""Targeted tests: another editor's `code` command (Cursor.app ships bin/code) and a skipped profile's ownership.

    LC_ALL=C PYTHONDONTWRITEBYTECODE=1 python3 test/vscode/test-setup-editor.py    -> last line: passed N, failed 0
"""
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("ts", os.path.join(HERE, "test-setup.py"))
ts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ts)
check, run, setup_argv, EXT_ID, DEP_ID = ts.check, ts.run, ts.setup_argv, ts.EXT_ID, ts.DEP_ID


def cursor_code(s):
    """a Cursor.app bundle whose bin/code records any call; linked onto PATH as Cursor's "Install 'code' command" does"""
    b = os.path.join(s.apps, "Cursor.app", "Contents", "Resources", "app", "bin")
    os.makedirs(b)
    p = os.path.join(b, "code")
    with open(p, "w") as f:
        f.write('#!/bin/sh\necho "$@" >> "%s"\nexit 0\n' % os.path.join(s.dir, "cursor-called"))
    os.chmod(p, 0o755)
    return p


def cursor_called(s):
    return os.path.exists(os.path.join(s.dir, "cursor-called"))


def vscode_bundle(s):
    b = os.path.join(s.apps, "Visual Studio Code.app", "Contents", "Resources", "app", "bin")
    os.makedirs(b)
    with open(os.path.join(b, "code"), "w") as f:
        f.write(ts.FAKE_CODE)
    os.chmod(os.path.join(b, "code"), 0o755)
    return os.path.join(b, "code")


def main(base):
    here = ROOT

    print("== another editor's code command")
    s = ts.Scratch(base, "cursor-only", with_code=False)
    os.symlink(cursor_code(s), s.code)
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    check("Cursor's code on PATH, no VS Code: setup notes vscode-not-found, never runs Cursor's code, writes nothing",
          rc == 0 and out.startswith("note [vscode-not-found]:") and not cursor_called(s) and not os.path.exists(s.state)
          and not os.path.exists(os.path.join(s.user, "tasks.json")), out + err)

    s = ts.Scratch(base, "cursor-and-vscode", with_code=False)
    os.symlink(cursor_code(s), s.code)
    vs = vscode_bundle(s)
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    calls = s.argv_calls()
    check("Cursor's code first on PATH, VS Code.app present: VS Code's own command is used, Cursor's never runs",
          rc == 0 and calls and calls[0] == [vs, "--list-extensions"] and not cursor_called(s)
          and s.installed() == [EXT_ID, DEP_ID] and os.path.exists(os.path.join(s.user, "tasks.json")), out + err + repr(calls[:1]))

    s = ts.Scratch(base, "cursor-explicit", with_code=False)
    cc = cursor_code(s)
    rc, out, err = run(setup_argv(here, s, "--code", cc, user_dir=False), s.env(code_on_path=False))
    check("--code at Cursor's bundled code: unknown editor note, nothing run or written",
          rc == 0 and out.startswith("note [vscode-not-found]:") and "is not a command of Visual Studio Code" in out and not cursor_called(s)
          and not os.path.exists(s.state), out + err)

    s = ts.Scratch(base, "cursor-remove")
    rc, out, err = run(setup_argv(here, s, user_dir=False), s.env())
    vs_code = s.code
    os.unlink(vs_code)
    os.symlink(cursor_code(s), vs_code)
    rc, out, err = run(setup_argv(here, s, "--remove", user_dir=False), s.env())
    check("record says Code, only Cursor's code is left: removal never runs Cursor's code and keeps the record",
          not cursor_called(s) and "note [vscode-not-found]:" in out and os.path.exists(s.state), out + err)

    print("== supported editor aliases retain their actual editor identity")
    s = ts.Scratch(base, "insiders-alias", with_code=False)
    bundle = os.path.join(s.apps, "Visual Studio Code - Insiders.app", "Contents", "Resources", "app", "bin")
    os.makedirs(bundle)
    command = os.path.join(bundle, "code-insiders")
    with open(command, "w") as f:
        f.write("#!/bin/sh\nexit 0\n")
    os.chmod(command, 0o755)
    os.symlink(command, s.code)
    helper_spec = importlib.util.spec_from_file_location("setup_under_test", os.path.join(ROOT, "templates", "vscode_setup.py"))
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    check("code alias into Insiders is not selected for a Code removal",
          helper.find_code(s.bin, [], editor="Code") is None)
    check("unrestricted setup identifies the alias as Insiders",
          helper.editor_of(helper.find_code(s.bin, [])) == "Code - Insiders")

    print("== a skipped profile keeps what the record proved")
    s = ts.Scratch(base, "profile-skip")
    real = os.path.join(s.dir, "real")
    os.makedirs(real)
    os.rename(s.code, os.path.join(real, "code"))
    with open(s.code, "w") as f:
        f.write('#!/bin/sh\nif [ -n "$FAILP" ] && [ "$1" = --profile ]; then echo "profile list broken" >&2; exit 3; fi\nexec "%s" "$@"\n'
                % os.path.join(real, "code"))
    os.chmod(s.code, 0o755)
    os.makedirs(os.path.join(s.user, "globalStorage"))
    os.makedirs(os.path.join(s.user, "profiles", "abc1"))
    with open(os.path.join(s.user, "globalStorage", "storage.json"), "w") as f:
        json.dump({"userDataProfiles": [{"name": "Lab", "location": "abc1"}]}, f)
    rc1, out1, err1 = run(setup_argv(here, s, user_dir=False), s.env())
    first = json.load(open(s.state))["profiles"]
    rc2, out2, err2 = run(setup_argv(here, s, user_dir=False), s.env(extra={"FAILP": "1"}))
    second = json.load(open(s.state))["profiles"]
    check("rerun with profile Lab's --list-extensions failing: Lab's ownership stays in the record",
          rc1 == 0 and rc2 == 0 and first and second == first and "profile Lab was skipped" in out2, out1 + out2 + err2 + json.dumps(second))
    rc, out, err = run(setup_argv(here, s, "--remove", user_dir=False), s.env())
    lab = open(s.store + "@Lab").read().split()
    check("then --remove takes the companion and the dependency dewfpga installed in Lab",
          rc == 0 and lab == [] and "removed: VS Code extension %s in profile Lab" % EXT_ID in out, out + err + repr(lab))

    print("passed %d, failed %d" % (ts.passed, ts.failed))
    return 1 if ts.failed else 0


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="dewfpga-editor-test.") as base:
        sys.exit(main(base))
