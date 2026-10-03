#!/usr/bin/env python3
"""Render one docs/patch-notes.md entry as an email (HTML + text), offline.

    python3 mail/patch_notes_mail.py --entry 16 --out DIR   write DIR/patch-notes-16.html|.txt|.json
    python3 mail/patch_notes_mail.py --list                 the entry numbers found

No network, no provider, no addresses. The unsubscribe link is a placeholder
({{unsubscribe_url}}) that the mailer fills per recipient; the content hash
covers the rendered output with the placeholder in place, so the same entry
rendered twice has the same hash and a changed entry has a new one. The owner
test and the campaign in mail/dewfpga_mail.py are tied by that hash.

Markdown handled: paragraphs, "- " bullets with indented continuation lines,
fenced ``` blocks, **bold**, `code`, [text](url), bare "→". Everything else
stays as text, escaped. This is a subset of what the site builder (pandoc,
docs/patch-notes-build.py) renders; the email is a plain summary with a link to
the page, not a second copy of the page.
"""
import argparse, hashlib, html, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
NOTES = os.path.join(ROOT, "docs", "patch-notes.md")
PAGE = "https://nosey-dewdrop.github.io/dewfpga/patch-notes/"
UNSUB = "{{unsubscribe_url}}"
HEAD_RE = re.compile(r"^### #(\d+) · (.+?) · (.+?)\s*$")
_INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))")


def entries(text=None):
    """{number: {"n", "title", "date", "body"}} from the markdown."""
    if text is None:
        with open(NOTES, encoding="utf-8") as f:
            text = f.read()
    out, cur = {}, None
    for line in text.split("\n"):
        m = HEAD_RE.match(line)
        if m:
            cur = {"n": int(m.group(1)), "title": m.group(2), "date": m.group(3), "body": []}
            out[cur["n"]] = cur
            continue
        if line.startswith("## ") or line.startswith("# "):
            cur = None
            continue
        if cur is not None:
            cur["body"].append(line)
    for e in out.values():
        e["body"] = "\n".join(e["body"]).strip("\n")
    return out


def inline_html(s):
    parts = []
    for piece in _INLINE.split(s):
        if piece.startswith("**") and piece.endswith("**"):
            parts.append("<strong>" + html.escape(piece[2:-2]) + "</strong>")
        elif piece.startswith("`") and piece.endswith("`"):
            parts.append('<code style="font-family:Menlo,Consolas,monospace;font-size:92%">'
                         + html.escape(piece[1:-1]) + "</code>")
        elif piece.startswith("[") and piece.endswith(")"):
            t, u = piece[1:].split("](", 1)
            u = u[:-1]
            if not u.startswith(("https://", "http://")):
                u = PAGE  # relative links point at the page; the mail has no base
            parts.append('<a href="' + html.escape(u, quote=True) + '" style="color:#5b2fc9">'
                         + html.escape(t) + "</a>")
        else:
            parts.append(html.escape(piece))
    return "".join(parts)


def inline_text(s):
    def link(m):
        t, u = m.group(1), m.group(2)
        return f"{t} ({u})" if u.startswith(("https://", "http://")) else t
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, s)
    s = s.replace("**", "")
    return s


def blocks(body):
    """[(kind, payload)]: ("p", text) ("ul", [item...]) ("pre", code)."""
    out, para, items, lines = [], [], [], body.split("\n")
    i = 0

    def flush():
        nonlocal para, items
        if para:
            out.append(("p", " ".join(x.strip() for x in para)))
            para = []
        if items:
            out.append(("ul", items))
            items = []

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            code, i = [], i + 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            out.append(("pre", "\n".join(code)))
            i += 1
            continue
        if not line.strip():
            flush()
        elif line.startswith("- "):
            if para:
                flush()
            items.append(line[2:].strip())
        elif line.startswith("  ") and items and not para:
            items[-1] += " " + line.strip()
        else:
            if items:
                flush()
            para.append(line)
        i += 1
    flush()
    return out


