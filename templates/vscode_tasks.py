#!/usr/bin/env python3
"""dewfpga: write (or remove) three user-level VS Code tasks.

    python3 vscode_tasks.py --cli /abs/path/to/dewfpga [--user-dir DIR]... [--remove | --print]

Targets: every DIR given with --user-dir, or (macOS, nothing given) the existing
~/Library/Application Support/{Code,Code - Insiders,VSCodium}/User directories and
their existing User/profiles/*/ directories. Nothing is created for an editor that
is not installed.

Each target gets <DIR>/tasks.json edited as text (JSONC aware: comments, trailing
commas and the user's own tasks/inputs are kept byte for byte) plus a sidecar
<DIR>/.dewfpga-tasks.json that records what this writer put there. On a later run
or on --remove only entries that are still exactly what the writer wrote are
replaced or removed; anything the user edited is left in place and reported.
An unreadable tasks.json, or a user task/input that collides with ours, is never
touched: the run says why and exits 1.

Exit codes: 0 done (or nothing to do), 1 a target was refused, 2 bad arguments.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import stat
import sys
import tempfile

MARKER = "added by dewfpga vscode"
INPUT_ID = "dewfpgaTop"
MANIFEST_NAME = ".dewfpga-tasks.json"
BACKUP_NAME = "tasks.json.dewfpga-bak"
MATCHER_REGEXP = r"^(.+?):(\d+): (ERROR|warning|note) \[([a-z0-9-]+)\]: (.*)$"
EDITORS = ("Code", "Code - Insiders", "VSCodium")

TASK_SPECS = (
    ("dewfpga: flash (build + program)", "flash", True),
    ("dewfpga: simulate", "sim", False),
    ("dewfpga: build only", "bit", False),
)
OUR_LABELS = tuple(s[0] for s in TASK_SPECS)


# ----------------------------------------------------------------------------- JSONC
class JsoncError(ValueError):
    pass


class Node:
    __slots__ = ("kind", "start", "end", "value", "entries", "elements", "open", "close", "comma_end", "has_comment")

    def __init__(self, kind, start):
        self.kind = kind
        self.start = start
        self.end = start
        self.value = None
        self.entries = []      # objects: list of (key_node, value_node)
        self.elements = []     # arrays: list of value nodes
        self.open = start      # index of '{' or '['
        self.close = start     # index of '}' or ']'
        self.comma_end = None  # index just past the comma that follows this value (arrays/objects members)
        self.has_comment = False


class Parser:
    """Recursive-descent JSONC parser that keeps byte offsets for every value."""

    def __init__(self, text):
        self.t = text
        self.n = len(text)
        self.i = 0
        self.saw_comment = False

    def err(self, msg):
        line = self.t.count("\n", 0, self.i) + 1
        col = self.i - (self.t.rfind("\n", 0, self.i) + 1) + 1
        raise JsoncError("line %d column %d: %s" % (line, col, msg))

    def skip(self):
        t, n = self.t, self.n
        while self.i < n:
            c = t[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif t.startswith("//", self.i):
                self.saw_comment = True
                j = t.find("\n", self.i)
                self.i = n if j < 0 else j
            elif t.startswith("/*", self.i):
                self.saw_comment = True
                j = t.find("*/", self.i + 2)
                if j < 0:
                    self.err("unterminated block comment")
                self.i = j + 2
            else:
                return

    def parse_document(self):
        self.skip()
        if self.i >= self.n:
            self.err("empty document")
        node = self.parse_value()
        self.skip()
        if self.i != self.n:
            self.err("text after the top-level value")
        return node

    def parse_value(self):
        t = self.t
        if self.i >= self.n:
            self.err("unexpected end of file")
        c = t[self.i]
        if c == "{":
            return self.parse_object()
        if c == "[":
            return self.parse_array()
        if c == '"':
            return self.parse_string()
        for lit, val in (("true", True), ("false", False), ("null", None)):
            if t.startswith(lit, self.i):
                node = Node("literal", self.i)
                self.i += len(lit)
                node.end = self.i
                node.value = val
                return node
        if c in "-0123456789":
            return self.parse_number()
        self.err("unexpected character %r" % c)

    def parse_number(self):
        t, s = self.t, self.i
        j = s
        if t[j] == "-":
            j += 1
        while j < self.n and t[j] in "0123456789.eE+-":
            j += 1
        raw = t[s:j]
        try:
            val = json.loads(raw)
        except ValueError:
            self.i = s
            self.err("bad number %r" % raw)
        node = Node("number", s)
        self.i = j
        node.end = j
        node.value = val
        return node

    def parse_string(self):
        t, s = self.t, self.i
        j = s + 1
        while True:
            if j >= self.n:
                self.i = s
                self.err("unterminated string")
            c = t[j]
            if c == "\\":
                j += 2
                continue
            if c == '"':
                break
            if c == "\n":
                self.i = s
                self.err("newline inside a string")
            j += 1
        raw = t[s:j + 1]
        try:
            val = json.loads(raw)
        except ValueError:
            self.i = s
            self.err("bad string escape in %s" % raw)
        node = Node("string", s)
        self.i = j + 1
        node.end = self.i
        node.value = val
        return node

    def parse_array(self):
        node = Node("array", self.i)
        node.open = self.i
        self.i += 1
        before = self.saw_comment
        self.saw_comment = False
        while True:
            self.skip()
            if self.i >= self.n:
                self.err("unterminated array")
            if self.t[self.i] == "]":
                break
            el = self.parse_value()
            node.elements.append(el)
            self.skip()
            if self.i >= self.n:
                self.err("unterminated array")
            c = self.t[self.i]
            if c == ",":
                self.i += 1
                el.comma_end = self.i
                continue
            if c == "]":
                break
            self.err("expected ',' or ']' in array")
        node.close = self.i
        self.i += 1
        node.end = self.i
        node.value = [e.value for e in node.elements]
        node.has_comment = self.saw_comment
        self.saw_comment = before or self.saw_comment
        return node

    def parse_object(self):
        node = Node("object", self.i)
        node.open = self.i
        self.i += 1
        before = self.saw_comment
        self.saw_comment = False
        value = {}
        while True:
            self.skip()
            if self.i >= self.n:
                self.err("unterminated object")
            if self.t[self.i] == "}":
                break
            if self.t[self.i] != '"':
                self.err("expected a string key")
            key = self.parse_string()
            if key.value in value:
                self.err("duplicate object key %r" % key.value)
            self.skip()
            if self.i >= self.n or self.t[self.i] != ":":
                self.err("expected ':' after key")
            self.i += 1
            self.skip()
            val = self.parse_value()
            node.entries.append((key, val))
            value[key.value] = val.value
            self.skip()
            if self.i >= self.n:
                self.err("unterminated object")
            c = self.t[self.i]
            if c == ",":
                self.i += 1
                val.comma_end = self.i
                continue
            if c == "}":
                break
            self.err("expected ',' or '}' in object")
        node.close = self.i
        self.i += 1
        node.end = self.i
        node.value = value
        node.has_comment = self.saw_comment
        self.saw_comment = before or self.saw_comment
        return node


def parse_jsonc(text):
    return Parser(text).parse_document()


# ----------------------------------------------------------------------------- content
def problem_matcher():
    return {
        "owner": "dewfpga",
        "source": "dewfpga",
        "severity": "info",
        "fileLocation": ["autoDetect", "${fileDirname}"],
        "pattern": {
            "regexp": MATCHER_REGEXP,
            "file": 1,
            "line": 2,
            "severity": 3,
            "code": 4,
            "message": 5,
        },
    }


def make_task(label, verb, cli, default_build):
    task = {
        "label": label,
        "type": "process",
        "command": cli,
        "args": [verb, "${input:" + INPUT_ID + "}"],
        "options": {"cwd": "${fileDirname}", "env": {"DEWFPGA_ABSPATH": "1"}},
    }
    if verb == "flash":
        task["group"] = {"kind": "build", "isDefault": True} if default_build else "build"
    task["presentation"] = {"reveal": "always", "panel": "dedicated", "clear": True}
    task["problemMatcher"] = problem_matcher()
    task["detail"] = MARKER
    return task


def make_input():
    return {"id": INPUT_ID, "type": "command", "command": "dewfpga.pickTop"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def fresh_document(cli, indent):
    doc = {
        "version": "2.0.0",
        "tasks": [make_task(l, v, cli, d) for l, v, d in TASK_SPECS],
        "inputs": [make_input()],
    }
    return json.dumps(doc, indent=indent, ensure_ascii=False) + "\n"


# ----------------------------------------------------------------------------- text edits
def line_start(text, pos):
    """Offset of the first non-blank character's line start if `pos` begins its line, else pos."""
    j = pos
    while j > 0 and text[j - 1] in " \t":
        j -= 1
    if j == 0 or text[j - 1] == "\n":
        return j
    return pos


