#!/usr/bin/env python3
"""dewfpga's waveform viewers for a .vcd: Surfer, or the page that shows it in the browser (Vivado's wave window).

    wave_page.py <file.vcd> [--viewer surfer|browser|both] [--surfer PATH] [--sim TEXT] [--out page.html] [--no-open]

browser (the default): one page, wave.css, wave.js and the VCD itself inlined (a browser does not let a page opened
from disk read a file beside it), written to $TMPDIR/dewfpga-wave/ (or --out) and opened with the system's browser
(`open` on macOS, `xdg-open` on Linux). surfer: Surfer's first commands (surfer_wave.py) go in a .sucl file beside
the page, and Surfer (--surfer, the one the CLI found) takes this process's place until its window closes.
Both show the same signals first. --no-open writes the files and opens nothing (the tests use it).
Prints one line: the .vcd, what simulated it (--sim, from the CLI), and the viewer it opened in.
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import surfer_wave  # noqa: E402  (beside this file)

LIMIT = 256 << 20
SITE = "https://nosey-dewdrop.github.io/dewfpga/errors/"

# *-*-*-*-*-*-*-*-*-*-*-* page *-*-*-*-*-*-*-*-*-*-*-*
PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · dewfpga waveform</title>
<style>
html, body {{ margin: 0; height: 100%; background: #1f2023; }}
#dewwave {{ height: 100vh; height: 100dvh; }}
{css}
</style>
</head>
<body>
<div id="dewwave"></div>
<script>
{js}
</script>
<script>
DewWave.mountPage(document.getElementById('dewwave'), {vcd}, {name}, {key});
</script>
</body>
</html>
"""


def full(path):
    # the absolute path as the shell names it: $PWD (/var/... on macOS) rather than the resolved /private/var/...
    here = os.environ.get("PWD", "")
    try:
        if not (here and os.path.samefile(here, ".")):
            here = os.getcwd()
    except OSError:
        here = os.getcwd()
    return os.path.normpath(os.path.join(here, path))


def js_string(text):
    # a JSON string, with "<" written as \\u003c so no "</script" in the file can end the script early
    return json.dumps(text, ensure_ascii=False).replace("<", "\\u003c")


def build(vcd_path):
    with open(vcd_path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8", "replace")
    name = os.path.basename(vcd_path)
    key = full(vcd_path)
    with open(os.path.join(HERE, "wave.css"), encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(HERE, "wave.js"), encoding="utf-8") as f:
        js = f.read()
    title = name.replace("&", "&amp;").replace("<", "&lt;")
    return PAGE.format(title=title, css=css, js=js, vcd=js_string(text), name=js_string(name), key=js_string(key))


def write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def message(kind, code, text):
    print(f"{kind} [{code}]: {text} {SITE}{code}/", file=sys.stderr if kind == "ERROR" else sys.stdout)


# *-*-*-*-*-*-*-*-*-*-*-* viewers *-*-*-*-*-*-*-*-*-*-*-*
def surfer_name(surfer):
    # "Surfer 0.7.0", from `surfer --version` ("surfer 0.7.0 (git: v0.7.0)"); just "Surfer" when it says nothing usable
    try:
        out = subprocess.run([surfer, "--version"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        out = ""
    m = re.match(r"\s*surfer\s+(\S+)", out, re.I)
    return "Surfer " + m[1] if m else "Surfer"


def open_page(page):
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    try:
        subprocess.run([opener, page], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        message("note", "waveform-not-opened", f"{opener} is missing, so the page was not opened. Open it in a browser: {page}")
        return False
    return True


def main(argv):
    ap = argparse.ArgumentParser(prog="wave_page.py", description="open a .vcd in Surfer or the browser page")
    ap.add_argument("vcd")
    ap.add_argument("--viewer", choices=("surfer", "browser", "both"), default="browser")
    ap.add_argument("--surfer", help="the Surfer to start (the CLI checks it is there before it simulates)")
    ap.add_argument("--sim", help="what simulated it, for the line printed: Icarus Verilog 13.0 (stable)")
    ap.add_argument("--out", help="the page (default: $TMPDIR/dewfpga-wave/<name>-<hash>.html)")
    ap.add_argument("--no-open", dest="open", action="store_false", help="write the files, open nothing")
    a = ap.parse_args(argv[1:])
    vcd = a.vcd
    surfer = a.viewer in ("surfer", "both")
    browser = a.viewer in ("browser", "both")
    if surfer and a.open and not a.surfer:
        ap.error("--viewer surfer opens Surfer: give --surfer PATH, or --no-open")
    if not os.path.isfile(vcd):
        message("ERROR", "no-waveform", f"{vcd} does not exist. Fix: run the simulation first:  dewfpga sim")
        return 1
    size = os.path.getsize(vcd)
    if browser and size > LIMIT:
        message("ERROR", "waveform-too-large", f"{vcd} is {size >> 20} MB, more than a browser page holds ({LIMIT >> 20} MB). "
                f"Fix: record less (a shorter run, SIM_TIME=2us dewfpga sim) or fewer signals ($dumpvars(1, tb) records only "
                f"the testbench's own), or open it in Surfer:  dewfpga sim --wave")
        return 1
    folder = os.path.join(tempfile.gettempdir(), "dewfpga-wave")
    os.makedirs(folder, exist_ok=True)
    stem = os.path.join(folder, os.path.splitext(os.path.basename(vcd))[0] + "-"
                        + hashlib.sha1(full(vcd).encode()).hexdigest()[:8])
    page = sucl = None
    try:
        if surfer:
            sucl = stem + ".sucl"
            write(sucl, surfer_wave.commands(vcd))
        if browser:
            page = a.out or stem + ".html"
            write(page, build(vcd))
    except (OSError, ValueError) as e:
        message("ERROR", "waveform-unreadable", f"{e}. Fix: open a .vcd that a simulation wrote whole:  dewfpga sim --wave")
        return 1
    # the one line: which file, what simulated it, where it is shown
    shown = vcd
    if os.path.isabs(vcd) and not os.path.relpath(vcd, full(".")).startswith(".."):
        shown = os.path.relpath(vcd, full("."))
    line = "waveform: " + shown + (", simulated by " + a.sim if a.sim else "")
    surfer_cmd = [a.surfer or "surfer", full(vcd), "--command-file", sucl] if surfer else None
    if not a.open:
        files = ([" ".join(surfer_cmd)] if surfer else []) + ([page] if browser else [])
        print(line + ", not opened (--no-open): " + " and ".join(files), flush=True)
        return 0
    opened = [surfer_name(a.surfer)] if surfer else []
    if browser and open_page(page):
        opened.append("the browser: " + page)
    if not opened:
        print(line + ", not opened: " + page, flush=True)
        return 0
    print(line + ", opened in " + " and ".join(opened), flush=True)
    if surfer:
        # Surfer in this process's place: the terminal (or the editor's task) waits for its window, and its exit is ours
        try:
            os.execv(a.surfer, surfer_cmd)
        except OSError as e:
            message("ERROR", "wave-viewer-missing", f"Surfer ({a.surfer}) did not start: {e}. Fix: brew install surfer, or open the page:  dewfpga sim --wave=browser")
            return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
