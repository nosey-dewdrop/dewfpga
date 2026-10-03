#!/usr/bin/env python3
"""Tests for templates/vscode_tasks.py. Uses only scratch directories; never touches a real VS Code User dir.
Last line: `passed N, failed M`; exit 1 when M > 0."""
import json, os, re, shutil, subprocess, sys, tempfile, stat
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WRITER = os.path.join(ROOT, "templates", "vscode_tasks.py")
FIX = os.path.join(HERE, "fixtures", "tasks")
sys.path.insert(0, os.path.join(ROOT, "templates"))
import vscode_tasks as vt  # noqa: E402

ENV = dict(os.environ, LC_ALL="C", LC_CTYPE="C", LANG="C")
results = []


def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("ok   " if cond else "FAIL ") + name + ("" if cond or not info else "\n     " + str(info)[:600]))


def run(*args):
    p = subprocess.run([sys.executable, WRITER] + list(args), capture_output=True, text=True, env=ENV)
    return p.returncode, p.stdout + p.stderr


def read(p):
    with open(p, "rb") as f:
        return f.read()


def write(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode())


def parse(p):
    return vt.parse_jsonc(read(p).decode())


def tasks_of(p):
    return [t.value for t in vt.find_entry(parse(p), "tasks").elements]


def labels(p):
    return [t.get("label") for t in tasks_of(p)]


TMP = tempfile.mkdtemp(prefix="dewfpga vscode test ")  # path with spaces on purpose
CLI = os.path.join(TMP, "bin dir", "dew fpga")
write(CLI, "#!/bin/sh\nexit 0\n")
os.chmod(CLI, 0o755)


def user_dir(name, fixture=None):
    d = os.path.join(TMP, name, "User")
    os.makedirs(d)
    if fixture:
        shutil.copy(os.path.join(FIX, fixture), os.path.join(d, "tasks.json"))
    return d


# 1. --print and the problem matcher
rc, out = run("--cli", CLI, "--print")
doc = json.loads(out)
check("print: valid JSON with 3 tasks and 1 input", rc == 0 and len(doc["tasks"]) == 3 and len(doc["inputs"]) == 1, out)
check("print: tasks are process tasks running the absolute cli with ${input:dewfpgaTop}",
      all(t["type"] == "process" and t["command"] == CLI and t["args"][1] == "${input:dewfpgaTop}" for t in doc["tasks"]))
check("print: verbs flash/sim/bit, env DEWFPGA_ABSPATH=1, cwd ${fileDirname}",
      [t["args"][0] for t in doc["tasks"]] == ["flash", "sim", "bit"]
      and all(t["options"]["env"]["DEWFPGA_ABSPATH"] == "1" and t["options"]["cwd"] == "${fileDirname}" for t in doc["tasks"]))
check("print: flash is the default build task; others have no group",
      doc["tasks"][0]["group"] == {"kind": "build", "isDefault": True} and all("group" not in t for t in doc["tasks"][1:]))
check("print: input calls dewfpga.pickTop", doc["inputs"][0] == {"id": "dewfpgaTop", "type": "command", "command": "dewfpga.pickTop"})
check("print: simulate label matches the extension's fresh-waveform detector",
      re.match(r"^(dewfpga|FPGA): simulate\b", doc["tasks"][1]["label"]))
rx = re.compile(doc["tasks"][0]["problemMatcher"]["pattern"]["regexp"])
samples = [("top.sv:12: ERROR [undefined-name]: x is not declared. Fix: declare it", "top.sv", "12", "ERROR", "undefined-name"),
           ("/a b/c.v:7: warning [latch]: q becomes a latch", "/a b/c.v", "7", "warning", "latch"),
           ("tb.sv:1: note [slang-reader]: read with yosys-slang", "tb.sv", "1", "note", "slang-reader")]
ok = all((m := rx.match(s)) and (m.group(1), m.group(2), m.group(3), m.group(4)) == tuple(exp) for s, *exp in samples)
check("matcher: regexp captures file/line/severity/code on ERROR, warning and note lines", ok)
check("matcher: does not match make noise", not rx.match("make: *** [bit] Error 1") and not rx.match("yosys: ok"))