def begins_line(text, pos):
    ls = line_start(text, pos)
    return ls == 0 or text[ls - 1] == "\n"


def line_end(text, pos):
    """Offset past trailing blanks and one newline after `pos`, if only blanks follow on the line."""
    j = pos
    while j < len(text) and text[j] in " \t":
        j += 1
    if j < len(text) and text[j] == "\r" and j + 1 < len(text) and text[j + 1] == "\n":
        return j + 2
    if j < len(text) and text[j] == "\n":
        return j + 1
    if j >= len(text):
        return j
    return pos


def removal_ranges(text, elements, victims):
    """Ranges that delete `victims` (indexes into `elements`, each a value node or a
    (start, end, comma_end) span) together with the commas that belong to them."""
    spans = [(e.start, e.end, e.comma_end) if isinstance(e, Node) else e for e in elements]
    ranges = []
    for i, (start, end, comma_end) in enumerate(spans):
        if i not in victims:
            continue
        if comma_end is not None:
            ranges.append((line_start(text, start), line_end(text, comma_end)))
        else:
            # last element without a trailing comma: drop it and the comma of the nearest kept predecessor
            ranges.append((line_start(text, start), line_end(text, end)))
            k = i - 1
            while k >= 0 and k in victims:
                k -= 1
            if k >= 0:
                prev_comma = spans[k][2]
                ranges.append((prev_comma - 1, prev_comma))
    return ranges


