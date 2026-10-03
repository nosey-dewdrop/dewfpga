#!/usr/bin/env python3
"""Build the dewfpga VSIX without vsce or the network, byte-for-byte reproducible.

    python3 vscode/build-vsix.py [--out DIR]      -> DIR/dewfpga-<version>.vsix  (default: vscode/out)

Fixed timestamps, sorted members, one compression level: the same sources give the same bytes.
The shim keeps its executable bit (external attributes), which VS Code's extractor restores.
"""
import json, os, sys, zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAMP = (2026, 1, 1, 0, 0, 0)

def member(zf, name, data, mode=0o644):
    zi = zipfile.ZipInfo(name, STAMP)
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.create_system = 3
    zi.external_attr = ((0o100000 | mode) << 16)
    zf.writestr(zi, data, compresslevel=9)

def manifest(pkg):
    props = {
        "Microsoft.VisualStudio.Code.Engine": pkg["engines"]["vscode"],
        "Microsoft.VisualStudio.Code.ExtensionDependencies": "",
        "Microsoft.VisualStudio.Code.ExtensionPack": "",
        "Microsoft.VisualStudio.Code.ExtensionKind": ",".join(pkg.get("extensionKind", ["workspace"])),
        "Microsoft.VisualStudio.Code.LocalizedLanguages": "",
        "Microsoft.VisualStudio.Services.Links.Source": pkg["repository"]["url"],
        "Microsoft.VisualStudio.Services.Links.Getstarted": pkg["repository"]["url"],
        "Microsoft.VisualStudio.Services.Links.Repository": pkg["repository"]["url"],
        "Microsoft.VisualStudio.Services.Links.Support": pkg["repository"]["url"] + "/issues",
        "Microsoft.VisualStudio.Services.Links.Learn": pkg["homepage"],
        "Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown": "true",
        "Microsoft.VisualStudio.Services.Content.Pricing": "Free",
    }
    plist = "".join('      <Property Id="%s" Value="%s" />\n' % (k, escape(v, {'"': "&quot;"})) for k, v in props.items())
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
        '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">\n'
        '  <Metadata>\n'
        '    <Identity Language="en-US" Id="%s" Version="%s" Publisher="%s" />\n'
        '    <DisplayName>%s</DisplayName>\n'
        '    <Description xml:space="preserve">%s</Description>\n'
        '    <Tags>fpga,verilog,systemverilog,dewfpga</Tags>\n'
        '    <Categories>%s</Categories>\n'
        '    <GalleryFlags>Public</GalleryFlags>\n'
        '    <Properties>\n%s    </Properties>\n'
        '    <License>extension/LICENSE</License>\n'
        '  </Metadata>\n'
        '  <Installation>\n    <InstallationTarget Id="Microsoft.VisualStudio.Code" />\n  </Installation>\n'
        '  <Dependencies />\n'
        '  <Assets>\n'
        '    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />\n'
        '    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />\n'
        '    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />\n'
        '  </Assets>\n'
        '</PackageManifest>\n') % (pkg["name"], pkg["version"], pkg["publisher"], escape(pkg["displayName"]),
                                    escape(pkg["description"]), ",".join(pkg["categories"]), plist)

CONTENT_TYPES = ('<?xml version="1.0" encoding="utf-8"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
    '  <Default Extension=".json" ContentType="application/json" />\n'
    '  <Default Extension=".js" ContentType="application/javascript" />\n'
    '  <Default Extension=".md" ContentType="text/markdown" />\n'
    '  <Default Extension=".vsixmanifest" ContentType="text/xml" />\n'
    '  <Default Extension="" ContentType="application/octet-stream" />\n'
    '</Types>\n')

README = """# dewfpga for VS Code

Companion of the `dewfpga` command (https://nosey-dewdrop.github.io/dewfpga/).

- `dewfpga: choose the top module` (command id `dewfpga.pickTop`, for a task input of type `command`): runs
  `dewfpga tops` in the active file's folder. One candidate or none: returns an empty string and the CLI picks.
  Two or more: a list; the module chosen last time for this project is highlighted while it is still a
  candidate. Escape cancels the task. The choice is remembered per project root (or per folder).
- After a task named `dewfpga: simulate` / `FPGA: simulate`, or running `dewfpga sim` / `make sim`, ends with
  exit 0, a `.vcd` opens if it is new or changed since the task started. Only files directly in one folder are
  looked at: the Vivado project root for `dewfpga sim` (the folder the CLI moves to), the task's cwd for
  `make sim`. A `$dumpfile` into a subfolder or an absolute path is not opened.
- `dewfpga: use the dewfpga iverilog lint shim`: sets `verilog.linting.path` in user settings to a folder whose
  `iverilog` turns Icarus's constant-select `sorry:` into a warning, only when the user value is unset or
  empty and no workspace value overrides it. `stop using ...` puts the earlier value (unset or empty) back,
  and leaves the setting alone if it was not written by this extension or has changed since.
- Setting `dewfpga.cliPath`: absolute path of `dewfpga`. Empty: /opt/homebrew/bin/dewfpga, /usr/local/bin/dewfpga,
  ~/.dewfpga/bin/dewfpga, ~/fpga/dewfpga/bin/dewfpga (the first that exists).
- Problem matcher `$dewfpga`: `file:line: ERROR|warning|note [code]: message`.
"""

def main(argv):
    out_dir = os.path.join(HERE, "out")
    if len(argv) >= 3 and argv[1] == "--out": out_dir = argv[2]
    elif len(argv) != 1: sys.exit("usage: build-vsix.py [--out DIR]")
    with open(os.path.join(HERE, "package.json"), "rb") as f: pkg_bytes = f.read()
    pkg = json.loads(pkg_bytes)
    files = [  # sorted member names; (name, bytes, mode)
        ("[Content_Types].xml", CONTENT_TYPES.encode(), 0o644),
        ("extension.vsixmanifest", manifest(pkg).encode(), 0o644),
        ("extension/LICENSE", open(os.path.join(ROOT, "LICENSE"), "rb").read(), 0o644),
        ("extension/README.md", README.encode(), 0o644),
        ("extension/bin/iverilog", open(os.path.join(HERE, "bin", "iverilog"), "rb").read(), 0o755),
        ("extension/extension.js", open(os.path.join(HERE, "extension.js"), "rb").read(), 0o644),
        ("extension/package.json", pkg_bytes, 0o644),
    ]
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "dewfpga-%s.vsix" % pkg["version"])
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w") as zf:
        for name, data, mode in sorted(files, key=lambda t: t[0]): member(zf, name, data, mode)
    os.replace(tmp, out)
    print(out)

if __name__ == "__main__": main(sys.argv)
