#!/usr/bin/env python3
"""Builds, replaces and removes the owned venv $FPGA_HOME/mcp-venv that runs `dewfpga mcp`. Standard library only.

    mcp_setup.py install   <FPGA_HOME> <python3>     build in a private staging dir, then swap in atomically; rollback on failure
    mcp_setup.py uninstall <FPGA_HOME>                remove mcp-venv (and stale staging/backup dirs) only if they carry our marker;
                                                      refused (exit 1) while an install holds mcp-venv.lock
    mcp_setup.py status    <FPGA_HOME>                exit 0 when an owned, importable venv is present

Ownership: every directory this script creates gets a marker file `.dewfpga-owned` first. Anything at the destination
without that marker, or any symlink, is foreign and is refused: install stops, uninstall leaves it alone. Only the
requirements in templates/mcp-requirements.txt are installed, inside the venv; pip is never invoked globally.
Exit codes: 0 ok, 1 build/import failed (the plain CLI is unaffected), 2 usage or foreign destination.
"""
import errno
import fcntl
import os
import shutil
import signal
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.realpath(__file__))
REQ = os.path.join(HERE, "mcp-requirements.txt")
MARKER = ".dewfpga-owned"
NAME = "mcp-venv"
LOCK = NAME + ".lock"


def env_int(name, default):
    try:
        v = int(os.environ.get(name, ""))
        return v if v > 0 else default
    except ValueError:
        return default


BUILD_TIMEOUT = env_int("DEWFPGA_MCP_BUILD_TIMEOUT", 900)


def say(msg):
    sys.stderr.write("mcp_setup: %s\n" % msg)
    sys.stderr.flush()


def owned(path):
    """A real directory we created: not a symlink, carries the marker (the marker itself a regular file)."""
    if os.path.islink(path) or not os.path.isdir(path):
        return False
    m = os.path.join(path, MARKER)
    return not os.path.islink(m) and os.path.isfile(m)


def run(argv, cwd):
    """Output goes to a temp file (no pipe a grandchild can hold open); on timeout the whole session is killed."""
    with tempfile.TemporaryFile() as log:
        try:
            p = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        except OSError as exc:
            return 1, str(exc)
        try:
            rc = p.wait(timeout=BUILD_TIMEOUT)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            p.wait()
            rc = 1
            log.write(b"\ntimed out after %d s (DEWFPGA_MCP_BUILD_TIMEOUT)\n" % BUILD_TIMEOUT)
        log.seek(0)
        return rc, log.read().decode("utf-8", "replace")


def lock(home):
    """Exclusive non-blocking lock on $FPGA_HOME/mcp-venv.lock; None when another install holds it.
    O_NOFOLLOW refuses a symlink. The holder deletes the file before letting go, so a lock taken on a file that is no
    longer at the path (inode recheck) is stale and taken again."""
    path = os.path.join(home, LOCK)
    for _ in range(5):
        try:
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        except OSError as exc:
            say("cannot open lock %s: %s" % (path, exc)); return None
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            if exc.errno not in (errno.EWOULDBLOCK, errno.EAGAIN):
                say("cannot lock %s: %s" % (path, exc))
            return None
        try:
            st, now = os.fstat(fd), os.lstat(path)
            if (st.st_dev, st.st_ino) == (now.st_dev, now.st_ino):
                return fd
        except FileNotFoundError:
            pass
        os.close(fd)
    say("cannot lock %s: it keeps being replaced" % path)
    return None


def unlock(home, fd):
    """Deletes the lock file while still holding it, so FPGA_HOME is left as it was found."""
    try:
        path = os.path.join(home, LOCK)
        st, now = os.fstat(fd), os.lstat(path)
        if (st.st_dev, st.st_ino) == (now.st_dev, now.st_ino):
            os.unlink(path)
    except OSError:
        pass
    os.close(fd)


def rm_owned(path):
    if owned(path):
        shutil.rmtree(path)
        return True
    return False