def indent_of_line(text, pos):
    j = line_start(text, pos)
    return text[j:pos] if j != pos or pos == 0 or text[pos - 1] == "\n" else ""


def detect_indent(text, container):
    """(element indent, unit) for inserting into `container` (array/object node)."""
    for el in (container.elements or [v for _, v in container.entries]):
        s = el.start if container.kind == "array" else None
        if container.kind == "object":
            s = [k for k, v in container.entries if v is el][0].start
        ls = line_start(text, s)
        if begins_line(text, s):
            ind = text[ls:s]
            close_ind = text[line_start(text, container.close):container.close]
            if ind.startswith(close_ind) and len(ind) > len(close_ind):
                return ind, ind[len(close_ind):]
            return ind, ind if ind else "  "
    close_ind = text[line_start(text, container.close):container.close] if begins_line(text, container.close) else ""
    unit = "    " if "\t" not in close_ind else "\t"
    return close_ind + unit, unit


def render_values(values, indent, unit):
    out = []
    for v in values:
        s = json.dumps(v, indent=unit, ensure_ascii=False)
        out.append("\n".join(indent + ln if ln else ln for ln in s.split("\n")))
    return out


def append_ranges(text, array, values, victims=frozenset()):
    """Insertions that append `values` at the end of `array`, given that the elements whose
    indexes are in `victims` are being removed by removal_ranges() at the same time."""
    if not values:
        return []
    indent, unit = detect_indent(text, array)
    rendered = render_values(values, indent, unit)
    ins = []
    close_ls = line_start(text, array.close)
    close_alone = begins_line(text, array.close)
    kept = [i for i in range(len(array.elements)) if i not in victims]
    if not kept:
        multiline = "\n" in text[array.open:array.close]
        if multiline and close_alone:
            ins.append((close_ls, ",\n".join(rendered) + "\n"))
        elif multiline:
            ins.append((array.close, "\n" + ",\n".join(rendered) + "\n" + indent[:max(0, len(indent) - len(unit))]))
        else:
            ins.append((array.open + 1, "\n" + ",\n".join(rendered) + "\n"))
        return ins
    last = array.elements[kept[-1]]
    # removal_ranges() deletes `last`'s comma when every later element goes and the final one had no comma
    comma_kept = last.comma_end is not None and not (kept[-1] < len(array.elements) - 1
                                                     and array.elements[-1].comma_end is None)
    body = ",\n".join(rendered)
    if comma_kept:
        if close_alone:
            ins.append((close_ls, body + ",\n"))
        else:
            ins.append((last.comma_end, "\n" + body + ","))
    else:
        ins.append((last.end, ","))
        if close_alone:
            ins.append((close_ls, body + "\n"))
        else:
            ins.append((last.end, "\n" + body + "\n"))
    return ins


