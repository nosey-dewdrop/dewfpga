#!/usr/bin/env python3
"""dewfpga wave: the page that shows a .vcd in the browser, Vivado's wave window without Vivado.

    wave_page.py <file.vcd> [--out page.html] [--no-open]

The page is one file: wave.css, wave.js and the VCD itself inlined (a browser does not let a page opened from disk
read a file beside it). It is written to $TMPDIR/dewfpga-wave/ (or --out) and opened with the system's browser
(`open` on macOS, `xdg-open` on Linux) unless --no-open. Prints `waveform: <vcd> -> <page>`.
"""
import hashlib, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIMIT = 256 << 20

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


def js_string(text):
    # a JSON string, with "<" written as \\u003c so no "</script" in the file can end the script early
    return json.dumps(text, ensure_ascii=False).replace("<", "\\u003c")


def build(vcd_path):
    with open(vcd_path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8", "replace")
    name = os.path.basename(vcd_path)
    key = os.path.abspath(vcd_path)
    with open(os.path.join(HERE, "wave.css"), encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(HERE, "wave.js"), encoding="utf-8") as f:
        js = f.read()
    title = name.replace("&", "&amp;").replace("<", "&lt;")
    return PAGE.format(title=title, css=css, js=js, vcd=js_string(text), name=js_string(name), key=js_string(key))


def main(argv):
    args = argv[1:]
    out, do_open, vcd = None, True, None
    k = 0
    while k < len(args):
        a = args[k]
        if a == "--out" and k + 1 < len(args):
            out = args[k + 1]
            k += 2
            continue
        if a == "--no-open":
            do_open = False
        elif vcd is None:
            vcd = a
        else:
            sys.exit("usage: wave_page.py <file.vcd> [--out page.html] [--no-open]")
        k += 1
    if vcd is None:
        sys.exit("usage: wave_page.py <file.vcd> [--out page.html] [--no-open]")
    if not os.path.isfile(vcd):
        print(f"ERROR [no-waveform]: {vcd} does not exist. Fix: run the simulation first:  dewfpga sim", file=sys.stderr)
        return 1
    size = os.path.getsize(vcd)
    if size > LIMIT:
        print(f"ERROR [waveform-too-large]: {vcd} is {size >> 20} MB, more than a browser page holds ({LIMIT >> 20} MB). "
              f"Fix: record less (a shorter run, SIM_TIME=2us dewfpga sim) or fewer signals ($dumpvars(1, tb) records only the testbench's own).",
              file=sys.stderr)
        return 1
    if out is None:
        folder = os.path.join(tempfile.gettempdir(), "dewfpga-wave")
        os.makedirs(folder, exist_ok=True)
        tag = hashlib.sha1(os.path.abspath(vcd).encode()).hexdigest()[:8]
        out = os.path.join(folder, os.path.splitext(os.path.basename(vcd))[0] + "-" + tag + ".html")
    page = build(vcd)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(page)
    os.replace(tmp, out)
    print(f"waveform: {vcd} -> {out}")
    if do_open:
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        try:
            subprocess.run([opener, out], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            print(f"note [waveform-not-opened]: {opener} is missing, so the page was not opened. Open it in a browser: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
