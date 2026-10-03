# Repair experiment: does project guidance help a coding agent?

Prepared 2026-10-03 for update #16. A first 16-cell batch completed its repair checks, but the comparison was
invalidated during root log review: the batch root contained guidance above **both** arms, and one plain agent
explicitly read it. See [the invalid-batch report](invalid-results-2026-10-03.md). It is not evidence of a guidance
benefit. The separately identified replacement batch completed: [v3 results](results-2026-10-03.md) show 8/8 repair acceptance in each arm, no observed plain-arm guide/reference access, and one guided temporary-backup protocol deviation. This does not demonstrate a guidance benefit.

- `fixtures/<n>_<class>/`: one small broken Basys3 project each (`top.sv`, `tb.sv`, `top.xdc`; fixture 7 has a
  `README.md` instead of a testbench). The agent gets a copy of this folder and `prompt.txt`, nothing else.
- `reference/<n>_<class>/`: one correct repair (`top.sv`), `tb.sv`, known-wrong designs (`wrong/*.sv`) and
  `EXPECTED.md` (measured baseline + intended behaviour). The agent never sees this folder.
- `acceptance.sh <run-dir> <fixture>`: every step in a fresh folder holding only the agent's sources; `.xdc`
  byte-identical to the fixture's; fixture 7's `top.sv` byte-identical; `sim` and `bit` exit 0; the agent's
  testbench passes on the reference design (`tb-good`) and fails on every `wrong/*.sv` (`tb-wrong`); `reference/tb.sv`
  passes on the agent's design; port interface equal; netlist equivalent to the reference (`test/sv/eqv.sh`).
  No SKIP: an eqv that cannot decide (exit 2) is a FAIL.
- `self-test.sh`: the harness against itself. Each solved reference must pass; each wrong design, each unrepaired
  fixture 3-8, a whitespace-only `.xdc` edit and an edited fixture-7 design must fail.
- `manifest.json`: arms, per-fixture baseline (as measured on 2026-10-03), the run recipe, acceptance argv and check types.
- `prompt.txt`: the task text, the same in both arms.

Two arms: **plain** (the fixture as is) and **guided** (the fixture plus `templates/AGENTS.md` and `templates/CLAUDE.md`,
which `dewfpga new` writes; the agent is told there to use `--json`). One attempt per cell, 16 cells, each reported
whether it passed or not; a failed cell is never re-run. Runs live in a `mktemp -d` outside the repo, so the agent's
folder holds no harness, no reference and no repo `CLAUDE.md`. Never `dewfpga flash` in a run; no board is attached.

## Limits (what a result here can and cannot say)

- **n = 1 per cell.** 8 fixtures x 2 arms, one attempt each: it shows gross differences and failure modes, not a
  rate. Agent runs vary; a 1-cell difference between arms is noise.
- **Fixtures 1 and 2 are controls.** The CLI repairs them by itself (their unrepaired copies pass acceptance), so
  they measure whether the agent breaks something, not whether it repairs.
- **`ref-tb` is mostly not independent.** For fixtures 1-6 and 8, `reference/<n>/tb.sv` is the fixture's own
  `tb.sv`, which the agent sees and can edit; only fixture 7's is unseen. The behaviour checks the agent cannot
  aim at are `eqv`, `ports` and `tb-wrong`.
- **`tb-wrong` is a finite set.** One known-wrong design per fixture (three for fixture 7): a pass means the agent's
  testbench catches these mutations, not every bug.
- **The CLI path leads into the repo.** `dewfpga` on `PATH` resolves (Homebrew link) to a checkout whose
  `test/agent/experiment/reference/` holds the answers. The recipe in `manifest.json` puts a copy of `bin/` and
  `templates/` first on `PATH` and greps each log for the harness paths; a hit marks the cell contaminated.
- **Testbench detection is a heuristic.** A file is a testbench when it declares a port-less module
  (`module name;` or `module name();`); one with parameters or ports is counted as design and fails `tb-good`.
- **Fixture 5's JSON.** The multi-location diagnostic fix is included in the frozen CLI used by the experiment.
  The original fixture preparation exposed this wrapper bug before any agent repair attempt.

## Isolation before another batch

Do not keep `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md` in any parent of a run directory. Claude Code
[loads ancestor instructions at startup](https://code.claude.com/docs/en/memory#how-claudemd-files-load),
and an agent can also read them explicitly. Store the guidance in a sibling directory and copy it only into
the guided cell. Check both lexical and resolved directory ancestors before launching each cell; fail before
calling the model if instructions are present. Use new directories and sessions for an entirely new batch.
Inspect tool inputs **and outputs** for outside-project reads, including relative `../` paths; substring checks
for `reference/` alone missed this defect. This protocol is not a filesystem sandbox. Report any contamination.
Retain invalid batches and the reason; never mix their cells into the replacement comparison.