def install(home, python):
    home = os.path.realpath(home)
    if not os.path.isdir(home):
        say("FPGA_HOME %s is not a folder" % home); return 2
    dest = os.path.join(home, NAME)
    if os.path.lexists(dest) and not owned(dest):
        say("ERROR: %s exists but was not made by dewfpga (symlink or no %s marker); leaving it alone. Fix: move it away "
            "and run dewfpga install again." % (dest, MARKER)); return 2
    if not os.path.isfile(REQ):
        say("%s missing" % REQ); return 1
    fd = lock(home)
    if fd is None:
        say("another dewfpga install is building %s; try again when it finishes" % dest); return 1
    try:
        return build(home, dest, python)
    finally:
        unlock(home, fd)


def build(home, dest, python):
    if os.path.lexists(dest) and not owned(dest):  # rechecked under the lock
        say("ERROR: %s appeared and was not made by dewfpga; leaving it alone." % dest); return 2
    # private staging dir with a random name next to the destination (same filesystem, so the final rename is atomic)
    stage = tempfile.mkdtemp(prefix=NAME + ".new-", dir=home)
    try:
        with open(os.path.join(stage, MARKER), "w") as f:
            f.write("made by dewfpga install; dewfpga uninstall removes this folder\n")
        # no --clear: it would delete the marker while the build runs, leaving an unowned folder if we die here
        rc, out = run([python, "-m", "venv", stage], home)
        if rc != 0:
            say("python -m venv failed (%d):\n%s" % (rc, out[-3000:])); return 1
        if not owned(stage):
            say("the marker vanished from %s during python -m venv" % stage); return 1
        vpy = os.path.join(stage, "bin", "python")
        if not os.access(vpy, os.X_OK):
            say("venv has no bin/python"); return 1
        rc, out = run([vpy, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", REQ], home)
        if rc != 0:
            say("pip install -r %s failed (%d):\n%s" % (REQ, rc, out[-3000:])); return 1
        rc, out = run([vpy, "-c", "import mcp, mcp_types; print(mcp.__name__)"], home)
        if rc != 0:
            say("the new venv cannot import mcp (%d):\n%s" % (rc, out[-3000:])); return 1
        # swap: old owned venv steps aside under a random name, staging takes its place, old comes back if that fails
        backup = None
        if os.path.lexists(dest):
            backup = tempfile.mkdtemp(prefix=NAME + ".old-", dir=home)
            os.rmdir(backup)
            os.rename(dest, backup)
        try:
            os.rename(stage, dest)
        except OSError as exc:
            say("could not move the new venv into place: %s" % exc)
            if backup:
                try:
                    os.rename(backup, dest)
                    say("previous venv restored")
                except OSError as exc2:
                    say("ERROR: could not restore the previous venv (%s); it is kept at %s. Fix: mv %s %s"
                        % (exc2, backup, backup, dest))
            return 1
        stage = None
        if backup:
            rm_owned(backup)
        say("ok: %s" % dest)
        return 0
    finally:
        if stage and os.path.isdir(stage):
            shutil.rmtree(stage, ignore_errors=True)


def uninstall(home):
    home = os.path.realpath(home)
    if not os.path.isdir(home):
        return 0
    fd = lock(home)
    if fd is None:
        say("an install is running in %s; nothing removed. Run dewfpga uninstall again when it finishes." % home)
        return 1
    try:
        return remove(home)
    finally:
        unlock(home, fd)


def remove(home):
    removed, kept = [], []
    for entry in sorted(os.listdir(home)):
        if entry != NAME and not entry.startswith(NAME + ".new-") and not entry.startswith(NAME + ".old-"):
            continue
        p = os.path.join(home, entry)
        if rm_owned(p):
            removed.append(p)
        else:
            kept.append(p)
    for p in removed:
        say("removed %s" % p)
    for p in kept:
        say("kept %s: not made by dewfpga (symlink or no %s marker)" % (p, MARKER))
    return 0


def status(home):
    dest = os.path.join(os.path.realpath(home), NAME)
    if not owned(dest):
        return 1
    rc, _ = run([os.path.join(dest, "bin", "python"), "-c", "import mcp, mcp_types"], dest)
    return 0 if rc == 0 else 1


def main(argv):
    if len(argv) == 3 and argv[0] == "install":
        return install(argv[1], argv[2])
    if len(argv) == 2 and argv[0] in ("uninstall", "status"):
        return uninstall(argv[1]) if argv[0] == "uninstall" else status(argv[1])
    sys.stderr.write(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