def apply_edits(text, removals, insertions):
    """Apply (start,end) deletions and (pos,text) insertions; positions refer to the original text."""
    edits = [(a, b, "") for a, b in removals] + [(p, p, s) for p, s in insertions]
    edits.sort(key=lambda e: (e[0], e[1] - e[0] != 0))  # insertions before a removal that starts there
    out = []
    cursor = 0
    for a, b, s in edits:
        if a < cursor:
            if b <= cursor:
                continue
            a = cursor
        out.append(text[cursor:a])
        out.append(s)
        cursor = max(cursor, b)
    out.append(text[cursor:])
    return "".join(out)


# ----------------------------------------------------------------------------- ownership
class Refuse(Exception):
    def __init__(self, message, code="vscode-tasks-unreadable"):
        super().__init__(message)
        self.code = code


def element_is_pristine(node, expected_hashes):
    """Ownership requires a recorded value, not resemblance to our current template."""
    if node.has_comment:
        return False
    d = digest(node.value)
    return d in expected_hashes


def classify_tasks(text, tasks_node, manifest, cli, default_build):
    """Returns (victims, conflicts, kept_edited, defaults_elsewhere)."""
    victims, conflicts, edited = set(), [], []
    hashes = set(manifest.get("tasks", {}).values())
    for i, el in enumerate(tasks_node.elements):
        if el.kind != "object":
            continue
        v = el.value
        label = v.get("label")
        marked = v.get("detail") == MARKER
        if marked:
            if element_is_pristine(el, hashes):
                victims.add(i)
            else:
                edited.append(label if label is not None else "(task %d)" % (i + 1))
        elif label in OUR_LABELS:
            conflicts.append("task %r (no %r detail marker, so not ours)" % (label, MARKER))
    return victims, conflicts, edited


def classify_inputs(inputs_node, manifest):
    victims, conflicts, edited = set(), [], []
    hashes = set(manifest.get("inputs", {}).values())
    for i, el in enumerate(inputs_node.elements):
        if el.kind != "object" or el.value.get("id") != INPUT_ID:
            continue
        if element_is_pristine(el, hashes):
            victims.add(i)
        elif hashes:
            edited.append(INPUT_ID)
        else:
            conflicts.append("input id %r is already used by something that is not ours" % INPUT_ID)
    return victims, conflicts, edited


def other_default_build(tasks_node, victims):
    for i, el in enumerate(tasks_node.elements):
        if i in victims or el.kind != "object":
            continue
        g = el.value.get("group")
        if isinstance(g, dict) and g.get("kind") == "build" and g.get("isDefault") is True:
            return el.value.get("label", "(unnamed task)")
    return None


