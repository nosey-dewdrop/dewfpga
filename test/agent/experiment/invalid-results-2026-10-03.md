# Invalid guidance comparison — 3 October 2026

**Do not use this batch to estimate the effect of project guidance.** All 16 repaired projects passed the
frozen build and behavior checks, but the plain and guided conditions were not isolated.

The runner stored `CLAUDE.md` (importing `AGENTS.md`) at the batch root, above both arms. Root review found
the `plain/6_enum_method_next` agent executing `cat ../../../AGENTS.md`; its tool result contained the guide.
The initial contamination scan checked reference paths and missed this parent traversal. Claude Code also
[loads ancestor instructions at startup](https://code.claude.com/docs/en/memory#how-claudemd-files-load).
Thus none of the plain cells is a verified unguided baseline, even where no explicit guide read was logged.

## Observations retained, not a comparison

| arm label | repair checks passed | tool calls | CLI-process seconds | Bash calls containing `--json` |
|---|---:|---:|---:|---:|
| plain | 8/8 | 41 | 454.84 | 0 |
| guided | 8/8 | 36 | 459.86 | 15 |

Times include process startup and quota responses, and sum the interrupted and continued segments. They
exclude the subscription-reset wait and the external judge. Each of the four interrupted cells continued
under its original session ID. The other twelve were not repeated. A 60k autocompact launch attempt failed
before model initialization or any tool call; it is an invalid startup, not a repair attempt.

Each cell passed `xdc`, `sim`, `bit`, `tb-good`, `tb-wrong`, `ref-tb`, `ports` and `eqv`; fixture 7 also passed
the byte-identical-design check. Root read all sixteen acceptance logs and rehashed the frozen judge inputs.
No board programming was run. The checks establish those repairs; they do not rescue the experimental contrast.

## Correction

A new batch uses fresh projects and sessions, with guidance stored outside every project ancestor and copied
only into guided projects. It retains the frozen fixtures, judge, model, cell order and one attempt per cell.
A pre-launch ancestor check and review of relative outside-project reads address the failure above. The entire
old batch stays separate; no cell is selected for inclusion because it passed. This is a protocol correction,
not a retry of failed repairs. The corrected batch has not run yet.

Even a clean run would have only one attempt per cell, two CLI-autofix controls, a small finite mutation set
and seven reference testbenches also visible in the fixture. It could describe these cases, not a general success rate.

[Machine-readable observations](invalid-results-2026-10-03.json) omit local paths and account/session details.
