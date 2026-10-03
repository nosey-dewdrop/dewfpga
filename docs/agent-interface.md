# Machine-readable CLI

`dewfpga check --json`, `dewfpga sim [top] --json`, `dewfpga bit [top] --json` and
`dewfpga flash [top] --json` print exactly one JSON object on stdout. Text commands
retain their existing output. `flash` programs attached hardware; request it only
when the user has authorized programming the board.

The schema tag is `dewfpga/result@1`. `command`, `ok`, `exit_code`, `cause` and `code`
identify the result. The process exit is `exit_code`; success requires `ok: true` and
exit 0. `child_exit` preserves the underlying command's status. `duration_ms` measures
elapsed time; `version` is the CLI version. `top` and `testbench` are null when unknown.

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | design/project failure or a failed child without a known diagnostic |
| 2 | invalid usage |
| 3 | missing or broken toolchain |
| 4 | board/programmer failure |
| 70 | wrapper failure or incomplete child output |
| 124 | timeout |
| 130 / 143 | interrupted by SIGINT / SIGTERM |

`diagnostics` holds severity, code, file, line, message, fix and URL. Locations can
be null. A multi-location driver error uses its first location; the original line
is retained in the log. A warning flood cannot displace errors: at most 50 errors
and 50 warnings/notes are kept, with `diagnostics_truncated` set when more arrive.
Do not assume the first message proves the sole cause. Fix it and run again.

`log.path` names a temporary log holding at most 8 MiB of child output plus a short truncation marker. `log.tail` holds at most 60 lines
and 8192 UTF-8 bytes total; `log.truncated` also reports write failures. The caller
may remove the log when finished. Output capture runs concurrently for stdout and
stderr. Readers failing or descendants holding output open cannot return success.

`artifacts` describes known outputs with `path`, `kind`, `state` and fingerprints.
`new` means created or changed in this run, `cached` means unchanged after a successful
command, and `stale` means unchanged after a failure. Files larger than 64 MiB are
omitted. State is null if the parent folder could not be scanned before the run. Unrelated old files are not attributed to a guessed top. Inspect `ok`
and the artifact state together: file existence alone proves no successful build.
`sim.testbench_errors` is null when the output provides no count.

`--timeout=N` accepts 1–3600 whole seconds. `DEWFPGA_JSON_TIMEOUT` accepts a positive
number up to 3600 seconds when the option is absent. Defaults: check 60, sim 180,
bit 900, flash 120 seconds. Timeout or parent interruption stops the CLI's process
group. A deliberately daemonized descendant that leaves that group is outside this
cleanup boundary. No shell string is evaluated by the wrapper.


## MCP server

`dewfpga mcp` serves the same CLI through standard input/output. `dewfpga install`
builds a separate `$FPGA_HOME/mcp-venv`, with `mcp==2.3.0` and `mcp-types==2.3.0`.
The plain CLI remains usable if that optional installation fails. Set
`DEWFPGA_SKIP_MCP=1` to skip the automatic SDK step. `dewfpga check` reports its
presence without making an absent optional SDK a toolchain failure.

For Claude Code, from the project folder:

```sh
claude mcp add --transport stdio --scope local dewfpga -- dewfpga mcp
```

This registers a local client configuration; the installer does not register clients.
Other MCP clients use `command: "dewfpga"`, `args: ["mcp"]`. If the client does not
inherit your shell PATH, use the absolute executable path printed by `command -v dewfpga`.
The server supports the SDK's protocol negotiation; tests exercise protocol 2026-07-28.

| Tool | Arguments | Behavior |
|---|---|---|
| `check` | none | inspect installed tools |
| `new` | `name`, absolute `parent` | create a blink project; refuse an existing path |
| `sim` | absolute `project`, optional `testbench`, `timeout_s` | run the testbench; default 120 s, max 600 s |
| `bit` | absolute `project`, optional module `top`, `timeout_s` | build a bitstream; default 600 s, max 1800 s |
| `flash` | absolute `project`, optional `timeout_s` | build and program the board; default 120 s, max 300 s |
| `explain_error` | `code` | read the packaged error catalog offline |

The CLI may fix port directions or name unnamed instances while building. `sim` and
`bit` therefore declare that they can write project files. `flash` declares destructive
hardware effects: call it only when the user has asked to program the connected board.
Annotations inform the client; they do not enforce user approval by themselves.

A tool failure has `isError: true`. CLI-backed structured results use the JSON schema
above; malformed, mismatched or contradictory results are rejected. Server stdout is
reserved for protocol messages. Child stdout is bounded at 4 MiB; stderr retains at
most 64 KiB. Cancellation stops observed descendant process groups and waits for cleanup
without blocking the event loop. A daemon that reparents before observation can escape
that process-tree boundary; PID reuse and availability of `ps` remain limitations.

SDK setup uses a private staging directory, an ownership marker and a lock. Failed
replacement preserves the previous environment; uninstall refuses a concurrent SDK
installation and keeps foreign or symlinked destinations. It does not remove unrelated
projects or install packages into the system Python.

Tests can run without an SDK, explicitly skipping protocol cases. CI sets
`DEWFPGA_MCP_REQUIRE_SDK=1`, which makes an absent SDK a failure. For a separate test
venv, set `DEWFPGA_MCP_TEST_PYTHON` to its Python executable. The test suite itself
performs no network installation.