def find_entry(obj_node, key):
    hits = [(k, v) for k, v in obj_node.entries if k.value == key]
    if len(hits) > 1:
        raise Refuse("the key %r appears %d times; keep one" % (key, len(hits)))
    return hits[0][1] if hits else None


# ----------------------------------------------------------------------------- files
def refuse_symlink(path, what):
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(st.st_mode):
        raise Refuse("%s %s is a symbolic link; this writer only edits regular files" % (what, path))
    if not stat.S_ISREG(st.st_mode):
        raise Refuse("%s %s is not a regular file" % (what, path))
    return st


def read_text(path):
    with open(path, "rb") as f:
        raw = f.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise Refuse("%s is not UTF-8 (%s)" % (path, e))


def load_manifest(path):
    st = refuse_symlink(path, "manifest")
    if st is None:
        return {}
    try:
        m = json.loads(read_text(path))
    except (ValueError, Refuse) as e:
        raise Refuse("manifest %s is unreadable (%s); restore its backup or review the entries manually" % (path, e))
    if not isinstance(m, dict):
        raise Refuse("manifest %s is not a JSON object; restore its backup or review the entries manually" % path)
    valid = (type(m.get("version")) is int and m["version"] == 1
             and type(m.get("created_file")) is bool and isinstance(m.get("cli"), str)
             and isinstance(m.get("added_keys"), list)
             and all(isinstance(k, str) and k in ("version", "tasks", "inputs") for k in m["added_keys"]))
    for section in ("tasks", "inputs"):
        records = m.get(section)
        valid = valid and isinstance(records, dict)
        if isinstance(records, dict):
            valid = valid and all(isinstance(k, str) and isinstance(v, str)
                                  and re.fullmatch(r"[0-9a-f]{64}", v) for k, v in records.items())
    if not valid:
        raise Refuse("manifest %s has an unsupported schema; restore its backup or review the entries manually" % path)
    return m


