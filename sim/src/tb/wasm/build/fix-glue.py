#!/usr/bin/env python3
"""Post-process an Emscripten glue .mjs: make getMemoryBuffer() return wasmMemory.buffer.

Emscripten 6.0.2 (GROWABLE_ARRAYBUFFERS=1, the default) emits

    function getMemoryBuffer(){try{var b=wasmMemory.toResizableBuffer();return b}catch{}return wasmMemory.buffer}

In Chrome, TextDecoder.decode() rejects a view over a resizable ArrayBuffer, so the
shipped glue returns the plain buffer:

    function getMemoryBuffer(){return wasmMemory.buffer}

Usage: fix-glue.py FILE...   (edits in place; prints old/new size and sha256)
Exit 1 and no write when the function is absent, appears more than once, has an
unbalanced body, or has a body this script does not recognise.  Idempotent: a file
already carrying the target form is reported and left unchanged.
"""
import hashlib
import re
import sys

HEAD = "function getMemoryBuffer()"
HEAD_RE = re.compile(r"function\s+getMemoryBuffer\s*\(\s*\)\s*")   # -O2 output has no spaces; -O0/-g does
TARGET = HEAD + "{return wasmMemory.buffer}"


def body_span(text, start):
    """Return (open_idx, close_idx) of the brace block starting at text[start]."""
    if start >= len(text) or text[start] != "{":
        raise ValueError("no '{' after getMemoryBuffer()")
    depth = 0
    i = start
    quote = None
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif text.startswith("//", i):
            i = text.find("\n", i)
            if i < 0:
                break
        elif text.startswith("/*", i):
            i = text.find("*/", i + 2)
            if i < 0:
                break
            i += 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return start, i
        i += 1
    raise ValueError("unbalanced braces in getMemoryBuffer body")


def fix(text):
    """Return (new_text, status). status: 'edited' | 'unchanged'. Raises ValueError."""
    hits = list(HEAD_RE.finditer(text))
    if not hits:
        raise ValueError("getMemoryBuffer() is absent")
    if len(hits) > 1:
        raise ValueError(f"getMemoryBuffer() appears {len(hits)} times, expected exactly 1")
    start = hits[0].start()
    o, c = body_span(text, hits[0].end())
    func = text[start:c + 1]
    if func == TARGET:
        if "toResizableBuffer" in text:
            raise ValueError("already patched but toResizableBuffer still present elsewhere")
        return text, "unchanged"
    body = text[o + 1:c]
    if "toResizableBuffer" not in body or "return wasmMemory.buffer" not in body:
        raise ValueError("unrecognised getMemoryBuffer body: " + func[:160])
    new = text[:start] + TARGET + text[c + 1:]
    if len(HEAD_RE.findall(new)) != 1 or "toResizableBuffer" in new:
        raise ValueError("post-check failed: function count or toResizableBuffer remains")
    return new, "edited"


def main(paths):
    if not paths:
        print(__doc__, file=sys.stderr)
        return 2
    rc = 0
    for p in paths:
        try:
            with open(p, "rb") as f:
                old = f.read()
            text = old.decode("utf-8")
            new_text, status = fix(text)
            new = new_text.encode("utf-8")
            if status == "edited":
                with open(p, "wb") as f:
                    f.write(new)
            print(f"fix-glue: {status} {p}: {len(old)} -> {len(new)} bytes, "
                  f"sha256 {hashlib.sha256(new).hexdigest()}")
        except (OSError, UnicodeDecodeError, ValueError) as e:
            print(f"fix-glue: ERROR {p}: {e}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
