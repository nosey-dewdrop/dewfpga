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
