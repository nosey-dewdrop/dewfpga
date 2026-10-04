# Basys3 on macOS without Vivado (dewfpga)
#
#   make sim    -> simulate (iverilog); fails if the testbench prints $error/$fatal
#   make bit    -> build the bitstream (~5 s); full place-and-route log in <top>.log
#   make flash  -> program the board (SRAM: cleared on power cycle)
#   make check  -> are the tools in place
#   make clean
#
# New module: change TOP/SRCS/XDC. Copy pins from Basys3_Master.xdc (unused pins are ignored).
# -nobram: memories become distributed RAM (LUTs). Fine at lab sizes; a large framebuffer would not fit.

TOP  := blink
SRCS := blink.sv
XDC  := blink.xdc
# the testbench (<top>_tb.sv or .v), and the seconds after which a testbench that never reaches $finish is stopped
TB   ?= $(firstword $(wildcard $(TOP)_tb.sv $(TOP)_tb.v))
SIM_TIMEOUT ?= 120

PART    := xc7a35tcpg236-1
FPGA    ?= $(or $(FPGA_HOME),$(HOME)/fpga)
NEXTPNR := $(FPGA)/nextpnr-xilinx/build/nextpnr-xilinx
CHIPDB  := $(FPGA)/chipdb/xc7a35t.bin
XRAYDB  := $(FPGA)/nextpnr-xilinx/xilinx/external/prjxray-db/artix7
PY      := $(FPGA)/venv/bin/python
F2F     := $(FPGA)/prjxray/utils/fasm2frames.py
F2B     := $(FPGA)/prjxray/build/tools/xc7frames2bit
CHECKER ?= $(dir $(lastword $(MAKEFILE_LIST)))check_xdc.py
# yosys-slang (optional): the second reader, tried when yosys' own read_verilog refuses the code. Without it the
# build is yosys' verdict alone.
SLANG   ?= $(FPGA)/yosys-slang/build/slang.so
# every message the product adds has one shape:  file:line: KIND [code]: what is wrong. Fix: one sentence. page
# (no file:line when the problem is not in the student's code: the toolchain, the board, the XDC as a whole).
# The code is the page's folder under $(URL); the tools' own lines (yosys, iverilog, nextpnr) are printed as they
# are, and the line the product adds after them carries the code. fmt() builds it in every awk program below.
URL     := https://nosey-dewdrop.github.io/dewfpga/errors/
FMT_AWK = function fmt(k, c, at, t, f) { return (at=="" ? "" : at ": ") k " [" c "]: " t (f=="" ? "" : " Fix: " f) " $(URL)" c "/" }

SHELL := bash
.DELETE_ON_ERROR:          # a recipe that fails must not leave a half-written target behind (make 3.81 honors this)

.PHONY: all sim synth bit flash clean check

all: bit

check:
	@for t in yosys iverilog openFPGALoader; do printf "%-16s " $$t; command -v $$t || echo "-MISSING-"; done
	@printf "%-16s " nextpnr-xilinx; [ -x "$(NEXTPNR)" ] && echo "$(NEXTPNR)" || echo "-MISSING-"
	@printf "%-16s " xc7frames2bit;  [ -x "$(F2B)" ]     && echo "$(F2B)"     || echo "-MISSING-"
	@printf "%-16s " chipdb;         [ -s "$(CHIPDB)" ]  && echo "$(CHIPDB)"  || echo "-MISSING-"
	@printf "%-16s " fasm2frames;    [ -s "$(F2F)" ]     && echo "$(F2F)"     || echo "-MISSING-"
	@printf "%-16s " venv;           "$(PY)" -c "import fasm, prjxray" 2>/dev/null && echo "$(PY)" || echo "-MISSING-"
	@printf "%-16s " yosys-slang;    [ -f "$(SLANG)" ]   && echo "$(SLANG)"   || echo "-MISSING- (optional: the second reader for the SystemVerilog yosys' own reader refuses)"

# the testbench's $error/$fatal lines make sim fail, so a red run is visible to make, VS Code and CI.
# vvp -n: $stop ends the run instead of opening vvp's interactive prompt. -l: a copy of the output for the
# grep below, while stdout stays live on the terminal. The perl alarm stops a run that never reaches $finish.
sim: $(TOP)_sim
	@rc=0; SIM_TIMEOUT=$(SIM_TIMEOUT) perl -e '$$SIG{ALRM}=sub{kill TERM=>$$p; select(undef,undef,undef,0.3); kill KILL=>$$p; exit 142}; alarm $$ENV{SIM_TIMEOUT}; $$p=fork; exec @ARGV if !$$p; waitpid $$p,0; exit($$?>>8)' vvp -n -l $(TOP)_sim.out ./$(TOP)_sim || rc=$$?; \
	  if [ $$rc -eq 142 ]; then echo "ERROR [sim-timeout]: the simulation did not finish in $(SIM_TIMEOUT) s: the testbench never reached \$$finish (a free-running clock never stops on its own). Fix: end the testbench with \$$finish; SIM_TIMEOUT=600 dewfpga sim waits longer. $(URL)sim-timeout/" >&2; exit 1; fi; \
	  [ $$rc -eq 0 ] || { echo "ERROR [sim-exit]: the simulator stopped with exit $$rc (its message is above: a \$$fatal, or a testbench that ends without \$$finish). Fix: read the line above this one and fix what it names; make the testbench end with \$$finish. $(URL)sim-exit/" >&2; exit 1; }; \
	  n=$$(grep -cE '^(ERROR|FATAL):' $(TOP)_sim.out); [ "$$n" -eq 0 ] || { at=$$(grep -m1 -oE '^(ERROR|FATAL): [^ :]+:[0-9]+' $(TOP)_sim.out | sed -E 's/^(ERROR|FATAL): //'); s=s; [ "$$n" -ne 1 ] || s=""; \
	    echo "$${at:+$$at: }ERROR [testbench-error]: the testbench reported $$n error$$s (its ERROR: lines above, from \$$error): the design does not do what the testbench expects. Fix: read the first ERROR: line, it names the check that failed; fix the design there, or the testbench if its expectation is wrong. $(URL)testbench-error/" >&2; exit 1; }