def render(entry):
    """(subject, html, text) with the unsubscribe placeholder in both bodies."""
    n, title, date = entry["n"], entry["title"], entry["date"]
    subject = f"dewfpga #{n}: {title}"
    link = f"{PAGE}#{n}"
    h, t = [], []
    for kind, payload in blocks(entry["body"]):
        if kind == "p":
            h.append(f'<p style="margin:0 0 14px">{inline_html(payload)}</p>')
            t.append(inline_text(payload))
            t.append("")
        elif kind == "ul":
            h.append('<ul style="margin:0 0 14px;padding-left:22px">'
                     + "".join(f'<li style="margin:0 0 6px">{inline_html(x)}</li>' for x in payload) + "</ul>")
            t.extend("- " + inline_text(x) for x in payload)
            t.append("")
        else:
            h.append('<pre style="background:#f3f0fa;padding:10px;overflow:auto;font-size:13px">'
                     + html.escape(payload) + "</pre>")
            t.extend("    " + x for x in payload.split("\n"))
            t.append("")
    body_html = "\n".join(h)
    page = (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<title>{html.escape(subject)}</title></head>\n"
        '<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;'
        'font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">\n'
        '<div style="max-width:620px;margin:0 auto">\n'
        f'<p style="margin:0 0 18px;color:#5b2fc9;font-weight:700">dewfpga · patch notes</p>\n'
        f'<h1 style="font-size:22px;margin:0 0 4px">#{n} · {html.escape(title)}</h1>\n'
        f'<p style="margin:0 0 18px;color:#666">{html.escape(date)} · '
        f'<a href="{html.escape(link, quote=True)}" style="color:#5b2fc9">read it on the site</a></p>\n'
        f"{body_html}\n"
        '<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">\n'
        '<p style="font-size:13px;color:#666;margin:0">You get this because you confirmed this address on '
        f'<a href="{PAGE.rsplit("/", 2)[0]}/newsletter/" style="color:#5b2fc9">the dewfpga newsletter page</a>. '
        f'<a href="{UNSUB}" style="color:#5b2fc9">Unsubscribe</a> with one click; no sign-in needed.</p>\n'
        "</div></body></html>\n"
    )
    text = (
        f"dewfpga patch notes\n#{n} · {title}\n{date} · {link}\n\n"
        + "\n".join(t).rstrip("\n")
        + f"\n\n--\nYou get this because you confirmed this address on the dewfpga newsletter page.\n"
        f"Unsubscribe (no sign-in needed): {UNSUB}\n"
    )
    return subject, page, text


def content_hash(subject, page, text):
    return hashlib.sha256(("\0".join([subject, page, text])).encode("utf-8")).hexdigest()


def build(n, text=None):
    e = entries(text)
    if n not in e:
        raise KeyError(f"no entry #{n} in docs/patch-notes.md (have {', '.join(str(k) for k in sorted(e))})")
    subject, page, body = render(e[n])
    return {"entry": n, "subject": subject, "html": page, "text": body,
            "content_hash": content_hash(subject, page, body)}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--entry", type=int)
    ap.add_argument("--out")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args(argv)
    if a.list:
        for e in entries().values():
            print(f"#{e['n']}\t{e['date']}\t{e['title']}")
        return 0
    if a.entry is None:
        ap.error("--entry N or --list")
    r = build(a.entry)
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        base = os.path.join(a.out, f"patch-notes-{a.entry}")
        for ext, key in (("html", "html"), ("txt", "text")):
            with open(f"{base}.{ext}", "w", encoding="utf-8") as f:
                f.write(r[key])
        with open(f"{base}.json", "w", encoding="utf-8") as f:
            json.dump({k: r[k] for k in ("entry", "subject", "content_hash")}, f, indent=1)
            f.write("\n")
        print(f"{base}.html {len(r['html'])} bytes, {base}.txt {len(r['text'])} bytes, hash {r['content_hash'][:16]}")
    else:
        print(r["text"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
