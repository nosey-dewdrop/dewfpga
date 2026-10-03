#!/usr/bin/env python3
"""Make the release npm package from tracked working-tree files only."""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "package.json", "README.md", "README.tr.md",
         "LICENSE", "install.sh", "bin", "templates", "vscode", "docs/agent-interface.md"], cwd=ROOT).split(b"\0")
    with tempfile.TemporaryDirectory(prefix="dewfpga-package-") as tmp:
        stage = Path(tmp)
        for entry in tracked:
            if not entry:
                continue
            rel = Path(entry.decode())
            source = ROOT / rel
            # Release inputs are plain files; a link could import an untracked external file.
            if source.is_symlink() or not source.is_file():
                raise SystemExit(f"package: expected a regular tracked file: {rel}")
            target = stage / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        subprocess.run(["npm", "pack", "--ignore-scripts", "--pack-destination", str(ROOT)],
                       cwd=stage, check=True)


if __name__ == "__main__":
    main()
