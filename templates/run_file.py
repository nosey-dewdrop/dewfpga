#!/usr/bin/env python3
"""Explicit-file Basys3 runner. Only the selected source and explicit includes are read.

The existing Makefile remains the compiler. Each invocation uses a fresh private
directory; successful artifacts are retained in a per-source cache for inspection.
No source-side scaffolding, inferred sibling source files, or stale bitstream reuse.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
SCALARS = {"clk": "input", "btnU": "input", "btnD": "input", "btnL": "input",
           "btnR": "input", "btnC": "input", "dp": "output"}
VECTORS = {"sw": (16, "input"), "led": (16, "output"), "seg": (7, "output"), "an": (4, "output")}


def fail(message):
    raise ValueError(message)


def auto_xdc(module):
    """Use elaborated ports, including parameters and original range offsets."""
    master = {}
    for line in (HERE / "Basys3_Master.xdc").read_text().splitlines():
        m = re.search(r"PACKAGE_PIN\s+(\w+).*get_ports\s+\{?([A-Za-z_]\w*(?:\[\d+\])?)", line)
        if m:
            master[m[1]] = m[2]
    pins = {name: pin for pin, name in master.items()}
    lines = []
    clock_signal = "clk"
    for name, port in module["ports"].items():
        width, offset = len(port["bits"]), port.get("offset", 0)
        if name in SCALARS:
            if width != 1 or offset != 0 or port["direction"] != SCALARS[name]:
                fail(f"{name} must be a scalar {SCALARS[name]} for the Basys3 default pins.")
            single = module.get("netnames", {}).get(name, {}).get("attributes", {}).get("single_bit_vector", 0)
            names = [(name + "[0]" if str(single).strip("0") else name, name)]
        elif name in VECTORS:
            count, direction = VECTORS[name]
            if offset < 0 or offset + width > count or port["direction"] != direction:
                fail(f"{name} must be an {direction} within [{count - 1}:0] for the Basys3 default pins.")
            single = module.get("netnames", {}).get(name, {}).get("attributes", {}).get("single_bit_vector", 0)
            scalar = width == 1 and offset == 0 and not str(single).strip("0")
            names = [(name if scalar else f"{name}[{i}]", f"{name}[{i}]") for i in range(offset, offset + width)]
        else:
            fail(f"No default Basys3 pin for '{name}'. Use clk, sw, led, btnC/U/D/L/R, seg, dp, an; "
                 "or put your own <source-name>.xdc beside the source (or pass --xdc FILE).")
        for signal, board in names:
            lines.append(f"set_property -dict {{ PACKAGE_PIN {pins[board]} IOSTANDARD LVCMOS33 }} [get_ports {{{signal}}}]")
            if board == "clk":
                clock_signal = signal
    if "clk" in module["ports"]:
        lines.append(f"create_clock -period 10.000 [get_ports {{{clock_signal}}}]")
    return "\n".join(lines) + "\n"


def stage_source(source, work):
    """Copy explicit local include/readmem dependencies, never glob other designs.

    Paths inside HDL must be relative portable paths. This preserves their spelling
    for the existing compiler; absolute/parent references need the project flow.
    """
    staged = work / ("source" + source.suffix.lower())
    mapping = {staged.name: str(source)}
    staged.write_bytes(source.read_bytes())
    visited = set()

    def dependencies(original, staged_parent):
        if original in visited:
            return
        visited.add(original)
        text = original.read_text(errors="replace")
        # Remove comments while preserving strings (a comment containing an include is not a dependency).
        text = re.sub(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/',
                      lambda m: m[0] if m[0].startswith('"') else " ", text)
        refs = re.findall(r'`include\s+"([^"\n]+)"|\$readmem[hb]\s*\(\s*"([^"\n]+)"', text)
        for include, memory in refs:
            rel = include or memory
            if not re.fullmatch(r"[A-Za-z0-9_./-]+", rel) or Path(rel).is_absolute() or ".." in Path(rel).parts:
                fail(f"Dependency '{rel}' needs the project flow: single-file Run supports relative include/data paths without '..' or spaces.")
            # readmem resolves from the build working directory, including when
            # its call appears in an included header. Includes resolve beside it.
            origin = (original.parent if include else source.parent) / rel
            dest = (staged_parent if include else work) / rel
            if not origin.is_file():
                # May be inside an inactive preprocessor branch. The compiler
                # diagnoses missing *active* dependencies, with their source line.
                continue
            if dest == staged:
                fail(f"Dependency '{rel}' collides with the private source name; rename the include.")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(origin.read_bytes())
            mapping[str(dest.relative_to(work))] = str(origin)
            if include:
                dependencies(origin, dest.parent)
    dependencies(source, work)
    return staged.name, mapping


def main():
    parser = argparse.ArgumentParser(description="Run a saved .sv/.v file on Basys3; no project folder or XDC needed for standard IO.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--build-only", action="store_true", help="compile without programming USB")
    parser.add_argument("--top", help="top module when the file contains multiple independent designs")
    parser.add_argument("--xdc", type=Path, help="explicit pin file (default: same basename as source, else Basys3 standard IO)")
    args = parser.parse_args()
    source = args.file.expanduser().resolve()
    if not source.is_file() or source.suffix.lower() not in (".sv", ".v"):
        fail(f"Save a .sv or .v file first: {source}")
    cache = Path.home() / ".cache/dewfpga/run" / hashlib.sha256(str(source).encode()).hexdigest()[:24]
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("This file is already running; wait for that run to finish.")
        for name in ("design.bit", "design.json", "design.xdc", "design.log"):
            (cache / name).unlink(missing_ok=True)
        # Existing FPGA Makefile needs a workspace path without shell metacharacters.
        with tempfile.TemporaryDirectory(prefix="dewfpga-run-", dir="/tmp") as directory:
            work = Path(directory)
            staged, mapping = stage_source(source, work)
            env = dict(os.environ, LC_ALL="C", LC_CTYPE="C", LANG="C")
            def mapped(text):
                for local, original in sorted(mapping.items(), key=lambda pair: -len(pair[0])):
                    text = re.sub(r"(?<![\w/])" + re.escape(local) + r"(?=[:\s'\"\),;]|\.(?:\s|$)|$)", lambda _: original, text)
                return text
            def execute(command):
                with subprocess.Popen(command, cwd=work, env=env, stdout=subprocess.PIPE,
                                      stderr=subprocess.STDOUT, text=True, errors="replace") as child:
                    for line in child.stdout:
                        print(mapped(line), end="", flush=True)
                    rc = child.wait()
                if rc:
                    raise subprocess.CalledProcessError(rc, command)
            scan = [sys.executable, str(HERE / "check_xdc.py"), "--scan"]
            if args.top:
                scan += ["--top", args.top]
            result = subprocess.run(scan + [staged], cwd=work, env=env, capture_output=True, text=True)
            fields = {}
            for line in result.stdout.splitlines():
                key, _, value = line.partition("=")
                if key in ("ERROR", "PROBLEM"):
                    # already one finished message (file:line, code, fix); only the two-tops fix names this command
                    text = mapped(value)
                    if "[two-tops]" in text:
                        text = re.sub(r"dewfpga bit (\w+)", lambda m: f"dewfpga run {source.name} --top {m.group(1)}", text)
                    print(text, file=sys.stderr)
                    sys.exit(1)
                fields[key] = value
            top = fields.get("TOP", "")
            if result.returncode or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", top):
                fail(mapped(result.stderr) or "Could not select a top module; use --top NAME.")
            make = ["make", "-s", "-f", str(HERE / "Makefile"), f"TOP={top}",
                    f"SRCS={staged}", "XDC=pins.xdc", f"CHECKER={HERE / 'check_xdc.py'}"]
            print(f"Run on Basys3: {source} (top: {top})", flush=True)
            execute(make + ["synth"])
            xdc = args.xdc.expanduser().resolve() if args.xdc else source.with_suffix(".xdc")
            if args.xdc or xdc.exists():
                if not xdc.is_file():
                    fail(f"Pin file not found: {xdc}")
                shutil.copyfile(xdc, work / "pins.xdc")
                mapping["pins.xdc"] = str(xdc)
                print(f"Pins: {xdc}", flush=True)
            else:
                design = json.loads((work / f"{top}.json").read_text())
                (work / "pins.xdc").write_text(auto_xdc(design["modules"][top]))
                print("Pins: automatic Basys3 mapping", flush=True)
            # the work folder is deleted on the way out: messages name the log where it is kept, failed build too
            mapping[f"{top}.log"] = str(cache / "design.log")
            try:
                execute(make + ["bit"])
            finally:
                for filename, output in ((f"{top}.bit", "design.bit"), (f"{top}.json", "design.json"),
                                         ("pins.xdc", "design.xdc"), (f"{top}.log", "design.log")):
                    if (work / filename).exists():
                        shutil.copyfile(work / filename, cache / output)
            print(f"Build: {cache / 'design.bit'}", flush=True)
            if not args.build_only:
                # Serialise USB programming between independent single-file runs.
                with (cache.parent / "board.lock").open("w") as board:
                    try:
                        fcntl.flock(board, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        fail("Another Run is programming Basys3; wait for it to finish, then Run again.")
                    execute(make + ["flash"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(f"ERROR [single-file-run]: {error}", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode or 1)