# files the sources pull in without naming them to make: $readmemh/$readmemb tables and `include files. A
# changed .mem or included .v rebuilds. $(TOP).deps, $(TOP)_sim.deps and $(TOP).pins.deps hold the whole file
# list and a checksum of every file's content, rewritten only when that changes, so a file added, deleted or
# renamed (a dropped design file, a new testbench) rebuilds too (see "fresh" below).
readmems = $(sort $(shell grep -ohE '\$$readmem[hb][[:space:]]*.[[:space:]]*"[^"]+"' $(1) 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/'))
# INCDIRS (from the CLI): the folders that hold the sources (. in a flat folder; NEW.srcs/sources_1/new ... in a
# Vivado project). The tools get them as -I, so `include "defs.svh" next to a design in a subfolder is found by
# iverilog too (yosys and slang also look beside the including file); a header there is a dependency as well.
INCDIRS ?= .
INC = $(addprefix -I,$(INCDIRS))
includes = $(sort $(shell grep -ohE '^[[:space:]]*`include[[:space:]]+"[^"]+"' $(1) 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/'))
indirs = $(1) $(foreach d,$(INCDIRS),$(addprefix $(d)/,$(1)) $(d)/*.svh $(d)/*.vh)
SRC_DEPS := $(wildcard $(call readmems,$(SRCS)) $(call indirs,$(call includes,$(SRCS))))
SIM_DEPS := $(wildcard $(call readmems,$(SRCS) $(TB)) $(call indirs,$(call includes,$(SRCS) $(TB))))
# a package must be read before the module that uses it: iverilog and yosys read the files in the order given
# (iverilog stops at a syntax error, yosys drops the import and builds every name of the package as an undriven
# wire). The CLI lists the files alphabetically, so a package declared next to a module (zz_util.sv: package +
# module, used by top.sv) came after its user. The files that declare a package go first, in the order given.
PKG_SRCS := $(shell grep -lE '^[[:space:]]*package[[:space:]]+[A-Za-z_]' $(SRCS) 2>/dev/null)
override SRCS := $(strip $(PKG_SRCS) $(filter-out $(PKG_SRCS),$(SRCS)))
# the files the typedef scan reads: an included file (types.svh) declares its typedef before the design uses it,
# so it is read first; a .mem is not code. A file that is both included and a source is read once.
TYPEDEF_FILES = $(filter-out $(SRCS),$(filter %.svh %.vh %.sv %.v,$(SRC_DEPS))) $(SRCS)

# Apple's make 3.81 compares whole seconds: a file saved within the second of the last compile is not newer to it
# (measured: an edit 0.4 s after the build, 0 of 5 rebuilt), so a save followed at once by the build (VS Code,
# ⌘⇧B) ran the old simulation and printed its old PASS. And a target removed by a prerequisite's recipe is not
# noticed either (make reads the target's time first). So the check runs here, while make reads this file,
# before it looks at any target: when a stage's file list or content checksum differs from what its .deps file
# holds, the .deps file is rewritten and the stage's output removed, and make builds it again. shasum is on
# macOS and in Perl everywhere; cksum (POSIX) is the fallback. Only the goals' own stages are checked (sim: the
# simulation; bit, flash, synth: the netlist and the pins), so a sim folder gets no bit files and clean/check
# write nothing.
SUM := $(if $(shell command -v shasum 2>/dev/null),shasum,cksum)
GOALS := $(or $(MAKECMDGOALS),all)
# $(call fresh,<deps file>,<file list and checksums>,<the stage's output>)
fresh = $(shell l="$(2)"; { [ -f $(1) ] && [ "$$(cat $(1))" = "$$l" ]; } || { echo "$$l" > $(1); rm -f $(3); })
ifneq (,$(filter sim,$(GOALS)))
$(call fresh,$(TOP)_sim.deps,$(SRCS) | $(TB) | $(SIM_DEPS) | $(shell $(SUM) $(SRCS) $(TB) $(SIM_DEPS) 2>/dev/null),$(TOP)_sim)
endif
ifeq (,$(filter sim clean check,$(GOALS)))
$(call fresh,$(TOP).deps,$(SRCS) | $(SRC_DEPS) | $(shell $(SUM) $(SRCS) $(SRC_DEPS) 2>/dev/null),$(TOP).json)
$(call fresh,$(TOP).pins.deps,$(XDC) | $(shell $(SUM) $(XDC) 2>/dev/null),$(TOP).fasm)
endif
# the .deps files are written above; a goal that skipped its check (make $(TOP)_sim) still has a rule for them
$(TOP)_sim.deps $(TOP).deps $(TOP).pins.deps: ;

$(TOP)_sim: $(SRCS) $(TB) $(SIM_DEPS) $(TOP)_sim.deps
	@[ -n "$(TB)" ] || { echo "ERROR [no-testbench]: $(TOP)_tb.sv not found: the simulation needs a testbench next to the design. Fix: write $(TOP)_tb.sv (a module that instantiates $(TOP), drives its inputs, checks its outputs with \$$error and ends with \$$finish); 'dewfpga new blink' gives an example (blink/blink_tb.sv). $(URL)no-testbench/" >&2; exit 1; }
	@awk '$(PKG_AWK)' $(SRCS) $(TB) $(SIM_DEPS)
	@awk '$(TYPEDEF_AWK)' $(TYPEDEF_FILES)
	@$(call MKKW,$(SRCS) $(TB)); echo "iverilog -g2012$(if $(filter-out .,$(INCDIRS)), $(INC)) -o $@ $(SRCS) $(TB)"; iverilog -g2012 $(INC) -o $@ $$KWSRCS 2>&1 | tee $(TOP)_sim.err; rc=$${PIPESTATUS[0]}; rm -rf "$$KW"; \
	  [ $$rc -eq 0 ] || { at=$$(grep -m1 -oE '^[^ :]+:[0-9]+: (syntax error|error|sorry)' $(TOP)_sim.err | sed -E 's/: (syntax error|error|sorry)$$//'); \
	    echo "$${at:+$$at: }ERROR [iverilog-refused]: iverilog cannot compile this code (its message is above). Fix: fix the first line it names; the errors after the first often follow from it. $(URL)iverilog-refused/" >&2; }; rm -f $(TOP)_sim.err; exit $$rc

synth: $(TOP).json
# yosys' messages that mean the design is wrong, or would be built wrong, become an ERROR with the file:line
# and the fix. Silent wrongs (a bitstream that would not do what the simulation showed) stop the build:
#   $isunknown in a design: yosys folds it to 1, on the board it is 0; found by a scan of the sources.
#   An identifier with :: that yosys declares implicitly is a package reference to a package it was not given
#   (the CLI hands it the files that hold a module): yosys would build it as an undriven wire.
#   An undeclared name: yosys makes a 1-bit implicit wire and warns with file:line. A plain one is an error only
#   when nothing drives it (a port connection .y(w) or the left of an assign is a legal implicit net, IEEE 1800-2017
#   6.10; -noautowire would refuse those too). A dotted one (u_fsm.state, c.q: a hierarchical name or an interface
#   member) is always an error, unless the prefix is an interface port (sum_if.prod bus): yosys warns for those
#   while parsing and resolves them in hierarchy. ifi = interface instance names, ifp = interface port names.
#   Two always blocks writing one signal, and an async reset that loads a signal ($aldff after proc): yosys warns
#   without a line, so the awk reads the cells' src attributes from $(TOP).il (written after proc, lazily, once
#   yosys has written it) to name the lines. yosys-slang emits $aldff for a constant reset too (c <= '0 on
#   negedge rst_n), which synth_xilinx builds right, so only a cell whose AD is not a constant is the error.
#   A latch from an always_comb (an if without else) is a warning, not an error: Vivado infers the latch with
#   a warning (UG901 Ch.5 Latches). yosys' proc refuses a latch in a process that carries the always_comb
#   attribute and builds it (a $dlatch, an LDCE on the chip) with a warning in any other process, so the
#   attribute is dropped before proc (setattr -unset always_comb) and the warning gets the student's line.
#   yosys-slang lowers the same latch to a $mux (an if) or a $pmux (a case without default) that reads its own
#   output (no process, so proc never sees a latch): synth_xilinx's check reports 'found logic loop' through a
#   $procmux cell, and the awk turns a loop through a $procmux into an ERROR with the if's line, or the case's
#   (the second src of a $pmux is the case statement; the first is one item). rd = the reader, for the wording.
#   A loop with no $procmux in it (two assigns) is not this error: the warning passes through as before.
#   Two lines in one message are named in order (file, then line number).
# The same awk reads both readers' output: slang's src attributes are file:line.col (yosys': file:line.col-line.col),
# loc() cuts both to file:line.
# The first run has no hierarchy -check: UNISIM primitives (BUFG, MMCME2_BASE) are defined by synth_xilinx's cell
# library in the second run, which checks. A conflict whose drivers are $tribuf cells (two assigns with a z to
# one tri bus in one module) is not this error: synth_xilinx builds those two drivers as logic (tribuf -logic),
# as Vivado does, so the build goes on with a warning [tristate-to-logic] that names the z lines and what the
# board shows where the simulation shows z or x. (A z driver behind a submodule port stays a $_TBUF_ cell, and
# nextpnr's verdict, internal-tristate, follows.)
# An empty module instantiated with a parameter is a black box to yosys, and hierarchy -check stops with 'is used
# with parameters but is not parametric': that is the empty-module error with the module's line, and the second
# reader is not tried for it (yosys-slang drops the empty module and builds the design with its outputs x).
# The sensitivity list of a dual-edge block may span lines, so srcline() joins up to six lines from the block's.
# The two yosys runs (elaborate and write $(TOP).il; synthesize from it) feed one awk, so a warning of the first
# run (an implicit wire) and its consequence in the second (no driver) meet.
YOSYS_AWK = $(FMT_AWK) function loc(s) { sub(/\|.*/,"",s); sub(/\.[0-9]+(-[0-9]+\.[0-9]+)?$$/,"",s); return s } \
	         function cellsrc(c,  t) { load(); if (c in src) return src[c]; t=c; if (t !~ /^\$$/) sub(/^[^.]*\./,"",t); if (t in src) return src[t]; \
	           if (match(t, /\$$[^$$]+:[0-9]+\$$/)) return substr(t, RSTART+1, RLENGTH-2); return "(line unknown)" } \
	         function before(x, y,  fx, fy, nx, ny) { fx=x; sub(/:[0-9]+$$/,"",fx); fy=y; sub(/:[0-9]+$$/,"",fy); if (fx != fy) return fx < fy; nx=x; sub(/.*:/,"",nx); ny=y; sub(/.*:/,"",ny); return nx+0 < ny+0 } \
	         function addline(ls, l,  a, n, i, out, ins) { n=split(ls, a, " and "); out=""; ins=0; for (i=1; i<=n; i++) { if (!ins && before(l, a[i])) { out = out (out==""?"":" and ") l; ins=1 } out = out (out==""?"":" and ") a[i] } \
	           if (!ins) out = out (out==""?"":" and ") l; return out } \
	         function plog(pat,  cmd) { pl_line=""; pl_at=""; cmd="grep -E \"" pat "\" " ylog " 2>/dev/null | tail -1"; cmd | getline pl_line; close(cmd); if (match(pl_line, /\$$proc\$$[^$$]+\$$/)) pl_at=substr(pl_line, RSTART+6, RLENGTH-7) } \
	         function srcline(at, k,  f, n, cmd, l, s) { f=at; sub(/:[0-9]+$$/,"",f); n=at; sub(/.*:/,"",n); l=""; if (k == "") k=1; if (n ~ /^[0-9]+$$/) { cmd="sed -n " n "," n+k-1 "p " f " 2>/dev/null"; while ((cmd | getline s) > 0) l = l (l==""?"":" ") s; close(cmd) } return l } \
	         function lhs(s) { if (match(s, /(^|[^A-Za-z0-9_.])[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])*[[:space:]]*<?=[^=]/)) { s=substr(s,RSTART,RLENGTH); sub(/^[^A-Za-z_]/,"",s); sub(/[[\[<= \t].*/,"",s); return s } return "" } \
	         function alwaysline(l,  f, n, cmd, ln) { f=l; sub(/:[0-9]+$$/,"",f); n=l; sub(/.*:/,"",n); ln=""; cmd="sed -n 1," n "p " f " 2>/dev/null | grep -nE \"(^|[^A-Za-z0-9_])always(_ff|_comb|_latch)?([^A-Za-z0-9_]|$$)|^[[:space:]]*(initial|assign)[^A-Za-z0-9_]\" | tail -1"; cmd | getline ln; close(cmd); if (ln ~ /always/) { sub(/:.*/,"",ln); return f ":" ln } return "" } \
	         function classify(l,  s, a) { if (l == "" || (l in seenl)) return; seenl[l]=1; s=srcline(l); if (s ~ /^[[:space:]]*assign[[:space:]]/) { if (s ~ /\047[sS]?[bBoOhH]?[zZ]/) zl=addline(zl, l); else al=addline(al, l) } else { a=alwaysline(l); if (a != "" && index(" " bl " ", " " a " ") == 0) bl=addline(bl, a) } } \
	         function scan(sig, f,  cmd, l) { cmd="grep -nE \"(^|[^A-Za-z0-9_.])" sig "[[:space:]]*(\\[[^]]*\\])*[[:space:]]*<?=[^=]\" " (f==""?"$(SRCS)":f) " /dev/null 2>/dev/null | grep -vE \"^[^:]*:[0-9]+:[[:space:]]*(logic|reg|wire|integer|bit|localparam|parameter|genvar|for)[^A-Za-z0-9_]\" | cut -d: -f1,2"; while ((cmd | getline l) > 0) classify(l); close(cmd) } \
	         function mdend(  n, a, i, h, lh, base, sig, sf, zn) { n=split(lines, a, " and "); lh=""; for (i=1; i<=n; i++) { h=lhs(srcline(a[i])); if (h != "") lh=h } \
	           base=md; sub(/.*\./,"",base); sig=md; if (lh != "" && lh != base) sig=lh; if (sig ~ /^\$$/ || (sig in done)) { md=""; lines=""; return } done[sig]=1; \
	           zl=""; al=""; bl=""; split("", seenl); for (i=1; i<=n; i++) classify(a[i]); sf=(n>0 ? a[1] : ""); sub(/:[0-9]+$$/,"",sf); sb=sig; sub(/.*\./,"",sb); scan(sb, sf); \
	           if (al != "" && bl != "") { bad=1; print fmt("ERROR", "always-and-assign", addline(al, bl), sig " is written by an always block (" bl ") and by a continuous assign (" al "): yosys resolved the conflict to a constant, so the board would not do what the simulation showed.", "drive " sig " from one of them: keep the assign and delete the always block, or move the expression into the always block and delete the assign.") } \
	           else if (bl ~ / and /) { bad=1; print fmt("ERROR", "two-always-drivers", bl, sig " is written from two always blocks (" bl "): yosys resolved the conflict to a constant, so the board would not do what the simulation showed.", "drive " sig " from one always block (merge the two, or give each block its own signal).") } \
	           else if (al ~ / and / || (al != "" && zl != "")) { bad=1; print fmt("ERROR", "two-assign-drivers", addline(al, zl), sig " is written by two continuous assigns (" addline(al, zl) "): yosys resolved the conflict to a constant, so the board would not do what the simulation showed.", "drive " sig " from one assign (select with a mux:  assign " sig " = sel ? b : a;).") } \
	           else if (zl != "" && al == "" && bl == "") { zn=split(zl, a, " and "); lastz=zl; lastsig=sig; \
	             print fmt("warning", "tristate-to-logic", zl, sig " has two tri-state drivers (a z, at " zl (zn==1 ? ", one assign in a generate loop, one driver per iteration" : "") ") and is not an inout pin of the top module: the chip has tri-state buffers on its pins only, so yosys built the two drivers as logic, as Vivado does (UG901 Ch.5 Tristates). On the board " sig " is never z: with no driver on it shows one driver\047s value, with both on the other\047s, where the simulation shows z and x.", "select with a mux instead, so the simulation shows what the board does:  assign " sig " = sel ? b : a;  and keep z for an inout pin only.") } \
	           else if (lines != "") { bad=1; print fmt("ERROR", "multiple-drivers", lines, sig " is written from more than one place (" lines "): yosys resolved the conflict to a constant, so the board would not do what the simulation showed.", "drive " sig " from one always block or one assign; give each other writer its own signal.") } \
	           md=""; lines="" } \
	         function lpend(  f, n, ln, cmd) { lp=0; if (lsrc == "" || lw == "" || (lw in ldone)) return; ldone[lw]=1; bad=1; \
	           f=lsrc; sub(/:[0-9]+$$/,"",f); n=lsrc; sub(/.*:/,"",n); ln=""; cmd="sed -n 1," n "p " f " | grep -E always | tail -1"; cmd | getline ln; close(cmd); \
	           print fmt("ERROR", "latch-loop", lsrc, "latch inferred for " lw " (" (lkind=="case" ? "a case without default" : "an if without else") " in " (ln ~ /always_comb/ ? "always_comb" : "an always block") "), and " (rd=="slang" ? "yosys-slang (the second reader, used because yosys\047 own reader refused this code)" : "yosys") " built it as a LUT feedback loop, not a latch, so the board would not do what the simulation showed; Vivado builds an LDCE latch here, with a warning (UG901 Ch.5 Latches).", "give " lw " a value on every path (" (lkind=="case" ? "a default: item" : "an else branch") ", or a default at the top of the block); if you meant a latch, write always_latch instead of always_comb (both readers build that as a latch).") } \
	         function load(  l,f) { if (loaded) return; loaded=1; while ((getline l < il) > 0) { \
	           if (l ~ /^ *attribute \\src "/) { cur=l; sub(/^ *attribute \\src "/,"",cur); sub(/"$$/,"",cur) } \
	           else if (l ~ /^attribute \\blackbox 1$$/) bbx=1; \
	           else if (l ~ /^module \\/) { split(l,f," "); if (bbx) blackbox[f[2]]=1; bbx=0; cur="" } \
	           else if (l ~ /^ *(wire|module|process) /) cur=""; \
	           else if (l ~ /^ *cell /) { split(l,f," "); cc=f[3]; type[cc]=f[2]; src[cc]=loc(cur); order[++ncell]=cc; cur="" } \
	           else if (l ~ /^ *connect \\Q /) { q=l; sub(/^ *connect \\Q \\?/,"",q); qn[cc]=q } \
	           else if (l ~ /^ *connect \\AD /) { q=l; sub(/^ *connect \\AD /,"",q); ad[cc]=q } } } \
	         lp && !/^    / { lpend() } \
	         /^Warning: found logic loop in module / { lp=1; lsrc=""; lw=""; print; next } \
	         lp { if (/^    cell \$$procmux\$$[0-9]+ \(\$$p?mux\) source: / && lsrc == "") { s=$$0; sub(/.*source: /,"",s); lkind=(/\(\$$pmux\)/ ? "case" : "if"); if (lkind == "case") sub(/^[^|]*\|/,"",s); lsrc=loc(s) } \
	              if (/^    wire \\/) { lw=$$0; sub(/^    wire \\/,"",lw); sub(/ \[[0-9]+\]$$/,"",lw) } print; next } \
	         /Latch inferred for signal .* from (always_comb )?process/ { \
	           sig=$$0; sub(/.*Latch inferred for signal `?\\?/,"",sig); sub(/. from (always_comb )?process.*/,"",sig); sub(/^.*\\/,"",sig); \
	           at=$$0; sub(/.*\$$proc\$$/,"",at); sub(/\$$[0-9]+.*/,"",at); ln=srcline(at); if (ln ~ /always_latch/) next; \
	           lb=srcline(at, 8); pi=0; pc=0; if (match(lb, /(^|[^A-Za-z0-9_])if[[:space:]]*\(/)) pi=RSTART; if (match(lb, /(^|[^A-Za-z0-9_])case[xz]?[[:space:]]*\(/)) pc=RSTART; lk=(pc && (!pi || pc<pi)) ? "case" : "if"; \
	           print fmt("warning", "latch", at, "latch inferred for " sig " (" (lk=="case" ? "a case without default" : "an if without else") " in " (ln ~ /always_comb/ ? "always_comb" : "an always block") "): " sig " keeps its value when no " (lk=="case" ? "item" : "branch") " assigns it; Vivado builds the latch too, with the same warning (UG901 Ch.5 Latches).", "if you meant a register, write always_ff with a clock; if a latch, always_latch; if neither, give " sig " a value on every path (" (lk=="case" ? "a default: item" : "an else branch") ", or a default at the top of the block)."); next } \
	         /Async reset .* yields non-constant value/ { print; plog("Found async reset"); sig=$$0; sub(/.*for signal \\/,"",sig); sub(/\.$$/,"",sig); rst=$$0; sub(/.*Async reset \\/,"",rst); sub(/ yields.*/,"",rst); bad=1; \
	           print fmt("ERROR", "async-reset-nonconst", pl_at, "this always_ff has an asynchronous reset (posedge " rst "), so on " rst "\047s edge every signal it writes must get a constant, and " sig " does not: it is written after the if (" rst ") ... else ..., or from a signal, so on the reset edge it would load a value no flip-flop on the chip can load.", "make the reset if the whole block, with a constant for every signal in its first branch:  if (" rst ") begin q <= 0; " sig " <= 0; end else begin q <= ...; " sig " <= ...; end"); next } \
	         /Multiple edge sensitive events found for this signal/ { print; plog("Creating register for signal"); sig=pl_line; sub(/.*signal `\\[^.]*\.\\?/,"",sig); sub(/\047.*/,"",sig); \
	           ev=srcline(pl_at, 6); gsub(/[[:space:]]+/," ",ev); if (match(ev, /@[[:space:]]*\([^)]*\)/)) ev=substr(ev,RSTART,RLENGTH); else ev="@(...)"; n=0; a=""; b=""; t=ev; \
	           while (match(t, /(posedge|negedge)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/)) { s=substr(t,RSTART,RLENGTH); sub(/^[a-z]+[[:space:]]+/,"",s); n++; if (n==1) a=s; else b=s; t=substr(t,RSTART+RLENGTH) } bad=1; \
	           if (n>=2 && a==b) print fmt("ERROR", "dual-edge", pl_at, "this always block is sensitive to both edges of " a " (" ev "), so " sig " would change on every edge: no flip-flop on the chip does that, and neither reader builds it.", "clock the block on one edge (always_ff @(posedge " a ")); for twice the rate use a faster clock (the Basys3\047s is 100 MHz) or count on both phases with two registers."); \
	           else print fmt("ERROR", "async-reset-not-alone", pl_at, "this always block is sensitive to two edges (" ev "), so one of them is an asynchronous reset, but its first if does not test that reset alone (a reset ORed with a synchronous clear: if (rst || clear)), so neither reader can tell the reset from the clock.", "test the reset alone first and put the synchronous clear in the else:  if (" (b==""?"rst":b) ") " sig " <= 0; else if (clear) " sig " <= 0; else " sig " <= " sig " + 1;"); next } \
	         /^ERROR: Failed to get a constant init value for / { print; plog("Found init rule in"); sig=$$0; sub(/.*init value for \\/,"",sig); sub(/:.*/,"",sig); from=$$0; sub(/.*: \\/,"",from); bad=1; \
	           print fmt("ERROR", "initial-from-signal", pl_at, "`" sig " = " from "` here is a start value, not a wire: it reads " from " once, at time 0 (IEEE 1800-2017 6.8), and the chip has no power-up value that follows a signal, so yosys stops.", "for a wire write  assign " sig " = " from ";  for a register give " sig " a constant start value (logic [15:0] " sig " = \047" "0;) and load " from " with the clock (if (btnC) " sig " <= " from ";)."); next } \
	         /^ERROR: Module `\\[^\047]*\047 referenced in module `\\[^\047]*\047 .*is not part of the design/ { print; m=$$0; sub(/.*Module `\\/,"",m); sub(/\047.*/,"",m); at=""; cmd="grep -nE \"^[[:space:]]*" m "[[:space:]]*(\#|[A-Za-z_])\" $(SRCS) /dev/null | head -1"; cmd | getline at; close(cmd); if (match(at, /^[^:]+:[0-9]+/)) at=substr(at,RSTART,RLENGTH); else at=""; bad=1; \
	           print fmt("ERROR", "module-not-found", at, "the module " m " is instantiated here, and no file the build was given declares it (dewfpga reads the files that hold a module: $(SRCS)).", "put the file that declares " m " in this folder, or check the spelling of the module name."); next } \
	         /^ERROR: Module `\\?[^\047]*\047 is used with parameters but is not parametric!/ { print; m=$$0; sub(/.*Module `\\?/,"",m); sub(/\047.*/,"",m); at=""; cmd="grep -nE \"^[[:space:]]*module[[:space:]]+" m "([^A-Za-z0-9_]|$$)\" $(SRCS) /dev/null | head -1"; cmd | getline at; close(cmd); if (match(at, /^[^:]+:[0-9]+/)) at=substr(at,RSTART,RLENGTH); else at=""; \
	           load(); inst=""; for (i=1; i<=ncell; i++) if (type[order[i]] == "\\" m) { c=order[i]; sub(/^\\/,"",c); inst = inst (inst==""?"":" and ") c } bad=1; \
	           print fmt("ERROR", "empty-module", at, "the module " m (at==""?"":" (" at ")") ", instantiated as " (inst==""?"a cell":inst) " with a parameter (\#(...)), " (("\\" m) in blackbox ? "has no body (no assign, no always), so yosys kept it as a black box" : "is a black box to yosys") ", and a black box takes no parameter: yosys stops here (yosys-slang, the second reader, would drop the empty module and leave its outputs x, so it is not tried). Not a size problem.", "write the body of " m ", or comment the instance " (inst==""?"":inst " ") "out until it is written."); next } \
	         /Warning: Identifier `\\[^\047]*::[^\047]*\047 is implicitly declared/ { \
	           at=$$0; sub(/: Warning: .*/,"",at); nm=$$0; sub(/.*Identifier `\\/,"",nm); sub(/\047.*/,"",nm); pk=nm; sub(/::.*/,"",pk); \
	           f=""; cmd="grep -lE \"^[[:space:]]*package[[:space:]]+" pk "[[:space:];]\" *.sv *.v 2>/dev/null"; cmd | getline f; close(cmd); sf=at; sub(/:[0-9]+$$/,"",sf); \
	           print fmt("ERROR", "package-file-not-given", at, nm " names the package " pk ", and yosys was not given it (it reads the files that hold a module: $(SRCS)), so it would build " nm " as an undriven wire: x on the board.", "add   `include \"" (f==""?"the file that declares " pk:f) "\"   as the first line of " sf "; or move the package into " sf ", above the module."); bad=1; next } \
	         /Warning: Package `\\.* not found for import, removing import statement/ { pk=$$0; sub(/.*Package `\\/,"",pk); sub(/\047.*/,"",pk); \
	           at=""; cmd="grep -nE \"import[[:space:]]+" pk "[[:space:]]*::\" $(SRCS) /dev/null | head -1"; cmd | getline at; close(cmd); sub(/:[^:]*$$/,"",at); if (at=="") at="$(firstword $(SRCS))"; \
	           print; print fmt("ERROR", "package-file-not-given", at, "`import " pk "::*` names the package " pk ", and yosys was not given it (it reads the files that hold a module: $(SRCS)), so it dropped the import and would build every name of " pk " as an undriven wire: x on the board.", "add   `include \"the file that declares " pk "\"   as the first line of $(firstword $(SRCS)); or move the package into that file, above the module."); bad=1; noimp=1; next } \
	         /Warning: Identifier `\\.* is implicitly declared\./ { \
	           name=$$0; sub(/.*Identifier `\\/,"",name); sub(/\047 is implicitly.*/,"",name); at=$$1; sub(/:$$/,"",at); \
	           pre=name; sub(/[.\[].*/,"",pre); \
	           if (name ~ /\./ && !index(" " ifp " ", " " pre " ")) { bad=1; \
	             if (index(" " ifi " ", " " pre " ")) print fmt("ERROR", "interface-member", at, name " is a member of the interface instance " pre ", used in the module that instantiates it. yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); an interface used this way is not supported yet (\#4).", "pass the interface to a module through an interface port, or keep those signals as plain logic in the module."); \
	             else print fmt("ERROR", "hierarchical-name", at, name " is a hierarchical name (a signal inside another instance). yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); Vivado resolves hierarchical names (UG901 Ch.9 Table 20).", "bring that signal out through an output port of its module and connect it here."); next } \
	           impl[name]=at; print; next } \
	         /Warning: Wire .* is used but has no driver\./ { w=$$0; sub(/.*Warning: Wire /,"",w); sub(/ is used but has no driver.*/,"",w); sub(/^[^.\\]*\.\\?/,"",w); sub(/ \[[0-9]+\]$$/,"",w); \
	           if (w in impl && !(w in done) && !noimp) { done[w]=1; bad=1; print fmt("ERROR", "undeclared-name", impl[w], w " is not declared anywhere and nothing drives it: yosys made it a 1-bit wire stuck at x and built the design without it (dewfpga sim refuses this code).", "declare it, or check the spelling (a typo of a declared name).") } print; next } \
	         /Warning: reg \047\\[^\047]*\047 is assigned in a continuous assignment at / { n=$$0; sub(/.*reg \047\\/,"",n); sub(/\047.*/,"",n); a=$$0; sub(/.* at /,"",a); sub(/\.$$/,"",a); ca[n]=loc(a); print; next } \
	         md != "" && !/^    (port .* of cell |module input )/ { mdend() } \
	         /Warning: multiple conflicting drivers for / { s=$$0; sub(/.*drivers for /,"",s); sub(/:$$/,"",s); sub(/^[^.\\$$]*\.\\?/,"",s); sub(/ \[[0-9]+\]$$/,"",s); md=s; lines=""; print; next } \
	         md != "" { if (/^    module input /) { print; next } c=$$0; sub(/.*of cell /,"",c); sub(/ \(.*/,"",c); load(); \
	           l=cellsrc(c); if (l != "(line unknown)" && index(" " lines " ", " " l " ") == 0) lines = addline(lines, l); print; next } \
	         /^ERROR: Cell .* already driven by / { print; if (lastz != "") { bad=1; print fmt("ERROR", "internal-tristate", lastz, "the tri-state drivers on " lastsig " (a z, at " lastz ") could not be built as logic: yosys stopped with the line above. The chip has tri-state buffers on its pins only, so a z belongs on an inout pin of the top module.", "select with a mux instead:  assign " lastsig " = sel ? b : a;  and keep z for an inout pin only.") } next } \
	         /^Warning: Emulating async set \+ reset with several FFs and a mux for / { emu++; next } \
	         { print } \
	         END { if (lp) lpend(); load(); for (c in type) if (type[c] ~ /^\$$aldffe?$$/ && ad[c] !~ /^([0-9]+\047[01]+|[0-9]+)$$/ && !(src[c] in adone)) { adone[src[c]]=1; bad=1; nald++; \
	                 t=srcline(src[c], 6); gsub(/[[:space:]]+/," ",t); ev=""; if (match(t, /@[[:space:]]*\([^)]*\)/)) { ev=substr(t,RSTART,RLENGTH); t=substr(t,RSTART+RLENGTH) } cond=""; if (match(t, /(^|[^A-Za-z0-9_])if[[:space:]]*\([^()]*\)/)) { cond=substr(t,RSTART,RLENGTH); sub(/^.*\(/,"",cond); sub(/\)$$/,"",cond); gsub(/^ +| +$$/,"",cond) } \
	                 rst=""; redge=""; clk=""; cedge=""; u=ev; while (match(u, /(posedge|negedge)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/)) { e=substr(u,RSTART,RLENGTH); nm=e; sub(/^[a-z]+[[:space:]]+/,"",nm); sub(/[[:space:]].*/,"",e); u=substr(u,RSTART+RLENGTH); \
	                   if (cond != "" && match(cond, "(^|[^A-Za-z0-9_])" nm "([^A-Za-z0-9_]|$$)")) { rst=nm; redge=e } else if (clk == "") { clk=nm; cedge=e } else if (rst == "") { rst=nm; redge=e } } \
	                 if (rst == "") { rst="rst"; redge="posedge" } if (cond == "") cond=rst; evs=ev; sub(/^@[[:space:]]*/,"",evs); if (evs == "") evs="(posedge clk or " redge " " rst ")"; \
	                 adn=ad[c]; sub(/^\\/,"",adn); sub(/ \[.*/,"",adn); if (adn ~ /^\$$/ || adn == "") adn=""; thn=""; els=""; \
	                 if (match(t, /if[[:space:]]*\([^()]*\)[^;]*<=[^;]*;/)) { thn=substr(t,RSTART,RLENGTH); sub(/^.*<=[[:space:]]*/,"",thn); sub(/[[:space:]]*;$$/,"",thn) } if (match(t, /(^|[^A-Za-z0-9_])else[^;]*<=[^;]*;/)) { els=substr(t,RSTART,RLENGTH); sub(/^.*<=[[:space:]]*/,"",els); sub(/[[:space:]]*;$$/,"",els) } neg=-1; \
	                 if (cond ~ ("^[!~][[:space:]]*" rst "$$") || cond ~ (rst "[[:space:]]*==[[:space:]]*(1\047b0|\0470|0)$$") || cond ~ (rst "[[:space:]]*!=[[:space:]]*(1\047b1|\0471|1)$$")) neg=1; else if (cond ~ ("^" rst "$$") || cond ~ (rst "[[:space:]]*==[[:space:]]*(1\047b1|\0471|1)$$")) neg=0; \
	                 if ((redge == "posedge" && neg == 1) || (redge == "negedge" && neg == 0)) \
	                   print fmt("ERROR", "async-reset-polarity", src[c], "this always_ff is sensitive to " redge " " rst ", but its first if tests " cond ", so the reset branch runs while " rst " is " (redge=="posedge" ? "low" : "high") " and on " rst "\047s " (redge=="posedge" ? "rising" : "falling") " edge the block takes the else branch, which loads " qn[c] " from " (adn != "" ? adn : (els != "" ? els : "a signal")) ": no flip-flop on the chip loads a signal on its reset edge (yosys emulates it with FFs and a mux, so the board would not do what the simulation showed).", "test " rst " at the level its edge leaves it:  if (" (redge=="posedge" ? rst : "!" rst) ") " qn[c] " <= 0; else ...;  or keep if (" cond ") and write " (redge=="posedge" ? "negedge" : "posedge") " " rst " in the sensitivity list."); \
	                 else { if (adn == "") adn=(thn != "" ? thn : "a signal"); self=match(adn, "(^|[^A-Za-z0-9_])" qn[c] "([^A-Za-z0-9_]|$$)"); \
	                   print fmt("ERROR", "async-reset-nonconst", src[c], "this always_ff has an asynchronous reset " evs ", so on " rst "\047s edge every signal it writes must get a constant; here " qn[c] " is loaded from " adn (self ? ", its own value" : "") ". yosys emulates that with " (self ? "a loop" : "FFs and a mux") ", so the board would not do what the simulation showed.", (self ? "reset to a constant, and count on the clock, on a one-clock pulse made from " rst ":  if (" cond ") " qn[c] " <= 0; else if (" rst "_pulse) " qn[c] " <= " qn[c] " + 1;  (" rst "_pulse: " rst " registered twice on clk, high for one clock when it rises)." : "reset to a constant, and load " adn " with the clock, behind an input of your own (load):  if (" cond ") " qn[c] " <= 0; else if (load) " qn[c] " <= " adn "; else " qn[c] " <= " qn[c] " + 1;")) } } \
	               if (emu && !nald) print "Warning: Emulating async set + reset with several FFs and a mux (yosys, for " emu " flip-flop" (emu>1 ? "s" : "") ")"; \
	               exit bad+0 }
# a typedef of a packed array with two or more dimensions (typedef logic [3:0][6:0] tab_t;) used to declare
# a parameter or a net (localparam tab_t SEG = {...}; tab_t tab;): yosys keeps that value as one flat vector
# and SEG[i] picks one bit instead of a row, with no warning, so the table would be built wrong. The same
# dimensions written on the declaration itself are built right (a net), or refused (a parameter). The scan
# runs before sim too: iverilog 13.0 aborts on such a parameter (failed assertion packed_dims.size() == 1)
# with no line a student can act on, and the same code could never reach a bitstream.
# The source scans see the code only: // and /* */ comments are cut first (a typedef name or a package name in a
# comment is not a use), a block comment may span lines. FNR==1 restarts the block state per file.
STRIP_AWK = FNR==1 { inc=0 } \
	         { if (inc) { if (sub(/^.*\*\//, "")) inc=0; else next } \
	           while (1) { a=index($$0,"//"); b=index($$0,"/*"); if (b==0 || (a>0 && a<b)) { if (a>0) $$0=substr($$0,1,a-1); break } \
	             if (!sub(/\/\*([^*]|\*+[^*\/])*\*+\//, "")) { $$0=substr($$0,1,b-1); inc=1; break } } }
TYPEDEF_AWK = $(FMT_AWK) $(STRIP_AWK) FNR==1 { file=FILENAME } \
	         /^[[:space:]]*typedef[[:space:]]/ && /\][[:space:]]*\[[^]]*\][[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*;/ { t=$$0; sub(/[[:space:]]*;.*/,"",t); sub(/.*[[:space:]\]]/,"",t); td[t]=file ":" FNR; \
	           d=$$0; sub(/^[[:space:]]*typedef[[:space:]]+/,"",d); sub(/[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*;.*/,"",d); dims[t]=d; next } \
	         { for (t in td) if (match($$0, "(^|[^A-Za-z0-9_$$.])" t "[[:space:]]+[A-Za-z_][A-Za-z0-9_]*")) { \
	           p=substr($$0, RSTART, RLENGTH); sub(/.*[[:space:]]/,"",p); \
	           print fmt("ERROR", "packed-typedef-2d", file ":" FNR, p " is declared with the type " t ", a packed array with two dimensions (" td[t] "): yosys keeps a value of such a typedef as one flat vector, so " p "[i] picks one bit instead of one row, and the table would be built wrong.", "write the dimensions on the declaration itself:  " dims[t] " " p ";  a parameter yosys refuses in that form, so keep it flat and take a row with +:  (localparam logic [N*W-1:0] " p " = {...}; " p "[i*W +: W]).") > "/dev/stderr"; bad=1 } } \
	         END { exit bad+0 }
# $isunknown is looked for in the code yosys' preprocessor hands to the parser (read_verilog -ppdump), not in
# the raw text: a block comment (folded onto one line there) is dropped here, and a `ifndef SYNTHESIS block is
# already gone (read_verilog defines SYNTHESIS, as Vivado does: UG901). `file_push/`file_pop keep the file
# and the line of an `include; the dump pads with blank lines, so the line count is the student's.
ISUNKNOWN_AWK = $(FMT_AWK) /^-- Verilog code after preprocessor --$$/ { dump=1; next } \
	         /^-- END OF DUMP --$$/ { dump=0; next } \
	         !dump { next } \
	         /^`file_push "/ { f=$$0; sub(/^`file_push "/,"",f); sub(/".*/,"",f); sp++; fs[sp]=file; ls[sp]=line; file=f; line=0; next } \
	         /^`file_pop/ { file=fs[sp]; line=ls[sp]; sp--; next } \
	         { line++; s=$$0; while ((i=index(s,"/*")) > 0) { j=index(substr(s,i+2),"*/"); if (j==0) { s=substr(s,1,i-1); break } s=substr(s,1,i-1) substr(s,i+j+3) } \
	           if (s ~ /\$$isunknown[[:space:]]*\(/) { print fmt("ERROR", "isunknown-in-design", file ":" line, "$$isunknown in a design: on the board a signal is never x, so it is 0 there (and dewfpga sim shows 0); yosys folds it to the constant 1 instead, so the bitstream would not do what the simulation showed.", "remove it from the design; $$isunknown belongs in the testbench."); bad=1 } } \
	         END { exit bad+0 }
# an inout pin tied to a constant z (assign JA[7:1] = 'z) and read back: yosys keeps the z as the pin's driver
# and the read gives z, so the pin's value never reaches the design (Vivado reads the pin). A driver that is
# only z drives nothing: it is dropped from the elaborated design, and the pin is read like a read-only inout.
# yosys-slang writes that z driver as a $buf cell whose A is all x and whose Y is the pin (connect \A 7'x;
# connect \Y \JA [7:1]): that cell is dropped the same way (kept, the IOBUF would drive the pin all the time).
INOUT_Z_AWK = /^module / { split("", io) } \
	         /^  wire (.* )?inout [0-9]+ / { io[$$NF]=1 } \
	         /^  connect \\/ && ($$2 in io) && $$NF ~ /^[0-9]+\047z+$$/ && (NF==3 || (NF==4 && $$3 ~ /^\[/)) { next } \
	         /^  cell \$$buf / { buf=$$0; ax=0; yio=0; next } \
	         buf != "" { buf=buf "\n" $$0; if ($$1=="connect" && $$2=="\\A" && $$3 ~ /^[0-9]+\047x+$$/) ax=1; \
	           if ($$1=="connect" && $$2=="\\Y" && ($$3 in io) && (NF==3 || (NF==4 && $$4 ~ /^\[/))) yio=1; \
	           if ($$0 ~ /^  end$$/) { if (!(ax && yio)) print buf; buf="" } next } \
	         { print }
# a function or task argument passed by reference (ref logic [3:0] x): yosys' reader stops at a syntax error,
# and yosys-slang builds the call as nothing (the caller's variable never changes, no warning), so it is refused
# here with the line, before either reader runs. The scan reads the code without comments.
REF_AWK = $(FMT_AWK) $(STRIP_AWK) \
	         /(^|[(,])[[:space:]]*ref[[:space:]]+[A-Za-z_\[]/ { fn=$$0; if (match(fn, /(function|task)[^(]*\(/)) { sub(/[[:space:]]*\(.*/,"",fn); sub(/.*[[:space:]]/,"",fn); fn=(fn ~ /^(function|task)$$/ ? "a function or task" : "function " fn) } else fn="a function or task"; \
	           a=$$0; sub(/^.*[(,][[:space:]]*ref[[:space:]]+/,"",a); sub(/^[[:space:]]*ref[[:space:]]+/,"",a); sub(/[,)].*/,"",a); \
	           print fmt("ERROR", "ref-argument", FILENAME ":" FNR, fn " takes an argument by reference (ref " a "): yosys does not read ref, and yosys-slang drops it, so the variable it is called with would never change on the board.", "pass the value in and return it (function automatic logic [3:0] inc(input logic [3:0] x); ... return x + 1;  and  v = inc(v);).") > "/dev/stderr"; bad=1 } \
	         END { exit bad+0 }
# a package used through `import pkg::*;` or pkg::NAME must be in a file the tools are given: dewfpga hands
# iverilog and yosys the files that hold a module (a package in its own file, pkg.sv, is left out; an `include
# brings it in). iverilog stops at a syntax error on the import line; yosys drops the import with a warning,
# declares every name from the package as an implicit 1-bit wire with no driver and would build the design
# without it. The scan names the reference's line and the file that declares the package, before either
# tool runs. A class scope (util::f) is not a package: a class declared in the sources is not reported.
PKG_AWK = $(FMT_AWK) $(STRIP_AWK) \
	         /^[[:space:]]*(package|class)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/ { d=$$0; sub(/^[[:space:]]*(package|class)[[:space:]]+/,"",d); sub(/[^A-Za-z0-9_].*/,"",d); decl[d]=1 } \
	         { l=$$0; while (match(l, /[A-Za-z_$$][A-Za-z0-9_$$]*[[:space:]]*::/)) { n=substr(l,RSTART,RLENGTH); sub(/[[:space:]]*::$$/,"",n); l=substr(l,RSTART+RLENGTH); \
	             if (n !~ /^\$$/ && !(n in ref)) { ref[n]=FILENAME ":" FNR; how[n]=(l ~ /^[[:space:]]*\*/ && $$0 ~ ("import[[:space:]]+" n "[[:space:]]*::")) ? "`import " n "::*`" : n "::" (match(l,/[A-Za-z_][A-Za-z0-9_]*/) ? substr(l,RSTART,RLENGTH) : "") } } } \
	         END { for (n in ref) if (!(n in decl)) { bad=1; f=""; cmd="grep -lE \"^[[:space:]]*package[[:space:]]+" n "[[:space:];]\" *.sv *.v *.svh *.vh 2>/dev/null"; cmd | getline f; close(cmd); sf=ref[n]; sub(/:[0-9]+$$/,"",sf); \
	             if (f != "") print fmt("ERROR", "package-file-not-given", ref[n], how[n] " names the package " n ", which is declared in " f ", and the tools are not given that file (dewfpga hands them the files that hold a module: $(SRCS)): iverilog stops at a syntax error there; yosys would drop the import and build every name of " n " as an undriven 1-bit wire: x on the board.", "add   `include \"" f "\"   as the first line of " sf "; or move the package into " sf ", above the module.") > "/dev/stderr"; \
	             else print fmt("ERROR", "package-not-found", ref[n], how[n] " names the package " n ", and no file in this folder declares it (package " n "; ... endpackage).", "check the spelling, or add the file that declares it and `include it as the first line of " sf ".") > "/dev/stderr" } \
	           exit bad+0 }
# a failed build must not leave the previous .bit behind, so a student never flashes yesterday's design by mistake.
# $display/$print in synthesizable code has no hardware; Vivado drops it silently, so it is dropped here too.
# Two readers. yosys' own read_verilog goes first: every design it builds is built exactly as before. When it
# refuses the code for any reason (its own syntax error, or one of the checks above that yosys-slang resolves:
# a hierarchical name, an interface member, a 2-D typedef), and slang.so is installed, yosys-slang reads the
# same files (it understands the SystemVerilog Vivado accepts: interfaces, packages in the same file, unpacked
# arrays, foreach, break, default and named arguments, streaming, extern modules ...) and the same synthesis
# runs on its output, through the same checks. When both refuse, the student sees yosys' ERROR line and slang's
# diagnostic (file:line:col, the source line and the caret; slang prints it only into the -l log under -q).
# When slang.so is not installed and yosys' refusal is one slang may resolve (a parser error, file:line: ERROR:,
# or one of the three checks), a note names the missing reader and the install step, so the student knows the
# build stopped short of the second reader. slang's own wording is kept, except the enum methods next()/prev()
# ("unsupported system task 'next'": slang builds first()/last() only), which get the student's line and the fix.
# A .v file is Verilog-2005 (in Vivado too, UG901 Ch.10: *.v is compiled as Verilog 2005, *.sv as SystemVerilog):
# yosys' reader reads it without -sv. yosys-slang reads a copy of each .v, written into a private folder, wrapped in
# `begin_keywords "1364-2005" ... `end_keywords (IEEE 1800-2017 22.14), with a `line directive so its messages
# name the student's file and line, so bit and final are names there, not keywords. (slang's
# --map-keyword-version 1364-2005+<pattern> was tried in every form, relative, absolute, repeated, and never
# applied with this slang build; the wrapper is the form the standard defines and the one measured to work.)
# The scans before the readers: $isunknown, the package file, ref arguments (neither reader builds those right).
# The 2-D typedef scan is yosys' alone (slang builds such a parameter right), so it runs inside the first path.
READ_VERILOG = $(if $(filter %.sv,$(SRCS)),read_verilog $(INC) -sv $(filter %.sv,$(SRCS));) $(if $(filter %.v,$(SRCS)),read_verilog $(INC) $(filter %.v,$(SRCS));)
# The wrapped copies live in a private folder the recipe makes with mktemp -d .dewfpga-kw.XXXXXX in the build folder
# (relative, no spaces, so it can sit inside the yosys command string). Never a fixed name: a folder the student owns
# (top.kw, say) is never removed. Exactly the reserved folder is
# removed when the recipe's shell exits, on every path (success, a refused file, a signal). The copies are numbered
# in list order (1.v, 2.v ...), so two sources that differ only in their folder (a/b.v and a_b.v) never share a name.
# iverilog reads every file as SystemVerilog too (-g2012), so the simulation compiles the same wrapped copies;
# an error in a .v still names the student's file:line (the `line directive). A .v that `includes a file finds it
# through -I (the copy sits in the private folder, not beside the header).
# $(call MKKW,<files>) is a shell fragment: afterwards $$KWSRCS is the list the reader gets, in the original order,
# .sv files as they are, each .v as its copy; $$KW is the folder.
MKKW = KW=$$(mktemp -d .dewfpga-kw.XXXXXX) || { echo "ERROR [cannot-write-here]: cannot create a work folder in $$(pwd). Fix: check that this folder is writable and the disk is not full. $(URL)cannot-write-here/" >&2; exit 1; }; : > "$$KW/.dewfpga-kw"; trap 'rm -rf "$$KW"' EXIT; trap 'rm -rf "$$KW"; exit 130' INT TERM HUP; n=0; KWSRCS=""; for f in $(1); do case $$f in *.v) n=$$((n+1)); { printf '`begin_keywords "1364-2005"\n`line 1 "%s" 0\n' "$$f"; cat "$$f"; printf '\n`end_keywords\n'; } > "$$KW/$$n.v" || exit 1; KWSRCS="$$KWSRCS $$KW/$$n.v" ;; *) KWSRCS="$$KWSRCS $$f" ;; esac; done
SYNTH        = read_rtlil $(TOP).il; synth_xilinx -flatten -abc9 -nobram -arch xc7 -top $(TOP); delete t:\$$print; write_json $(TOP).json
$(TOP).json: $(SRCS) $(SRC_DEPS) $(TOP).deps
	@rm -f $(TOP).bit $(TOP).frames $(TOP).fasm $(TOP)_routed.json $(TOP).il $(TOP).rv.out $(TOP).sl.out $(TOP).slang.log $(TOP).yosys.log
	@"$(PY)" "$(CHECKER)" --fix-ports $(SRCS)
	@yosys -p "read_verilog $(INC) -sv -ppdump $(SRCS)" 2>/dev/null | awk '$(ISUNKNOWN_AWK)'
	@awk '$(PKG_AWK)' $(SRCS) $(SRC_DEPS)
	@awk '$(REF_AWK)' $(SRCS) $(SRC_DEPS)
	@ifn=$$(grep -hoE '^[[:space:]]*interface[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' $(sort $(SRCS) $(foreach d,$(INCDIRS),$(wildcard $(d)/*.sv $(d)/*.v $(d)/*.svh))) | awk '{print $$2}' | paste -sd'|' -); ifi=""; \
	  [ -z "$$ifn" ] || ifi=$$(grep -hoE "^[[:space:]]*($$ifn)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*" $(SRCS) | awk '{print $$2}' | paste -sd' ' -); ifp=""; \
	  [ -z "$$ifn" ] || ifp=$$(cat $(SRCS) | tr '\n' ' ' | grep -oE "[(,][[:space:]]*($$ifn)(\.[A-Za-z_][A-Za-z0-9_]*)?[[:space:]]+[A-Za-z_][A-Za-z0-9_]*" | awk '{print $$NF}' | paste -sd' ' -); \
	  set -o pipefail; rc=0; \
	  { awk '$(TYPEDEF_AWK)' $(TYPEDEF_FILES) \
	    && yosys -q -l $(TOP).yosys.log -p "$(READ_VERILOG) hierarchy -top $(TOP); setattr -unset always_comb; proc; write_rtlil $(TOP).il" \
	    && awk '$(INOUT_Z_AWK)' $(TOP).il > $(TOP).il.tmp && mv $(TOP).il.tmp $(TOP).il \
	    && yosys -q -p "$(SYNTH)"; } 2>&1 \
	  | awk -v rd=verilog -v ifi="$$ifi" -v ifp="$$ifp" -v il=$(TOP).il -v ylog=$(TOP).yosys.log '$(YOSYS_AWK)' > $(TOP).rv.out || rc=$$?; \
	  if [ $$rc -eq 0 ]; then cat $(TOP).rv.out; rm -f $(TOP).rv.out $(TOP).yosys.log; exit 0; fi; \
	  crash=$$(grep -oE '(Segmentation fault|Abort trap|Bus error|Illegal instruction)(: [0-9]+)?' $(TOP).rv.out | head -1); \
	  crashmsg() { rl=$$(grep -nE '(^|[^A-Za-z0-9_.])[0-9]+(\.[0-9]+)?[eE][-+]?[0-9]+|[^A-Za-z0-9_.][0-9]+\.[0-9]+([^0-9.]|$$)' $(SRCS) /dev/null | head -1); at=$$(echo "$$rl" | cut -d: -f1,2); \
	    if [ -n "$$at" ]; then echo "$$at: ERROR [yosys-crashed]: yosys' own reader crashed ($$crash) without a message, and this line holds a real number ($$(echo "$$rl" | cut -d: -f3- | grep -oE '[0-9]+(\.[0-9]+)?[eE][-+]?[0-9]+|[0-9]+\.[0-9]+' | head -1)): a real value in a parameter (localparam MAX = 1e1) is a known cause. Fix: write the value as an integer (10, 50_000_000). $(URL)yosys-crashed/"; \
	    else echo "ERROR [yosys-crashed]: yosys' own reader crashed ($$crash) without a message. Fix: take the design apart until the crash goes away, and report that code (github.com/nosey-dewdrop/dewfpga/issues). $(URL)yosys-crashed/"; fi; }; \
	  if [ ! -f "$(SLANG)" ]; then if [ -n "$$crash" ]; then crashmsg; else cat $(TOP).rv.out; fi; \
	    if [ -n "$$crash" ] || grep -qE '^[^ ]+:[0-9]+: ERROR: |\[hierarchical-name\]|\[interface-member\]|\[packed-typedef-2d\]' $(TOP).rv.out; then \
	      echo "note [second-reader-missing]: yosys' own reader refused this code, and yosys-slang, the second reader (it reads the SystemVerilog Vivado accepts: interfaces, unpacked arrays, foreach, break, enum methods first/last ...), is not installed: $(SLANG) not found. Fix: run  dewfpga install  (it builds that reader, ~3 min), then build again. $(URL)second-reader-missing/"; fi; \
	    rm -f $(TOP).rv.out $(TOP).yosys.log; exit $$rc; fi; \
	  if grep -qE '\[(empty-module|always-and-assign|two-always-drivers|two-assign-drivers|multiple-drivers)\]' $(TOP).rv.out; then cat $(TOP).rv.out; rm -f $(TOP).rv.out $(TOP).yosys.log; exit $$rc; fi; \
	  rm -f $@ $(TOP).il; rc=0; $(call MKKW,$(SRCS)); \
	  { yosys -m "$(SLANG)" -q -l $(TOP).slang.log -p "read_slang $(INC)$$KWSRCS; hierarchy -top $(TOP); proc; write_rtlil $(TOP).il" \
	    && awk '$(INOUT_Z_AWK)' $(TOP).il > $(TOP).il.tmp && mv $(TOP).il.tmp $(TOP).il \
	    && yosys -q -p "$(SYNTH)"; } 2>&1 \
	  | awk -v rd=slang -v ifi="$$ifi" -v ifp="$$ifp" -v il=$(TOP).il '$(YOSYS_AWK)' > $(TOP).sl.out || rc=$$?; \
	  rm -rf "$$KW"; \
	  if [ $$rc -eq 0 ]; then echo "note [read-with-slang]: $(TOP) read with yosys-slang, the second reader (yosys' own reader refused this code; the build is the same from here). $(URL)read-with-slang/"; cat $(TOP).sl.out; rm -f $(TOP).rv.out $(TOP).sl.out $(TOP).slang.log $(TOP).yosys.log; exit 0; fi; \
	  rm -f $@; \
	  if grep -qE '^(ERROR: (Design elaboration failed|Feature unimplemented)|[^ ]+:[0-9]+:[0-9]+: (error|fatal error):)' $(TOP).slang.log; then \
	    coded=0; if [ -n "$$crash" ]; then crashmsg; coded=1; \
	    elif grep -q 'ERROR \[' $(TOP).rv.out; then grep 'ERROR' $(TOP).rv.out; coded=1; \
	    else echo "yosys' reader:"; { grep 'ERROR' $(TOP).rv.out || tail -1 $(TOP).rv.out; } | sed 's/^/  /'; fi; \
	    if echo " $(SRCS) " | grep -q '\.v '; then echo "note [v-is-verilog-2005]: a .v file is read as Verilog-2005 by both readers, as Vivado reads it (UG901 Ch.10): SystemVerilog (logic, always_ff, always_comb, enum ...) belongs in a .sv file. Fix: if your .v file holds SystemVerilog, rename it to .sv. $(URL)v-is-verilog-2005/"; fi; \
	    awk -v coded=$$coded '$(FMT_AWK) \
	         coded { if (/^ERROR: Design elaboration failed/) next; if (/^[^ ]+:[0-9]+:[0-9]+: (error|fatal error): / || /^ERROR: /) { sub(/ at \/[^ ]*\//," at "); print "yosys-slang: " $$0; n=2 } else if (n > 0) { print "    " $$0; n-- } next } \
	         /^[^ ]+:[0-9]+:[0-9]+: error: unsupported system task \047(next|prev)\047$$/ { at=$$0; sub(/:[0-9]+: error: .*/,"",at); em=$$0; sub(/.*system task \047/,"",em); sub(/\047.*/,"",em); n=2; next } \
	         em != "" { v=$$0; if (match(v, "[A-Za-z_][A-Za-z0-9_]*[[:space:]]*[.]" em "[[:space:]]*[(]")) { v=substr(v,RSTART,RLENGTH); sub(/[[:space:]]*[.].*/,"",v) } else v="s"; \
	           print fmt("ERROR", "enum-method-next-prev", at, v "." em "() is an enum method that steps through the values (next/prev): yosys does not build enum methods, and yosys-slang builds first()/last() only; Vivado builds next/prev (UG901 Ch.10 Table 27).", "write the step out as a case on " v ", in the order the enum lists its values (with IDLE, RUN, DONE: case (" v ") IDLE: " v " <= RUN; RUN: " v " <= DONE; DONE: " v " <= IDLE; endcase)."); em=""; print "    " $$0; n--; next } \
	         /^[^ ]+:[0-9]+:[0-9]+: error: use of undeclared identifier \047/ { at=$$0; sub(/:[0-9]+: error: .*/,"",at); nm=$$0; sub(/.*undeclared identifier \047/,"",nm); sub(/\047.*/,"",nm); print fmt("ERROR", "undeclared-name", at, nm " is not declared anywhere: yosys-slang, the second reader, stops here, and yosys\047 own reader refused this code too (its line is above; dewfpga sim refuses it as well).", "declare it, or check the spelling (a typo of a declared name)."); n=2; next } \
	         /^[^ ]+:[0-9]+:[0-9]+: (error|fatal error): / { at=$$0; sub(/:[0-9]+: (error|fatal error): .*/,"",at); s=$$0; sub(/^[^ ]+: (error|fatal error): /,"",s); print fmt("ERROR", "slang-refused", at, s " (yosys-slang, the second reader; yosys\047 own reader refused this code too, its line is above).", "the caret below marks the construct; the page lists the usual ones and what to write instead."); n=2; next } \
	         /^ERROR: Feature unimplemented/ { print fmt("ERROR", "slang-unimplemented", "", "yosys-slang cannot build a construct of this design yet (" $$0 "), and yosys\047 own reader refused the code too (its line is above).", "take the design apart until the build goes through, and report that construct (github.com/nosey-dewdrop/dewfpga/issues)."); next } \
	         n > 0 { print "    " $$0; n-- }' $(TOP).slang.log; \
	  else cat $(TOP).sl.out; fi; rm -f $(TOP).rv.out $(TOP).sl.out $(TOP).yosys.log; exit $$rc

# nextpnr names a clock after the net that drives the clock pins, and after abc9 and techmap that net is often an
# internal name ($abc$2758$aiger$o7 for the clk port itself, $auto$ff.cc:337:slice$1535.C for its falling edge).
# CLK_AWK reads the netlist ($(TOP).json, as write_json prints it: one key per line) after the log and follows the
# net back through IBUF/BUFG/inverters to the port it comes in on ('clk', 'clk (falling edge)'); a net the student
# named (slow) keeps its name; a net driven by a register or a LUT is 'a clock derived inside the design (file:line)'.
CLK_AWK = FILENAME ~ /\.json$$/ { if (/^    "[^"]+": \{$$/) { mod=$$0; sub(/^ *"/,"",mod); sub(/".*/,"",mod); next } if (mod != top) next; if (/^      "(ports|cells|netnames)": \{/) { sec=$$1; gsub(/[":]/,"",sec); next } \
	           if (/^        "[^"]+": \{$$/) { nm=$$0; sub(/^ *"/,"",nm); sub(/".*/,"",nm); key=""; next } \
	           if (/^          "type": "/) { t=$$0; sub(/.*"type": "/,"",t); sub(/".*/,"",t); ctype[nm]=t; next } \
	           if (sec=="ports" && /^          "direction": "input"/) { pin[nm]=1; next } \
	           if (/^          "(parameters|attributes|port_directions|connections)": \{/) { key=$$1; gsub(/[":]/,"",key); next } \
	           if (/^          "bits": \[/) { b=$$0; sub(/.*\[ */,"",b); sub(/ *\].*/,"",b); n=split(b,bb,", "); if (sec=="ports" && (nm in pin)) for (i=1;i<=n;i++) pbit[bb[i]]=nm; else if (sec=="nets" || sec=="netnames") nbit[nm]=bb[1]; next } \
	           if (key=="connections" && /^            "[A-Za-z0-9_]+": \[/) { p=$$0; sub(/^ *"/,"",p); sub(/".*/,"",p); b=$$0; sub(/.*\[ */,"",b); sub(/ *\].*/,"",b); n=split(b,bb,", "); if (p=="O" || p=="Q" || p=="Y" || p=="O6" || p=="O5") { for (i=1;i<=n;i++) drv[bb[i]]=nm } else if (p=="I" || p=="I0" || p=="A") cin[nm]=bb[1]; next } \
	           if (key=="parameters" && /^            "INIT": "01"/) { inv[nm]=1; next } \
	           if (key=="attributes" && /^            "src": "/) { s=$$0; sub(/.*"src": "/,"",s); sub(/".*/,"",s); sub(/\|.*/,"",s); sub(/\.[0-9]+(-[0-9]+\.[0-9]+)?$$/,"",s); csrc[nm]=s; next } next } \
	         function clkname(c,  b, k, cell, t, invd, s, own) { own=(c !~ /^\$$/); if (!(c in nbit)) { if (own) return c; derived[c]=1; return "a clock derived inside the design" } b=nbit[c]; invd=0; \
	           for (k=0; k<40; k++) { if (b in pbit) return pbit[b] (invd ? " (falling edge)" : ""); if (!(b in drv)) break; cell=drv[b]; t=ctype[cell]; \
	             if (t ~ /^(BUFG|BUFGCE|BUFH|BUFIO|BUFR|IBUF|IBUFG|\$$_BUF_)$$/) b=cin[cell]; else if (t=="INV" || t=="$$_NOT_" || (t=="LUT1" && (cell in inv))) { invd=!invd; b=cin[cell] } else break } \
	           derived[c]=1; if (own) return c; s=(cell in csrc) ? csrc[cell] : ""; return "a clock derived inside the design" (s==""?"":" (" s ")") }
# the tool binaries and the chipdb are prerequisites too: after `dewfpga install` (an update) the netlist is re-placed
# a build that stops here (a wrong pin name, timing) must not leave the previous .bit behind either: the outputs
# of this stage and the next two go first, so what is in the folder after a failed build is never yesterday's design
# (the synthesis rule above does the same). The pin names are checked against the chip's package pins
# ($(XRAYDB)/$(PART)/package_pins.csv, the prjxray database the bitstream is built from) before nextpnr runs.
$(TOP).fasm: $(TOP).json $(XDC) $(wildcard $(FPGA)/chipdb/.sha)
	@rm -f $(TOP).bit $(TOP).frames $(TOP)_routed.json $@
	@"$(PY)" "$(CHECKER)" --pins "$(XRAYDB)/$(PART)/package_pins.csv" $(TOP).json $(XDC)
	@if ! grep -q '^[^#]*create_clock' $(XDC); then echo "note [no-create-clock]: no create_clock in $(XDC); timing is checked against the Basys3's 100 MHz oscillator (--freq 100). $(URL)no-create-clock/"; fi
	@set -o pipefail; "$(NEXTPNR)" --chipdb "$(CHIPDB)" --xdc $(XDC) --json $(TOP).json --seed 1 \
	           $$(grep -q '^[^#]*create_clock' $(XDC) || echo --freq 100) \
	           --write $(TOP)_routed.json --fasm $@ --quiet --log $(TOP).log 2>&1 \
	  | awk -v srcs="$(SRCS)" -v xdc="$(XDC)" '$(FMT_AWK) function lines(pat,  cmd, l, out) { out=""; cmd="grep -nE \"" pat "\" " srcs " /dev/null | cut -d: -f1,2 | head -4"; while ((cmd | getline l) > 0) out = out (out==""?"":" and ") l; close(cmd); return out } \
	         function first(ls) { sub(/ and .*/,"",ls); return ls } \
	         function xline(pat,  cmd, l) { l=""; cmd="grep -nE \"" pat "\" " xdc " /dev/null | head -1 | cut -d: -f1,2"; cmd | getline l; close(cmd); return l } \
	         function rx(s) { gsub(/[][]/, ".", s); return s } \
	         /^ERROR: Unable to constrain IO .*, device does not have a pin named / { print; p=$$0; sub(/.*pin named \047/,"",p); sub(/\047.*/,"",p); io=$$0; sub(/.*constrain IO \047/,"",io); sub(/\047.*/,"",io); \
	           print fmt("ERROR", "no-such-pin", xline("^[^#]*PACKAGE_PIN[[:space:]]+" p "([^A-Za-z0-9_]|$$)"), p " is not an I/O pin of the Basys3\047s chip (xc7a35tcpg236; a pin is a letter and a number, in capitals: W5, U16, V17), so nextpnr cannot put " io " on it.", "copy the pin for " io " from the course\047s Basys3_Master.xdc, or from the board\047s schematic."); next } \
	         /^ERROR: Unable to constrain IO / { print; io=$$0; sub(/.*constrain IO \047/,"",io); sub(/\047.*/,"",io); print fmt("ERROR", "no-such-pin", xline("^[^#]*get_ports[[:space:]]*\\{?[[:space:]]*" rx(io) "[[:space:]]*\\}?[[:space:]]*\\]"), "nextpnr cannot put " io " on the pin its XDC line names (its line is above).", "copy the pin for " io " from the course\047s Basys3_Master.xdc, or from the board\047s schematic."); next } \
	         /^ERROR: Cell \047.*\047 cannot be bound to bel \047.*\047 since it is already bound to cell / { print; a=$$0; sub(/.*Cell \047/,"",a); sub(/\047.*/,"",a); b=$$0; sub(/.*bound to cell \047/,"",b); sub(/\047.*/,"",b); \
	           print fmt("ERROR", "pin-used-twice", xline("^[^#]*get_ports[[:space:]]*\\{?[[:space:]]*" rx(a) "[[:space:]]*\\}?[[:space:]]*\\]"), a " and " b " are on the same pin (the XDC gives both the same PACKAGE_PIN), and one pin takes one port.", "give each port its own pin (copy the lines from the course\047s Basys3_Master.xdc)."); next } \
	         /^Warning: \[current_design\] isn.t supported, ignoring/ || /^[0-9]+ warnings?, [0-9]+ errors?$$/ {next} \
	         { sub(/[0-9]+ warnings?, [0-9]+ errors?$$/, "") } \
	         /no Bels remaining of type/ { print; t=$$0; sub(/.*of type \047/,"",t); sub(/\047.*/,"",t); c=$$0; sub(/.*place cell \047/,"",c); sub(/\047.*/,"",c); \
	           if (t == "$$_TBUF_") { ls=lines("\047[sS]?[bBoOhH]?[zZ]+([^A-Za-z0-9_]|$$)"); print fmt("ERROR", "internal-tristate", first(ls), "a tri-state driver (a z" (ls==""?"":", at " ls) ") on a signal that is not an inout pin of the top module: the chip has tri-state buffers on its pins only. Vivado converts such a driver to logic (UG901 Ch.5 Tristates); yosys keeps it as a $$_TBUF_ cell, and nextpnr has nothing to place it on. Not a size problem.", "select with a mux instead:  assign bus = sel ? b : a;  and keep z for an inout pin only."); next } \
	           if (t == "$$and" || t == "$$or") { ls=lines("(^|[^A-Za-z0-9_])(wor|wand|trior|triand)([^A-Za-z0-9_]|$$)"); print fmt("ERROR", "wired-net", first(ls), "a wor/wand net" (ls==""?"":" (declared at " ls ")") " with two drivers: yosys keeps the wired OR/AND as a " t " cell, and nextpnr has nothing to place it on. Not a size problem.", "write the resolution yourself, in one assign:  assign any = sw[3:0] | sw[7:4];  (wand: &), and declare the net as logic."); next } \
	           if (t == "$$pow") { at=c; if (match(at, /\$$pow\$$[^$$]+:[0-9]+/)) at=substr(at,RSTART+5,RLENGTH-5); else at=""; \
	             f=at; sub(/:[0-9]+$$/,"",f); n=at; sub(/.*:/,"",n); l=""; e=""; if (n ~ /^[0-9]+$$/) { cmd="sed -n " n "p " f " 2>/dev/null"; cmd | getline l; close(cmd) } \
	             if (match(l, /[A-Za-z_0-9\047\[\]:.]+[[:space:]]*\*\*[[:space:]]*[A-Za-z_0-9\047\[\]:.]+/)) { e=substr(l,RSTART,RLENGTH); gsub(/[[:space:]]*\*\*[[:space:]]*/," ** ",e) } \
	             bs=e; sub(/ \*\*.*/,"",bs); ex=e; sub(/.*\*\* /,"",ex); lhs="y"; if (match(l, /[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?[[:space:]]*<?=[^=]/)) { lhs=substr(l,RSTART,RLENGTH); sub(/[[:space:]]*<?=.*/,"",lhs) } \
	             if (e != "" && bs ~ /^[0-9]/ && ex !~ /^[0-9]/) print fmt("ERROR", "power-operator", at, "** with a constant base and a signal exponent (" e "): yosys builds ** only for a constant base and exponent, or 2 ** n, and leaves this one as a $$pow cell nextpnr has nothing to place on; Vivado does not build it either (UG901 Ch.10 Operators: A**B is supported if A is a power of 2 or B is a constant). Not a size problem.", "write the values out as a table:  case (" ex ") 0: " lhs " = 1; 1: " lhs " = " bs "; 2: " lhs " = " bs " * " bs "; ... endcase  (or 1 << " ex " when the base is 2)."); \
	             else print fmt("ERROR", "power-operator", at, "** with a base that is a signal (sw ** 2): yosys builds ** only for a constant base and exponent, or 2 ** n, and leaves this one as a $$pow cell nextpnr has nothing to place on. Not a size problem.", "write the multiplication out (sw * sw), a table (case), or 1 << n for a power of two."); next } \
	           if (t !~ /^(SLICE|RAMB|DSP|BUFG|IOB|PAD|\$$)/) { ls=lines("^[[:space:]]*module[[:space:]]+" t "([^A-Za-z0-9_]|$$)"); print fmt("ERROR", "empty-module", first(ls), "the module " t (ls==""?"":" (" ls ")") ", instantiated as " c ", has no body (no assign, no always), so yosys kept it as a black box, and nextpnr has no cell of that type to place. Not a size problem.", "write the body of " t ", or comment the instance " c " out until it is written."); next } \
	           print fmt("ERROR", "design-too-big", "", "the design does not fit the XC7A35T (no " t " left: 20800 LUTs, 41600 FFs; a memory is built from LUTs as distributed RAM, unless (* ram_style = \"block\" *) asks for a block RAM). The counts are in $(TOP).log.", "make it smaller: fewer bits, a smaller memory, one divider or multiplier shared over several cycles."); next } \
	         /Failed to expand region|Unable to find legal placement/ { print; print fmt("ERROR", "design-too-big", "", "the design does not fit the XC7A35T (20800 LUTs, 41600 FFs; a memory is built from LUTs as distributed RAM, unless (* ram_style = \"block\" *) asks for a block RAM). The counts are in $(TOP).log.", "make it smaller: fewer bits, a smaller memory, one divider or multiplier shared over several cycles."); next } \
	         !seen[$$0]++'
	# the course's Basys3_Master.xdc ends in five [current_design] lines nextpnr does not know; they are
	# harmless and would print on every build, so they are dropped here (the full text is in $(TOP).log)
	@awk -v top=$(TOP) '$(FMT_AWK) $(CLK_AWK) /^Info:[[:space:]]+SLICE_LUTX:/{l=$$3} /^Info:[[:space:]]+SLICE_FFX:/{f=$$3} \
	      /Max frequency for clock/{ v=$$0; sub(/.*for clock[[:space:]]+\047/,"",v); c=v; sub(/\047: .*/,"",c); sub(/^.*\047: /,"",v); if (!(c in freq)) order[++nc]=c; freq[c]=v } \
	      END{sub(/\/.*/,"",l); sub(/\/.*/,"",f); k=0; fmin=0; for (c in freq) { k++; if (freq[c] ~ /FAIL/) { bad=1; v=freq[c]; sub(/ .*/,"",v); split(v, dd, "."); v=dd[1]*100 + substr(dd[2] "00",1,2); if (v > 0 && (fmin == 0 || v < fmin)) fmin=v } } m=""; der=""; \
	          ip=0; if (fmin > 0) { ip=int(100000/fmin); if (ip*fmin < 100000) ip++ } cyc=int((ip+9)/10); f10=(ip > 0 ? int(10000/ip + 0.5) : 0); xdc=(ip > 0 ? "create_clock -period " ip ".000 [get_ports clk] (" int(f10/10) "." (f10%10) " MHz)" : "a create_clock with a longer period"); \
	          for (i=1; i<=nc; i++) { c=order[i]; nm=clkname(c); m = m (m==""?"":", ") nm " " freq[c]; if (freq[c] ~ /FAIL/ && (c in derived)) der=nm } \
	          if (m == "") m = "no clocked paths, timing not applicable"; \
	          if (bad) { print fmt("ERROR", "timing-not-met", "", "timing not met: " m ". The longest path between two registers takes more than one period of that clock, so the design cannot run at it, and no bitstream is written; $(TOP).log has the critical path report (the registers and the logic between them).", "make the path shorter (a divide or a modulo in one cycle is the usual cause: register the intermediate results)" (der=="" ? ", or give it the time it needs: " xdc " makes the check pass, and the Basys3 pin gives 100 MHz whatever the XDC says (its oscillator, Basys3 reference manual), so those registers must then take a new value only every " cyc " clocks or more (a clock enable from a counter: if (tick) ...)." : "; " der " is a clock made inside the design and is checked at the same 100 MHz, so clock those registers on the port clock with a clock enable (if (tick) ...) instead of on " der ".")) > "/dev/stderr"; exit 2 } \
	          printf "pnr ok: %s LUT, %s FF, %s   (full log: $(TOP).log)\n",l,f,m}' $(TOP).log $(TOP).json || { rm -f $@; exit 2; }

$(TOP).frames: $(TOP).fasm
	@grep -qE '^[A-Z0-9_]+\.' $< || { echo "ERROR [empty-fasm]: $< has no FASM features (an empty or corrupt place-and-route output, usually a build interrupted half way). Fix: run  dewfpga clean  and build again. $(URL)empty-fasm/" >&2; exit 1; }
	@PYTHONWARNINGS=ignore "$(PY)" "$(F2F)" --part $(PART) --db-root "$(XRAYDB)" $< > $@

bit: $(TOP).bit
$(TOP).bit: $(TOP).frames
	@"$(F2B)" --part_file "$(XRAYDB)/$(PART)/part.yaml" --part_name $(PART) \
	       --frm_file $< --output_file $@
	@LC_ALL=C awk -v f=$@ '{printf "%s  %.1f MB\n", f, $$1/1e6}' <<< "$$(stat -f%z $@)"

flash: $(TOP).bit
	@openFPGALoader -b basys3 $(TOP).bit > $(TOP)_flash.out 2>&1; rc=$$?; grep -v '^empty$$' $(TOP)_flash.out || true; \
	  if [ $$rc -ne 0 ]; then \
	    if grep -q 'unable to open ftdi device' $(TOP)_flash.out; then echo "ERROR [board-not-found]: board not found: the Mac sees no Basys3 on USB (openFPGALoader: unable to open ftdi device). Fix: plug the USB into the PROG port, switch the power ON, and try another cable or port. $(URL)board-not-found/" >&2; \
	    else echo "ERROR [openfpgaloader-failed]: openFPGALoader stopped with exit $$rc (its message is above). Fix: read the lines above; a board that answers but refuses the bitstream usually needs the power switched off and on. $(URL)openfpgaloader-failed/" >&2; fi; exit 1; fi

clean:
	rm -f $(TOP)_sim $(TOP)_sim.out $(TOP)_sim.err $(TOP)_sim.deps $(TOP)_flash.out $(TOP).vcd $(TOP).json $(TOP)_routed.json \
	      $(TOP).deps $(TOP).pins.deps $(TOP).il $(TOP).il.tmp $(TOP).rv.out $(TOP).sl.out $(TOP).slang.log $(TOP).yosys.log $(TOP).fasm $(TOP).frames $(TOP).bit $(TOP).log