# 2. fresh file in a path with spaces, idempotence, remove deletes what it created
d = user_dir("fresh")
rc, out = run("--cli", CLI, "--user-dir", d)
tp, mp = os.path.join(d, "tasks.json"), os.path.join(d, vt.MANIFEST_NAME)
check("fresh: creates tasks.json and manifest, exit 0", rc == 0 and os.path.exists(tp) and os.path.exists(mp), out)
check("fresh: manifest records created_file and cli", json.load(open(mp))["created_file"] is True and json.load(open(mp))["cli"] == CLI)
before = read(tp)
rc, out = run("--cli", CLI, "--user-dir", d)
check("fresh: second run is a no-op (unchanged, same bytes, no backup)", rc == 0 and "unchanged" in out and read(tp) == before
      and not os.path.exists(tp + ".dewfpga-bak"), out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("fresh: --remove deletes the file it created and the manifest", rc == 0 and not os.path.exists(tp) and not os.path.exists(mp), out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("fresh: --remove twice is harmless", rc == 0 and "nothing to remove" in out, out)

# 3. JSONC with comments, trailing commas, escapes and a user default build task
d = user_dir("commented", "commented.json")
tp = os.path.join(d, "tasks.json")
orig = read(tp)
rc, out = run("--cli", CLI, "--user-dir", d)
txt = read(tp).decode()
check("jsonc: install exits 0 and the result parses", rc == 0 and parse(tp), out)
check("jsonc: comments, trailing commas and escaped string survive",
      all(s in txt for s in ["// my tasks", "/* inline */", "// after", '"echo \\"hi\\\\n\\""', "}, // after"]))
check("jsonc: user task kept first, three owned tasks appended", labels(tp) == ["echo hi"] + [l for l, _, _ in vt.TASK_SPECS])
flash = tasks_of(tp)[1]
check("jsonc: flash does not steal the user's default build (group is plain \"build\")", flash.get("group") == "build")
check("jsonc: note explains the Cmd+Shift+B chooser", "note:" in out and "echo hi" in out, out)
check("jsonc: backup of the original exists and is byte-identical", read(tp + ".dewfpga-bak") == orig)
after1 = read(tp)
rc, out = run("--cli", CLI, "--user-dir", d)
check("jsonc: idempotent (unchanged, same bytes)", rc == 0 and "unchanged" in out and read(tp) == after1, out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("jsonc: --remove restores the original bytes exactly", rc == 0 and read(tp) == orig, out + "\n" + read(tp).decode())
check("jsonc: --remove keeps the backup and drops the manifest",
      os.path.exists(tp + ".dewfpga-bak") and not os.path.exists(os.path.join(d, vt.MANIFEST_NAME)))

# 4. tab-indented file without inputs key: indent is copied, inputs key added then removed again
d = user_dir("plain", "plain.json")
tp = os.path.join(d, "tasks.json")
orig = read(tp)
rc, out = run("--cli", CLI, "--user-dir", d)
txt = read(tp).decode()
check("plain: tab indentation copied and inputs key added", rc == 0 and '\n\t\t\t"label": "dewfpga: flash' in txt and '"inputs"' in txt, txt)
check("plain: no user default build, so flash becomes the default build task", tasks_of(tp)[1]["group"] == {"kind": "build", "isDefault": True})
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("plain: --remove restores the original bytes", rc == 0 and read(tp) == orig, read(tp).decode())

# 5. corrupt file: nonzero, byte-preserved, nothing else created
d = user_dir("corrupt", "corrupt.json")
tp = os.path.join(d, "tasks.json")
orig = read(tp)
rc, out = run("--cli", CLI, "--user-dir", d)
check("corrupt: exit 1 with the error code and a Fix line", rc == 1 and "ERROR [vscode-tasks-unreadable]" in out and "Fix:" in out and "--print" in out, out)
check("corrupt: bytes preserved, no backup, no manifest", read(tp) == orig and sorted(os.listdir(d)) == ["tasks.json"])

# 6. unowned collisions are refused
for fx, what in (("collision-task.json", "unmarked task with our label"), ("collision-input.json", "foreign dewfpgaTop input")):
    d = user_dir("coll-" + fx, fx)
    tp = os.path.join(d, "tasks.json")
    orig = read(tp)
    rc, out = run("--cli", CLI, "--user-dir", d)
    check("collision: %s refused with conflict text, file untouched" % what,
          rc == 1 and "conflict" in out and read(tp) == orig and sorted(os.listdir(d)) == ["tasks.json"], out)

# 7. user edits an owned entry: update keeps it with a note, remove keeps it too
d = user_dir("edited")
tp = os.path.join(d, "tasks.json")
run("--cli", CLI, "--user-dir", d)
txt = read(tp).decode().replace('"sim",', '"sim", "--vcd",', 1)
write(tp, txt)
rc, out = run("--cli", CLI, "--user-dir", d)
check("edited: update keeps the edited task and says so", rc == 0 and "edited" in out and '"--vcd"' in read(tp).decode(), out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
left = labels(tp)
check("edited: --remove keeps the edited task, removes the pristine ones, explains",
      rc == 0 and left == ["dewfpga: simulate"] and "kept task" in out and os.path.exists(tp), out + "\n" + str(left))
check("edited: --remove does not delete a file that still holds user content", os.path.exists(tp))

# 8. new cli path: owned pristine tasks are regenerated, user text untouched
d = user_dir("recli", "commented.json")
tp = os.path.join(d, "tasks.json")
run("--cli", CLI, "--user-dir", d)
cli2 = os.path.join(TMP, "bin dir", "dewfpga2")
write(cli2, "#!/bin/sh\nexit 0\n"); os.chmod(cli2, 0o755)
rc, out = run("--cli", cli2, "--user-dir", d)
check("recli: moving the cli rewrites owned tasks only", rc == 0 and all(t["command"] == cli2 for t in tasks_of(tp)[1:])
      and "// my tasks" in read(tp).decode() and labels(tp)[0] == "echo hi", out)

# 9. symlinks are refused
d = user_dir("symlink")
real = os.path.join(TMP, "elsewhere.json")
write(real, '{"version":"2.0.0","tasks":[]}\n')
os.symlink(real, os.path.join(d, "tasks.json"))
rc, out = run("--cli", CLI, "--user-dir", d)
check("symlink: tasks.json symlink refused, target untouched", rc == 1 and "symbolic link" in out and read(real) == b'{"version":"2.0.0","tasks":[]}\n', out)
d = user_dir("symlink-manifest", "plain.json")
os.symlink(real, os.path.join(d, vt.MANIFEST_NAME))
orig = read(os.path.join(d, "tasks.json"))
rc, out = run("--cli", CLI, "--user-dir", d)
check("symlink: manifest symlink refused, tasks.json untouched", rc == 1 and "symbolic link" in out and read(os.path.join(d, "tasks.json")) == orig, out)

# 10. failed write leaves the original intact
d = user_dir("readonly", "plain.json")
tp = os.path.join(d, "tasks.json")
orig = read(tp)
if os.geteuid() == 0:
    check("readonly: skipped (running as root)", True)
else:
    os.chmod(d, 0o555)
    rc, out = run("--cli", CLI, "--user-dir", d)
    os.chmod(d, 0o755)
    check("readonly: write failure reported, exit 1, original bytes intact, no stray temp files",
          rc == 1 and "ERROR" in out and read(tp) == orig and sorted(os.listdir(d)) == ["tasks.json"], out + str(os.listdir(d)))

# 11. backups are never clobbered
d = user_dir("backup", "plain.json")
tp = os.path.join(d, "tasks.json")
write(tp + ".dewfpga-bak", "precious\n")
rc, out = run("--cli", CLI, "--user-dir", d)
check("backup: an existing different backup is kept; a numbered one is created",
      rc == 0 and read(tp + ".dewfpga-bak") == b"precious\n" and os.path.exists(tp + ".dewfpga-bak.1"), out + str(os.listdir(d)))

# 12. discovery: profiles enumerated, nothing created, no targets is a note with exit 0
home = os.path.join(TMP, "home")
mk = lambda *p: os.makedirs(os.path.join(home, "Library", "Application Support", *p))
mk("Code", "User", "profiles", "work")
mk("Code", "User", "profiles", "-1a2b")
mk("VSCodium", "User")
rc, out = run("--cli", CLI, "--home", home)
found = [os.path.relpath(l.split(" (")[0].replace("wrote ", ""), home) for l in out.splitlines() if l.startswith("wrote ")]
check("discover: default User dirs and every profiles/* dir get tasks.json; Insiders is not created",
      rc == 0 and sorted(found) == sorted(["Library/Application Support/Code/User/tasks.json",
                                           "Library/Application Support/Code/User/profiles/-1a2b/tasks.json",
                                           "Library/Application Support/Code/User/profiles/work/tasks.json",
                                           "Library/Application Support/VSCodium/User/tasks.json"])
      and not os.path.exists(os.path.join(home, "Library", "Application Support", "Code - Insiders")), out)
rc, out = run("--cli", CLI, "--home", os.path.join(TMP, "emptyhome"))
check("discover: no editor found prints a note and exits 0", rc == 0 and "no VS Code user directory found" in out, out)

# 13. argument checks
rc, out = run("--cli", "bin/dewfpga", "--user-dir", d)
check("args: relative --cli rejected with exit 2", rc == 2, out)
rc, out = run("--cli", os.path.join(TMP, "missing"), "--user-dir", d)
check("args: non-executable --cli rejected with exit 2", rc == 2, out)
rc, out = run("--cli", os.path.join(TMP, "missing"), "--user-dir", user_dir("rm-missing-cli"), "--remove")
check("args: --remove works even when the cli is already gone", rc == 0, out)

# 14. in-process parser edge cases
for src, want in [('{"a":"\\u00e9\\"\\\\",}', {"a": "é\"\\"}), ("[1,/*x*/2,//y\n]", [1, 2]), ('{"k": [true,null,-1.5e3]}', {"k": [True, None, -1500.0]})]:
    check("parser: %r" % src, vt.parse_jsonc(src).value == want)
for bad in ["{", '{"a":1 "b":2}', "[1,,2]", '"unterminated', "{/* open"]:
    try:
        vt.parse_jsonc(bad); check("parser rejects %r" % bad, False)
    except vt.JsoncError:
        check("parser rejects %r" % bad, True)

# Root counterexamples: matching a template is not proof of ownership.
d = user_dir("comment-only")
tp = os.path.join(d, "tasks.json")
original = b"{ /* keep my explanation */ }\n"
write(tp, original)
rc, out = run("--cli", CLI, "--user-dir", d)
check("comment-only object: installation preserves the existing comment", rc == 0 and b"keep my explanation" in read(tp), out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("comment-only object: removal still preserves the comment", rc == 0 and b"keep my explanation" in read(tp), out)

d = user_dir("unowned-matching-input")
tp = os.path.join(d, "tasks.json")
original = json.dumps({"version": "2.0.0", "tasks": [], "inputs": [vt.make_input()]}).encode()
write(tp, original)
rc, out = run("--cli", CLI, "--user-dir", d)
check("unowned matching input: installation refuses without changing bytes", rc == 1 and read(tp) == original, out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("unowned matching input: removal preserves it", rc == 0 and read(tp) == original, out)

d = user_dir("edited-command")
run("--cli", CLI, "--user-dir", d)
tp = os.path.join(d, "tasks.json")
v = json.loads(read(tp))
v["tasks"][0]["command"] = "/custom/user-choice"
write(tp, json.dumps(v))
rc, out = run("--cli", CLI, "--user-dir", d)
check("edited command: update preserves the user's replacement", rc == 0 and b"/custom/user-choice" in read(tp), out)
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("edited command: removal preserves the user's replacement", rc == 0 and os.path.exists(tp) and b"/custom/user-choice" in read(tp), out)

d = user_dir("edited-version")
run("--cli", CLI, "--user-dir", d)
tp = os.path.join(d, "tasks.json")
v = json.loads(read(tp)); v["version"] = "user-changed"
write(tp, json.dumps(v))
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("edited version: removal preserves it", rc == 0 and os.path.exists(tp) and b"user-changed" in read(tp), out)

# A failed second file commit must not leave changed tasks without their ownership record.
for existing in (False, True):
    d = user_dir("pair-failure-" + str(existing))
    tp, mp = os.path.join(d, "tasks.json"), os.path.join(d, vt.MANIFEST_NAME)
    if existing:
        run("--cli", CLI, "--user-dir", d)
    old_tasks = read(tp) if os.path.exists(tp) else None
    old_manifest = read(mp) if os.path.exists(mp) else None
    real_replace = vt.os.replace
    def fail_manifest_replace(src, dst):
        if dst == mp:
            raise OSError("injected manifest rename failure")
        return real_replace(src, dst)
    try:
        vt.os.replace = fail_manifest_replace
        try:
            vt.process_target(d, CLI + "-updated", False, lambda line: None)
            caught = False
        except OSError:
            caught = True
    finally:
        vt.os.replace = real_replace
    got_tasks = read(tp) if os.path.exists(tp) else None
    got_manifest = read(mp) if os.path.exists(mp) else None
    check("paired write failure restores both originals (existing=%s)" % existing,
          caught and got_tasks == old_tasks and got_manifest == old_manifest)
    check("paired write failure leaves no temporary files (existing=%s)" % existing,
          not any(name.endswith(".tmp") for name in os.listdir(d)))

# Independent review followups: malformed ownership is an actionable error, not a traceback.
for field, bad in (("tasks", []), ("added_keys", 5)):
    d = user_dir("bad-manifest-" + field)
    run("--cli", CLI, "--user-dir", d)
    tp, mp = os.path.join(d, "tasks.json"), os.path.join(d, vt.MANIFEST_NAME)
    original = read(tp)
    m = json.loads(read(mp)); m[field] = bad; write(mp, json.dumps(m))
    later = user_dir("later-" + field)
    rc, out = run("--cli", CLI, "--user-dir", d, "--user-dir", later)
    check("malformed manifest %s refuses cleanly and still visits the next profile" % field,
          rc == 1 and "Traceback" not in out and "ERROR [vscode-tasks-unreadable]" in out
          and read(tp) == original and os.path.exists(os.path.join(later, "tasks.json")), out)
    rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
    check("malformed manifest %s: remove refuses without changing tasks" % field,
          rc == 1 and "Traceback" not in out and read(tp) == original, out)

d = user_dir("missing-manifest")
run("--cli", CLI, "--user-dir", d)
tp = os.path.join(d, "tasks.json"); original = read(tp)
os.unlink(os.path.join(d, vt.MANIFEST_NAME))
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("missing manifest: preserve entries and accurately report unverified ownership",
      rc == 0 and read(tp) == original and "no verified owned entries" in out and "was edited" not in out, out)

d = user_dir("user-task-keeps-version")
run("--cli", CLI, "--user-dir", d)
tp = os.path.join(d, "tasks.json"); v = json.loads(read(tp))
v["tasks"].append({"label": "my build", "type": "process", "command": "true"})
write(tp, json.dumps(v))
rc, out = run("--cli", CLI, "--user-dir", d, "--remove")
check("user-added task retains the required document version on remove",
      rc == 0 and parse(tp).value.get("version") == "2.0.0" and labels(tp) == ["my build"], out)

d = user_dir("duplicate-nested-key")
tp = os.path.join(d, "tasks.json")
original = b'{"tasks":[{"label":"my build","command":"keep","command":"other"}]}\n'
write(tp, original)
rc, out = run("--cli", CLI, "--user-dir", d)
check("duplicate keys within a task refuse without losing either value", rc == 1 and read(tp) == original and "duplicate object key" in out, out)
check("configuration error includes location, code, fix and documentation link",
      bool(re.search(r"tasks\.json:1: ERROR \[vscode-tasks-unreadable\]: .*Fix: .*errors/vscode-tasks-unreadable/", out)), out)

shutil.rmtree(TMP, ignore_errors=True)
n_fail = sum(1 for _, ok in results if not ok)
print("passed %d, failed %d" % (len(results) - n_fail, n_fail))
sys.exit(1 if n_fail else 0)