def write_atomic(path, text, mode=None):
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".dewfpga-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(text.encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        if mode is not None:
            os.chmod(tmp, stat.S_IMODE(mode))
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_tasks_and_manifest(tasks_path, text, mode, manifest_path, manifest_text, old_text):
    """Prepare both files before changing either; roll back tasks if the manifest rename fails."""
    staged = []

    def prepare(target, value, file_mode=None):
        fd, tmp = tempfile.mkstemp(prefix=".dewfpga-", suffix=".tmp", dir=os.path.dirname(target))
        staged.append(tmp)
        with os.fdopen(fd, "wb") as f:
            f.write(value.encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        if file_mode is not None:
            os.chmod(tmp, stat.S_IMODE(file_mode))
        return tmp

    changed = False
    restore = None
    try:
        new_tasks = prepare(tasks_path, text, mode)
        new_manifest = prepare(manifest_path, manifest_text)
        if old_text is not None:
            restore = prepare(tasks_path, old_text, mode)
        os.replace(new_tasks, tasks_path)
        changed = True
        os.replace(new_manifest, manifest_path)
    except OSError as error:
        if changed:
            try:
                if restore is None:
                    os.unlink(tasks_path)
                else:
                    os.replace(restore, tasks_path)
            except OSError as rollback_error:
                if restore is not None:
                    staged.remove(restore)  # retain the recovery copy if restoring it is blocked
                raise OSError("%s; restoring tasks.json also failed: %s; recovery copy: %s" %
                              (error, rollback_error, restore or "none (tasks.json was newly created)")) from error
        raise
    finally:
        for tmp in staged:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass


def make_backup(user_dir, text):
    base = os.path.join(user_dir, BACKUP_NAME)
    cand = base
    k = 0
    while os.path.lexists(cand):
        if not os.path.islink(cand) and os.path.isfile(cand):
            with open(cand, "rb") as f:
                if f.read() == text.encode("utf-8"):
                    return cand, False
        k += 1
        cand = "%s.%d" % (base, k)
    write_atomic(cand, text)
    return cand, True


# ----------------------------------------------------------------------------- one target
def process_target(user_dir, cli, remove, out):
    user_dir = os.path.abspath(user_dir)
    if not os.path.isdir(user_dir):
        raise Refuse("%s is not a directory" % user_dir)
    tasks_path = os.path.join(user_dir, "tasks.json")
    manifest_path = os.path.join(user_dir, MANIFEST_NAME)
    st = refuse_symlink(tasks_path, "tasks file")
    manifest = load_manifest(manifest_path)
    notes = []

    if st is None:
        if remove:
            if os.path.exists(manifest_path):
                os.unlink(manifest_path)
                out("removed %s (tasks.json was already gone)" % manifest_path)
            else:
                out("nothing to remove in %s" % user_dir)
            return
        text = fresh_document(cli, 4)
        new_manifest = {
            "version": 1,
            "created_file": True,
            "cli": cli,
            "added_keys": ["version", "tasks", "inputs"],
            "tasks": {l: digest(make_task(l, v, cli, d)) for l, v, d in TASK_SPECS},
            "inputs": {INPUT_ID: digest(make_input())},
        }
        write_tasks_and_manifest(tasks_path, text, None, manifest_path,
                                 json.dumps(new_manifest, indent=2, sort_keys=True) + "\n", None)
        out("wrote %s (new file: 3 tasks, 1 input)" % tasks_path)
        return

    text = read_text(tasks_path)
    try:
        root = parse_jsonc(text)
    except JsoncError as e:
        raise Refuse("tasks.json is not valid JSON with comments (%s)" % e)
    if root.kind != "object":
        raise Refuse("tasks.json does not hold a JSON object")
    tasks_node = find_entry(root, "tasks")
    inputs_node = find_entry(root, "inputs")
    if tasks_node is not None and tasks_node.kind != "array":
        raise Refuse('"tasks" is not an array')
    if inputs_node is not None and inputs_node.kind != "array":
        raise Refuse('"inputs" is not an array')

    t_victims, t_conflicts, t_edited = (set(), [], [])
    if tasks_node is not None:
        t_victims, t_conflicts, t_edited = classify_tasks(text, tasks_node, manifest, cli, True)
    i_victims, i_conflicts, i_edited = (set(), [], [])
    if inputs_node is not None:
        i_victims, i_conflicts, i_edited = classify_inputs(inputs_node, manifest)
    if not remove and (t_conflicts or i_conflicts):
        raise Refuse("conflict in tasks.json; nothing changed. " + "; ".join(t_conflicts + i_conflicts)
                     + ". Rename or remove that entry in VS Code, then run again", "vscode-tasks-conflict")

    removals, insertions = [], []
    new_manifest = {"version": 1, "created_file": bool(manifest.get("created_file")), "cli": cli,
                    "added_keys": list(manifest.get("added_keys", [])), "tasks": {}, "inputs": {}}

    if remove:
        if tasks_node is not None:
            removals += removal_ranges(text, tasks_node.elements, t_victims)
        if inputs_node is not None:
            removals += removal_ranges(text, inputs_node.elements, i_victims)
        for label in t_edited:
            notes.append("kept task %r: it is not verified unchanged by the ownership record; review it manually" % label)
        for iid in i_edited:
            notes.append("kept input %r: it is not verified unchanged by the ownership record; review it manually" % iid)
        # keys this writer added earlier whose arrays are now empty go too
        for key in manifest.get("added_keys", []):
            node = find_entry(root, key)
            if node is None or key not in ("tasks", "inputs", "version"):
                continue
            if node.has_comment or (key == "version" and node.value != "2.0.0"):
                continue
            if key == "version" and (any(k.value not in ("version", "tasks", "inputs") for k, _ in root.entries)
                                     or (tasks_node is not None and len(tasks_node.elements) != len(t_victims))
                                     or (inputs_node is not None and len(inputs_node.elements) != len(i_victims))):
                continue
            victims_here = t_victims if key == "tasks" else i_victims if key == "inputs" else set()
            if key != "version" and len(node.elements) != len(victims_here):
                continue
            spans = [(k.start, v.end, v.comma_end) for k, v in root.entries]
            idx = [k.value for k, _ in root.entries].index(key)
            removals += removal_ranges(text, spans, {idx})
        new_text = apply_edits(text, removals, insertions)
        if not t_victims and not i_victims:
            if os.path.exists(manifest_path):
                os.unlink(manifest_path)
            out("no verified owned entries to remove in %s" % tasks_path)
            for n in notes:
                out("  note: " + n)
            return
        remaining = parse_jsonc(new_text)
        only_ours = (manifest.get("created_file") is True and not remaining.entries
                     and not remaining.has_comment and not text.count("//") and not text.count("/*"))
        backup, made = make_backup(user_dir, text)
        if only_ours:
            os.unlink(tasks_path)
            out("removed %s (dewfpga created it and nothing else was in it; copy at %s)" % (tasks_path, backup))
        else:
            write_atomic(tasks_path, new_text, st.st_mode)
            out("wrote %s (removed %d tasks, %d inputs; backup %s)" % (tasks_path, len(t_victims), len(i_victims), backup))
        if os.path.exists(manifest_path):
            os.unlink(manifest_path)
        for n in notes:
            out("  note: " + n)
        return

    # install / update
    default_elsewhere = other_default_build(tasks_node, t_victims) if tasks_node is not None else None
    new_tasks = []
    for label, verb, d in TASK_SPECS:
        if label in t_edited:
            notes.append("kept task %r: ownership or unchanged content could not be verified (command path not updated)" % label)
            continue
        task = make_task(label, verb, cli, d and default_elsewhere is None)
        new_tasks.append(task)
        new_manifest["tasks"][label] = digest(task)
    if default_elsewhere is not None and "dewfpga: flash (build + program)" not in t_edited:
        notes.append("your task %r stays the default build task; Cmd+Shift+B keeps running it and "
                     "'dewfpga: flash (build + program)' is in the Run Build Task list" % default_elsewhere)
    new_inputs = []
    if INPUT_ID in i_edited:
        notes.append("kept input %r: ownership or unchanged content could not be verified" % INPUT_ID)
    else:
        new_inputs.append(make_input())
        new_manifest["inputs"][INPUT_ID] = digest(make_input())

    root_indent, root_unit = detect_indent(text, root)
    # Preserve the original text even when the object only contains comments.
    if tasks_node is not None:
        removals += removal_ranges(text, tasks_node.elements, t_victims)
        insertions += append_ranges(text, tasks_node, new_tasks, t_victims)
    if inputs_node is not None:
        removals += removal_ranges(text, inputs_node.elements, i_victims)
        insertions += append_ranges(text, inputs_node, new_inputs, i_victims)
    missing = []
    if tasks_node is None:
        missing.append(("tasks", new_tasks))
    if inputs_node is None:
        missing.append(("inputs", new_inputs))
    if find_entry(root, "version") is None:
        missing.insert(0, ("version", "2.0.0"))
    for key, _ in missing:
        if key not in new_manifest["added_keys"]:
            new_manifest["added_keys"].append(key)
    if missing:
        rendered = []
        for key, val in missing:
            s = json.dumps(val, indent=root_unit, ensure_ascii=False)
            s = "\n".join(root_indent + ln if ln else ln for ln in s.split("\n"))
            rendered.append(root_indent + json.dumps(key) + ": " + s.lstrip())
        body = ",\n".join(rendered)
        close_ls = line_start(text, root.close)
        if root.entries:
            last = root.entries[-1][1]
            if last.comma_end is None:
                insertions.append((last.end, ","))
            if begins_line(text, root.close):
                insertions.append((close_ls, body + ("\n" if last.comma_end is None else ",\n")))
            else:
                insertions.append((last.comma_end if last.comma_end is not None else last.end, "\n" + body + "\n"))
        else:
            insertions.append((root.open + 1, "\n" + body + "\n"))
    new_text = apply_edits(text, removals, insertions)

    try:
        parse_jsonc(new_text)
    except JsoncError as e:
        raise Refuse("internal: the edited tasks.json would not parse (%s); nothing written" % e)

    if new_text == text and all(manifest.get(k) == new_manifest[k] for k in ("tasks", "inputs", "cli", "added_keys")):
        out("unchanged %s" % tasks_path)
        for n in notes:
            out("  note: " + n)
        return
    if new_text != text:
        backup, made = make_backup(user_dir, text)
        write_tasks_and_manifest(tasks_path, new_text, st.st_mode, manifest_path,
                                 json.dumps(new_manifest, indent=2, sort_keys=True) + "\n", text)
        out("wrote %s (%d tasks, %d inputs; backup %s)" % (tasks_path, len(new_tasks), len(new_inputs), backup))
    else:
        write_atomic(manifest_path, json.dumps(new_manifest, indent=2, sort_keys=True) + "\n")
        out("unchanged %s (manifest refreshed)" % tasks_path)
    for n in notes:
        out("  note: " + n)


# ----------------------------------------------------------------------------- discovery
def discover(home):
    found = []
    base = os.path.join(home, "Library", "Application Support")
    for app in EDITORS:
        user = os.path.join(base, app, "User")
        if os.path.isdir(user) and not os.path.islink(user):
            found.append(user)
            for p in sorted(glob.glob(os.path.join(user, "profiles", "*"))):
                if os.path.isdir(p) and not os.path.islink(p):
                    found.append(p)
    return found


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cli", required=True, help="absolute path of the dewfpga command the tasks run")
    ap.add_argument("--user-dir", action="append", default=[], help="VS Code User (or profile) directory; repeatable")
    ap.add_argument("--remove", action="store_true", help="remove what this writer added")
    ap.add_argument("--print", action="store_true", help="print the tasks.json this writer would create and exit")
    ap.add_argument("--home", default=None, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    cli = a.cli
    if not os.path.isabs(cli):
        sys.stderr.write("vscode_tasks: --cli must be an absolute path, got %r\n" % cli)
        return 2
    if a.print:
        sys.stdout.write(fresh_document(cli, 4))
        return 0
    if not a.remove and not (os.path.isfile(cli) and os.access(cli, os.X_OK)):
        sys.stderr.write("vscode_tasks: --cli %s is not an executable file\n" % cli)
        return 2
    targets = a.user_dir
    if not targets:
        if sys.platform != "darwin" and a.home is None:
            print("vscode_tasks: automatic discovery knows only macOS; pass --user-dir <VS Code User directory>")
            return 0
        targets = discover(a.home or os.path.expanduser("~"))
        if not targets:
            print("vscode_tasks: no VS Code user directory found (looked for ~/Library/Application Support/"
                  + "{Code, Code - Insiders, VSCodium}/User). Install VS Code, open it once, then run "
                  + "`dewfpga vscode` again, or pass --user-dir.")
            return 0
    rc = 0
    def report(d, code, error):
        match = re.search(r"\bline (\d+) column \d+:", str(error))
        line = match.group(1) if match else "1"
        print("%s:%s: ERROR [%s]: %s. Fix: review the indicated file and its backup; "
              "dewfpga vscode --print shows the configuration to add manually. "
              "https://nosey-dewdrop.github.io/dewfpga/errors/%s/" %
              (os.path.join(os.path.abspath(d), "tasks.json"), line, code, error, code), file=sys.stderr)
    for d in targets:
        try:
            process_target(d, cli, a.remove, lambda s: print(s))
        except Refuse as e:
            report(d, e.code, e)
            rc = 1
        except OSError as e:
            report(d, "vscode-tasks-write-failed", e)
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
