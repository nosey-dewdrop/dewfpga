# Patch notes

## 1.2 (in progress, from 24 September 2026)

Every update below comes with the tests that prove it: what each test checks, and the numbers before and after.

### #1 · The CLI and the guide say the same thing · 24 September

**`dewfpga uninstall` says what it removes, and removes only its own.** It used to print
`removing: ~/fpga ~/.dewfpga <link>` and then delete five entries inside `~/fpga`, not the folder.
It also deleted Homebrew's `dewfpga` link even when that link pointed to another copy of the CLI.
Now it lists every path it deletes, touches the link only when the link points to itself, leaves
anything else in `~/fpga` alone, and says `nothing to remove` when there is nothing.
Tried on a fake install with a student project inside `~/fpga`: the project file survived, the real
Homebrew link survived, a second run printed `nothing to remove`, and an empty folder was removed.

**Version 1.2.0.** The CLI had said 0.1.0 since 19 September. The patch number and
`dewfpga --version` are now the same number.

**The guide stopped contradicting itself.**
- Section 2 said two course-code problems "are handled for you". Only one is (the seven-segment
  port line); the others stop the build with the line and the fix.
- Section 7 said "one", then "two more", then listed six cases.
- Section 8 called it "the one case hit so far".
- The command list had no `--version`.

Tried: writing the right count into section 7. Dropped it, because the list grows every time a new
student repo turns up a new case. The text now says what each case does instead of how many there are.
The HTML page and the PDF (12 pages) were rebuilt from the same source.

**README.tr described rules that stopped being true on 21 September.** It said the top module is
chosen by its `.xdc` file, `sim` needs `<top>_tb.sv`, two `.sv` files in one folder is an error, and
`dewfpga check` has six rows. The top now comes from the module hierarchy, the testbench is
recognized by its content, file names are free, and `check` prints nine rows.
README.tr is now a translation of the English README.

**Disk space, measured.**
- After the one-line install, `~/fpga` holds 1.40 GB: nextpnr-xilinx 1.06 GB, prjxray 214 MB,
  the chip database 89 MB, the Python venv 52 MB.
- Homebrew packages add 235 MB.
- The home page said 1.76 GB, which is the by-hand path with full git clones.
- The home, why and Turkish pages now say 1.4 GB (1.76 GB by hand).

**Tests.** `test/run.sh`: 51 passed, 0 failed before the change (81 s) and 51 passed, 0 failed
after. One test was renamed: "top found from xdc" is now "top found from the hierarchy", which is
what it has checked since 21 September.

**Not done here.** The README still says "46 checks"; update #2 locks that number to the test suite.
