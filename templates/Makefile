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
	  if [ $$rc -eq 142 ]; then echo "ERROR: the simulation did not finish in $(SIM_TIMEOUT) s. The testbench must end with \$$finish; a free-running clock never stops on its own. SIM_TIMEOUT=600 dewfpga sim waits longer." >&2; exit 1; fi; \
	  [ $$rc -eq 0 ] || { echo "ERROR: the simulator stopped with exit $$rc (see above)" >&2; exit 1; }; \
	  ! grep -qE '^(ERROR|FATAL):' $(TOP)_sim.out || { echo "ERROR: the testbench reported errors (see above)" >&2; exit 1; }

# files the sources pull in without naming them to make: $readmemh/$readmemb tables and `include files. A
# changed .mem or included .v rebuilds. $(TOP).deps and $(TOP)_sim.deps hold the whole file list, rewritten
# only when it changes, so a file added, deleted or renamed (a dropped design file, a new testbench) rebuilds too.
readmems = $(sort $(shell grep -ohE '\$$readmem[hb][[:space:]]*.[[:space:]]*"[^"]+"' $(1) 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/'))
includes = $(sort $(shell grep -ohE '^[[:space:]]*`include[[:space:]]+"[^"]+"' $(1) 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/'))
SRC_DEPS := $(wildcard $(call readmems,$(SRCS)) $(call includes,$(SRCS)) *.svh *.vh)
SIM_DEPS := $(wildcard $(call readmems,$(SRCS) $(TB)) $(call includes,$(SRCS) $(TB)) *.svh *.vh)
# a package must be read before the module that uses it: iverilog and yosys read the files in the order given
# (iverilog stops at a syntax error, yosys drops the import and builds every name of the package as an undriven
# wire). The CLI lists the files alphabetically, so a package declared next to a module (zz_util.sv: package +
# module, used by top.sv) came after its user. The files that declare a package go first, in the order given.
PKG_SRCS := $(shell grep -lE '^[[:space:]]*package[[:space:]]+[A-Za-z_]' $(SRCS) 2>/dev/null)
override SRCS := $(strip $(PKG_SRCS) $(filter-out $(PKG_SRCS),$(SRCS)))
# the files the typedef scan reads: an included file (types.svh) declares its typedef before the design uses it,
# so it is read first; a .mem is not code. A file that is both included and a source is read once.
TYPEDEF_FILES = $(filter-out $(SRCS),$(filter %.svh %.vh %.sv %.v,$(SRC_DEPS))) $(SRCS)

$(TOP)_sim.deps: FORCE
	@l="$(SRCS) | $(TB) | $(SIM_DEPS)"; { [ -f $@ ] && [ "$$(cat $@)" = "$$l" ]; } || echo "$$l" > $@
$(TOP).deps: FORCE
	@l="$(SRCS) | $(SRC_DEPS)"; { [ -f $@ ] && [ "$$(cat $@)" = "$$l" ]; } || echo "$$l" > $@
FORCE:
.PHONY: FORCE

$(TOP)_sim: $(SRCS) $(TB) $(SIM_DEPS) $(TOP)_sim.deps
	@[ -n "$(TB)" ] || { echo "ERROR: $(TOP)_tb.sv not found. Simulation needs a testbench next to the design; 'dewfpga new blink' gives an example (blink/blink_tb.sv)" >&2; exit 1; }
	@awk '$(PKG_AWK)' $(SRCS) $(TB) $(SIM_DEPS)
	@awk '$(TYPEDEF_AWK)' $(TYPEDEF_FILES)
	iverilog -g2012 -o $@ $(SRCS) $(TB)

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
# library in the second run, which checks. A conflict whose drivers have no always-block line (two assigns to a
# tri bus) is not this error: the warning passes through and nextpnr's verdict follows.
# The two yosys runs (elaborate and write $(TOP).il; synthesize from it) feed one awk, so a warning of the first
# run (an implicit wire) and its consequence in the second (no driver) meet.
YOSYS_AWK = function loc(s) { sub(/\|.*/,"",s); sub(/\.[0-9]+(-[0-9]+\.[0-9]+)?$$/,"",s); return s } \
	         function cellsrc(c,  t) { load(); if (c in src) return src[c]; t=c; if (t !~ /^\$$/) sub(/^[^.]*\./,"",t); if (t in src) return src[t]; \
	           if (match(t, /\$$[^$$]+:[0-9]+\$$/)) return substr(t, RSTART+1, RLENGTH-2); return "(line unknown)" } \
	         function before(x, y,  fx, fy, nx, ny) { fx=x; sub(/:[0-9]+$$/,"",fx); fy=y; sub(/:[0-9]+$$/,"",fy); if (fx != fy) return fx < fy; nx=x; sub(/.*:/,"",nx); ny=y; sub(/.*:/,"",ny); return nx+0 < ny+0 } \
	         function addline(ls, l,  a, n, i, out, ins) { n=split(ls, a, " and "); out=""; ins=0; for (i=1; i<=n; i++) { if (!ins && before(l, a[i])) { out = out (out==""?"":" and ") l; ins=1 } out = out (out==""?"":" and ") a[i] } \
	           if (!ins) out = out (out==""?"":" and ") l; return out } \
	         function lpend(  f, n, ln, cmd) { lp=0; if (lsrc == "" || lw == "" || (lw in ldone)) return; ldone[lw]=1; bad=1; \
	           f=lsrc; sub(/:[0-9]+$$/,"",f); n=lsrc; sub(/.*:/,"",n); ln=""; cmd="sed -n 1," n "p " f " | grep -E always | tail -1"; cmd | getline ln; close(cmd); \
	           print "ERROR: " lsrc ": latch inferred for " lw " (" (lkind=="case" ? "a case without default" : "an if without else") " in " (ln ~ /always_comb/ ? "always_comb" : "an always block") "), and " (rd=="slang" ? "yosys-slang (the second reader, used because yosys\047 own reader refused this code)" : "yosys") " built it as a LUT feedback loop, not a latch, so the board would not do what the simulation showed; Vivado builds an LDCE latch here, with a warning. Give " lw " a value on every path (" (lkind=="case" ? "a default: item" : "an else branch") ", or a default at the top of the block); if you meant a latch, write always_latch instead of always_comb (both readers build that as a latch)." } \
	         function load(  l,f) { if (loaded) return; loaded=1; while ((getline l < il) > 0) { \
	           if (l ~ /^ *attribute \\src "/) { cur=l; sub(/^ *attribute \\src "/,"",cur); sub(/"$$/,"",cur) } \
	           else if (l ~ /^ *(wire|module|process) /) cur=""; \
	           else if (l ~ /^ *cell /) { split(l,f," "); cc=f[3]; type[cc]=f[2]; src[cc]=loc(cur); cur="" } \
	           else if (l ~ /^ *connect \\Q /) { q=l; sub(/^ *connect \\Q \\?/,"",q); qn[cc]=q } \
	           else if (l ~ /^ *connect \\AD /) { q=l; sub(/^ *connect \\AD /,"",q); ad[cc]=q } } } \
	         lp && !/^    / { lpend() } \
	         /^Warning: found logic loop in module / { lp=1; lsrc=""; lw=""; print; next } \
	         lp { if (/^    cell \$$procmux\$$[0-9]+ \(\$$p?mux\) source: / && lsrc == "") { s=$$0; sub(/.*source: /,"",s); lkind=(/\(\$$pmux\)/ ? "case" : "if"); if (lkind == "case") sub(/^[^|]*\|/,"",s); lsrc=loc(s) } \
	              if (/^    wire \\/) { lw=$$0; sub(/^    wire \\/,"",lw); sub(/ \[[0-9]+\]$$/,"",lw) } print; next } \
	         /Latch inferred for signal .* from (always_comb )?process/ { \
	           sig=$$0; sub(/.*Latch inferred for signal `?\\?/,"",sig); sub(/. from (always_comb )?process.*/,"",sig); sub(/^.*\\/,"",sig); \
	           at=$$0; sub(/.*\$$proc\$$/,"",at); sub(/\$$[0-9]+.*/,"",at); f=at; sub(/:[0-9]+$$/,"",f); n=at; sub(/.*:/,"",n); \
	           ln=""; cmd="sed -n " n "p " f; cmd | getline ln; close(cmd); if (ln ~ /always_latch/) next; \
	           print "warning: " at ": latch inferred for " sig " (an if without else in " (ln ~ /always_comb/ ? "always_comb" : "an always block") "); Vivado builds it too, with the same warning; if you meant a register use always_ff, if a latch use always_latch"; next } \
	         /Async reset .* yields non-constant value/ { print; print "ERROR: in an always_ff with an asynchronous reset (posedge clk, posedge reset), the reset branch may only assign constants (x <= 0). Assign that signal a constant on reset, or reset it inside the clocked branch."; next } \
	         /Multiple edge sensitive events found for this signal/ { print; print "ERROR: a signal is written from two always blocks with different edges (posedge and negedge, or two different resets). Drive each signal from one always block."; next } \
	         /Warning: Identifier `\\[^\047]*::[^\047]*\047 is implicitly declared/ { \
	           at=$$0; sub(/: Warning: .*/,"",at); nm=$$0; sub(/.*Identifier `\\/,"",nm); sub(/\047.*/,"",nm); pk=nm; sub(/::.*/,"",pk); \
	           f=""; cmd="grep -lE \"^[[:space:]]*package[[:space:]]+" pk "[[:space:];]\" *.sv *.v 2>/dev/null"; cmd | getline f; close(cmd); sf=at; sub(/:[0-9]+$$/,"",sf); \
	           print "ERROR: " at ": " nm " names the package " pk ", and yosys was not given it (it reads the files that hold a module: $(SRCS)), so it would build " nm " as an undriven wire: x on the board. Add   `include \"" (f==""?"the file that declares " pk:f) "\"   as the first line of " sf "; or move the package into " sf ", above the module."; bad=1; next } \
	         /Warning: Package `\\.* not found for import, removing import statement/ { pk=$$0; sub(/.*Package `\\/,"",pk); sub(/\047.*/,"",pk); \
	           at=""; cmd="grep -nE \"import[[:space:]]+" pk "[[:space:]]*::\" $(SRCS) /dev/null | head -1"; cmd | getline at; close(cmd); sub(/:[^:]*$$/,"",at); if (at=="") at="$(firstword $(SRCS))"; \
	           print; print "ERROR: " at ": `import " pk "::*` names the package " pk ", and yosys was not given it (it reads the files that hold a module: $(SRCS)), so it dropped the import and would build every name of " pk " as an undriven wire: x on the board. Add   `include \"the file that declares " pk "\"   as the first line of $(firstword $(SRCS)); or move the package into that file, above the module."; bad=1; noimp=1; next } \
	         /Warning: Identifier `\\.* is implicitly declared\./ { \
	           name=$$0; sub(/.*Identifier `\\/,"",name); sub(/\047 is implicitly.*/,"",name); at=$$1; sub(/:$$/,"",at); \
	           pre=name; sub(/[.\[].*/,"",pre); \
	           if (name ~ /\./ && !index(" " ifp " ", " " pre " ")) { bad=1; \
	             if (index(" " ifi " ", " " pre " ")) print "ERROR: " at ": " name " is a member of the interface instance " pre ", used in the module that instantiates it. yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed). An interface used this way is not supported yet (\#4): pass the interface to a module through an interface port, or keep those signals as plain logic in the module."; \
	             else print "ERROR: " at ": " name " is a hierarchical name (a signal inside another instance). yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed). Bring that signal out through an output port of its module and connect it here. Vivado resolves hierarchical names (UG901 Ch.9 Table 20)."; next } \
	           impl[name]=at; print; next } \
	         /Warning: Wire .* is used but has no driver\./ { w=$$0; sub(/.*Warning: Wire /,"",w); sub(/ is used but has no driver.*/,"",w); sub(/^[^.\\]*\.\\?/,"",w); sub(/ \[[0-9]+\]$$/,"",w); \
	           if (w in impl && !(w in done) && !noimp) { done[w]=1; bad=1; print "ERROR: " impl[w] ": " w " is not declared anywhere and nothing drives it: yosys made it a 1-bit wire stuck at x and built the design without it (dewfpga sim refuses this code). Declare it, or check the spelling (a typo of a declared name)." } print; next } \
	         /Warning: reg \047\\[^\047]*\047 is assigned in a continuous assignment at / { n=$$0; sub(/.*reg \047\\/,"",n); sub(/\047.*/,"",n); a=$$0; sub(/.* at /,"",a); sub(/\.$$/,"",a); ca[n]=loc(a); print; next } \
	         md != "" && !/^    (port .* of cell |module input )/ { k=(md in ca)?md:can; \
	           if (k != "") { if (!(k in done)) { done[k]=1; bad=1; \
	             print "ERROR: " (lines==""?ca[k]:lines " and " ca[k]) ": " k " is written by an always block" (lines==""?"":" (" lines ")") " and by a continuous assign (" ca[k] "). Drive it from one of them: yosys resolved the conflict to a constant, so the board would not do what the simulation showed." } } \
	           else if (lines != "" && !(md in done)) { done[md]=1; bad=1; \
	             print "ERROR: " lines ": " md " is written from two always blocks (" lines "). Drive each signal from one always block: yosys resolved the conflict to a constant, so the board would not do what the simulation showed." } md=""; lines=""; can="" } \
	         /Warning: multiple conflicting drivers for / { s=$$0; sub(/.*drivers for /,"",s); sub(/:$$/,"",s); sub(/^[^.\\]*\.\\?/,"",s); sub(/ \[[0-9]+\]$$/,"",s); md=s; lines=""; can=""; print; next } \
	         md != "" { if (/^    module input /) { print; next } c=$$0; sub(/.*of cell /,"",c); sub(/ \(.*/,"",c); load(); if ((c in qn) && (qn[c] in ca)) can=qn[c]; \
	           l=cellsrc(c); if (l != "(line unknown)" && index(" " lines " ", " " l " ") == 0) lines = addline(lines, l); print; next } \
	         { print } \
	         END { if (lp) lpend(); load(); for (c in type) if (type[c] ~ /^\$$aldffe?$$/ && ad[c] !~ /^([0-9]+\047[01]+|[0-9]+)$$/ && !(src[c] in adone)) { adone[src[c]]=1; bad=1; \
	                 print "ERROR: " src[c] ": in an always_ff with an asynchronous reset (posedge clk or posedge btn), the reset branch may only assign a constant; here " qn[c] " is loaded from a signal. yosys emulates that with FFs and a mux (or a loop when the branch reads " qn[c] " itself), so the board would not do what the simulation showed. Load the signal with the clock (move that if into the else branch), or reset to a constant." } \
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
TYPEDEF_AWK = $(STRIP_AWK) FNR==1 { file=FILENAME } \
	         /^[[:space:]]*typedef[[:space:]]/ && /\][[:space:]]*\[[^]]*\][[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*;/ { t=$$0; sub(/[[:space:]]*;.*/,"",t); sub(/.*[[:space:]\]]/,"",t); td[t]=file ":" FNR; \
	           d=$$0; sub(/^[[:space:]]*typedef[[:space:]]+/,"",d); sub(/[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*;.*/,"",d); dims[t]=d; next } \
	         { for (t in td) if (match($$0, "(^|[^A-Za-z0-9_$$.])" t "[[:space:]]+[A-Za-z_][A-Za-z0-9_]*")) { \
	           p=substr($$0, RSTART, RLENGTH); sub(/.*[[:space:]]/,"",p); \
	           print "ERROR: " file ":" FNR ": " p " is declared with the type " t ", a packed array with two dimensions (" td[t] "). Yosys keeps a value of such a typedef as one flat vector, so " p "[i] picks one bit instead of one row, and the table would be built wrong. Write the dimensions on the declaration itself:  " dims[t] " " p ";  a parameter yosys refuses in that form, so keep it flat and take a row with +:  (localparam logic [N*W-1:0] " p " = {...}; " p "[i*W +: W])." > "/dev/stderr"; bad=1 } } \
	         END { exit bad+0 }
# $isunknown is looked for in the code yosys' preprocessor hands to the parser (read_verilog -ppdump), not in
# the raw text: a block comment (folded onto one line there) is dropped here, and a `ifndef SYNTHESIS block is
# already gone (read_verilog defines SYNTHESIS, as Vivado does: UG901). `file_push/`file_pop keep the file
# and the line of an `include; the dump pads with blank lines, so the line count is the student's.
ISUNKNOWN_AWK = /^-- Verilog code after preprocessor --$$/ { dump=1; next } \
	         /^-- END OF DUMP --$$/ { dump=0; next } \
	         !dump { next } \
	         /^`file_push "/ { f=$$0; sub(/^`file_push "/,"",f); sub(/".*/,"",f); sp++; fs[sp]=file; ls[sp]=line; file=f; line=0; next } \
	         /^`file_pop/ { file=fs[sp]; line=ls[sp]; sp--; next } \
	         { line++; s=$$0; while ((i=index(s,"/*")) > 0) { j=index(substr(s,i+2),"*/"); if (j==0) { s=substr(s,1,i-1); break } s=substr(s,1,i-1) substr(s,i+j+3) } \
	           if (s ~ /\$$isunknown[[:space:]]*\(/) { print "ERROR: " file ":" line ": $$isunknown in a design. On the board a signal is never x, so it is 0 there (and dewfpga sim shows 0); yosys folds it to the constant 1 instead, so the bitstream would not do what the simulation showed. Remove it from the design; $$isunknown belongs in the testbench."; bad=1 } } \
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
REF_AWK = $(STRIP_AWK) \
	         /(^|[(,])[[:space:]]*ref[[:space:]]+[A-Za-z_\[]/ { fn=$$0; if (match(fn, /(function|task)[^(]*\(/)) { sub(/[[:space:]]*\(.*/,"",fn); sub(/.*[[:space:]]/,"",fn); fn=(fn ~ /^(function|task)$$/ ? "a function or task" : "function " fn) } else fn="a function or task"; \
	           a=$$0; sub(/^.*[(,][[:space:]]*ref[[:space:]]+/,"",a); sub(/^[[:space:]]*ref[[:space:]]+/,"",a); sub(/[,)].*/,"",a); \
	           print "ERROR: " FILENAME ":" FNR ": " fn " takes an argument by reference (ref " a "): pass the value in and return it (function automatic logic [3:0] inc(input logic [3:0] x); ... return x + 1;  and  v = inc(v);). yosys does not read ref, and yosys-slang drops it: the variable it is called with would never change on the board." > "/dev/stderr"; bad=1 } \
	         END { exit bad+0 }
# a package used through `import pkg::*;` or pkg::NAME must be in a file the tools are given: dewfpga hands
# iverilog and yosys the files that hold a module (a package in its own file, pkg.sv, is left out; an `include
# brings it in). iverilog stops at a syntax error on the import line; yosys drops the import with a warning,
# declares every name from the package as an implicit 1-bit wire with no driver and would build the design
# without it. The scan names the reference's line and the file that declares the package, before either
# tool runs. A class scope (util::f) is not a package: a class declared in the sources is not reported.
PKG_AWK = $(STRIP_AWK) \
	         /^[[:space:]]*(package|class)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/ { d=$$0; sub(/^[[:space:]]*(package|class)[[:space:]]+/,"",d); sub(/[^A-Za-z0-9_].*/,"",d); decl[d]=1 } \
	         { l=$$0; while (match(l, /[A-Za-z_$$][A-Za-z0-9_$$]*[[:space:]]*::/)) { n=substr(l,RSTART,RLENGTH); sub(/[[:space:]]*::$$/,"",n); l=substr(l,RSTART+RLENGTH); \
	             if (n !~ /^\$$/ && !(n in ref)) { ref[n]=FILENAME ":" FNR; how[n]=(l ~ /^[[:space:]]*\*/ && $$0 ~ ("import[[:space:]]+" n "[[:space:]]*::")) ? "`import " n "::*`" : n "::" (match(l,/[A-Za-z_][A-Za-z0-9_]*/) ? substr(l,RSTART,RLENGTH) : "") } } } \
	         END { for (n in ref) if (!(n in decl)) { bad=1; f=""; cmd="grep -lE \"^[[:space:]]*package[[:space:]]+" n "[[:space:];]\" *.sv *.v *.svh *.vh 2>/dev/null"; cmd | getline f; close(cmd); sf=ref[n]; sub(/:[0-9]+$$/,"",sf); \
	             if (f != "") print "ERROR: " ref[n] ": " how[n] " names the package " n ", which is declared in " f ", and the tools are not given that file (dewfpga hands them the files that hold a module: $(SRCS)). iverilog stops at a syntax error there; yosys would drop the import and build every name of " n " as an undriven 1-bit wire: x on the board. Add   `include \"" f "\"   as the first line of " sf "; or move the package into " sf ", above the module." > "/dev/stderr"; \
	             else print "ERROR: " ref[n] ": " how[n] " names the package " n ", and no file in this folder declares it (package " n "; ... endpackage). Check the spelling, or add the file that declares it and `include it as the first line of " sf "." > "/dev/stderr" } \
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
# yosys' reader reads it without -sv, and yosys-slang gets --map-keyword-version 1364-2005+<folder>/*.v, so bit
# and final are names there, not keywords. slang matches that pattern against the file's absolute path (a bare
# *.v matches nothing), so the folder is spelled out; the option is added only when a .v is among the sources.
# The scans before the readers: $isunknown, the package file, ref arguments (neither reader builds those right).
# The 2-D typedef scan is yosys' alone (slang builds such a parameter right), so it runs inside the first path.
READ_VERILOG = $(if $(filter %.sv,$(SRCS)),read_verilog -sv $(filter %.sv,$(SRCS));) $(if $(filter %.v,$(SRCS)),read_verilog $(filter %.v,$(SRCS));)
SYNTH        = read_rtlil $(TOP).il; synth_xilinx -flatten -abc9 -nobram -arch xc7 -top $(TOP); delete t:\$$print; write_json $(TOP).json
$(TOP).json: $(SRCS) $(SRC_DEPS) $(TOP).deps
	@rm -f $(TOP).bit $(TOP).frames $(TOP).fasm $(TOP)_routed.json $(TOP).il $(TOP).rv.out $(TOP).sl.out $(TOP).slang.log
	@"$(PY)" "$(CHECKER)" --fix-ports $(SRCS)
	@yosys -p "read_verilog -sv -ppdump $(SRCS)" 2>/dev/null | awk '$(ISUNKNOWN_AWK)'
	@awk '$(PKG_AWK)' $(SRCS) $(SRC_DEPS)
	@awk '$(REF_AWK)' $(SRCS) $(SRC_DEPS)
	@ifn=$$(grep -hoE '^[[:space:]]*interface[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' $(sort $(SRCS) $(wildcard *.sv *.v *.svh)) | awk '{print $$2}' | paste -sd'|' -); ifi=""; \
	  [ -z "$$ifn" ] || ifi=$$(grep -hoE "^[[:space:]]*($$ifn)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*" $(SRCS) | awk '{print $$2}' | paste -sd' ' -); ifp=""; \
	  [ -z "$$ifn" ] || ifp=$$(cat $(SRCS) | tr '\n' ' ' | grep -oE "[(,][[:space:]]*($$ifn)(\.[A-Za-z_][A-Za-z0-9_]*)?[[:space:]]+[A-Za-z_][A-Za-z0-9_]*" | awk '{print $$NF}' | paste -sd' ' -); \
	  set -o pipefail; rc=0; \
	  { awk '$(TYPEDEF_AWK)' $(TYPEDEF_FILES) \
	    && yosys -q -p "$(READ_VERILOG) hierarchy -top $(TOP); setattr -unset always_comb; proc; write_rtlil $(TOP).il" \
	    && awk '$(INOUT_Z_AWK)' $(TOP).il > $(TOP).il.tmp && mv $(TOP).il.tmp $(TOP).il \
	    && yosys -q -p "$(SYNTH)"; } 2>&1 \
	  | awk -v rd=verilog -v ifi="$$ifi" -v ifp="$$ifp" -v il=$(TOP).il '$(YOSYS_AWK)' > $(TOP).rv.out || rc=$$?; \
	  if [ $$rc -eq 0 ]; then cat $(TOP).rv.out; rm -f $(TOP).rv.out; exit 0; fi; \
	  if [ ! -f "$(SLANG)" ]; then cat $(TOP).rv.out; \
	    if grep -qE '^[^ ]+:[0-9]+: ERROR: |is a hierarchical name|is a member of the interface instance|a packed array with two dimensions' $(TOP).rv.out; then \
	      echo "note: yosys' own reader refused this code, and yosys-slang, the second reader (it reads the SystemVerilog Vivado accepts: interfaces, unpacked arrays, foreach, break, enum methods first/last ...), is not installed: $(SLANG) not found. Run  dewfpga install  (it builds that reader, ~3 min), then build again."; fi; \
	    rm -f $(TOP).rv.out; exit $$rc; fi; \
	  rm -f $@ $(TOP).il; rc=0; \
	  { yosys -m "$(SLANG)" -q -l $(TOP).slang.log -p "read_slang $(if $(filter %.v,$(SRCS)),--map-keyword-version 1364-2005+$(CURDIR)/*.v) $(SRCS); hierarchy -top $(TOP); proc; write_rtlil $(TOP).il" \
	    && awk '$(INOUT_Z_AWK)' $(TOP).il > $(TOP).il.tmp && mv $(TOP).il.tmp $(TOP).il \
	    && yosys -q -p "$(SYNTH)"; } 2>&1 \
	  | awk -v rd=slang -v ifi="$$ifi" -v ifp="$$ifp" -v il=$(TOP).il '$(YOSYS_AWK)' > $(TOP).sl.out || rc=$$?; \
	  if [ $$rc -eq 0 ]; then echo "note: $(TOP) read with yosys-slang (yosys' own reader refused this code)"; cat $(TOP).sl.out; rm -f $(TOP).rv.out $(TOP).sl.out $(TOP).slang.log; exit 0; fi; \
	  rm -f $@; \
	  if grep -qE '^(ERROR: (Design elaboration failed|Feature unimplemented)|[^ ]+:[0-9]+:[0-9]+: (error|fatal error):)' $(TOP).slang.log; then \
	    echo "yosys' reader:"; { grep 'ERROR' $(TOP).rv.out || tail -1 $(TOP).rv.out; } | sed 's/^/  /'; \
	    if echo " $(SRCS) " | grep -q '\.v '; then echo "note: a .v file is read as Verilog-2005 by both readers, as Vivado reads it: SystemVerilog (logic, always_ff, always_comb, enum ...) belongs in a .sv file. If your .v file holds SystemVerilog, rename it to .sv"; fi; \
	    awk '/^[^ ]+:[0-9]+:[0-9]+: error: unsupported system task \047(next|prev)\047$$/ { at=$$0; sub(/: error: .*/,"",at); em=$$0; sub(/.*system task \047/,"",em); sub(/\047.*/,"",em); n=2; next } \
	         em != "" { v=$$0; if (match(v, "[A-Za-z_][A-Za-z0-9_]*[[:space:]]*[.]" em "[[:space:]]*[(]")) { v=substr(v,RSTART,RLENGTH); sub(/[[:space:]]*[.].*/,"",v) } else v="s"; \
	           print "ERROR: " at ": " v "." em "() is an enum method that steps through the values (next/prev). yosys does not build enum methods, and yosys-slang builds first()/last() only. Write the step out as a case on " v ", in the order the enum lists its values (with IDLE, RUN, DONE: case (" v ") IDLE: " v " <= RUN; RUN: " v " <= DONE; DONE: " v " <= IDLE; endcase). Vivado builds next/prev (UG901 Ch.10 Table 27)."; em=""; print "    " $$0; n--; next } \
	         /^[^ ]+:[0-9]+:[0-9]+: (error|fatal error): / { s=$$0; sub(/: (error|fatal error): /,": ",s); print "ERROR: " s " (yosys-slang)"; n=2; next } \
	         /^ERROR: Feature unimplemented/ { print "ERROR: yosys-slang cannot build this construct yet (" $$0 ")"; next } \
	         n > 0 { print "    " $$0; n-- }' $(TOP).slang.log; \
	  else cat $(TOP).sl.out; fi; rm -f $(TOP).rv.out $(TOP).sl.out; exit $$rc

# the tool binaries and the chipdb are prerequisites too: after `dewfpga install` (an update) the netlist is re-placed
$(TOP).fasm: $(TOP).json $(XDC) $(wildcard $(FPGA)/chipdb/.sha)
	@"$(PY)" "$(CHECKER)" $(TOP).json $(XDC)
	@if ! grep -q '^[^#]*create_clock' $(XDC); then echo "note: no create_clock in $(XDC); timing is checked against the Basys3's 100 MHz oscillator (--freq 100)"; fi
	@set -o pipefail; "$(NEXTPNR)" --chipdb "$(CHIPDB)" --xdc $(XDC) --json $(TOP).json --seed 1 \
	           $$(grep -q '^[^#]*create_clock' $(XDC) || echo --freq 100) \
	           --write $(TOP)_routed.json --fasm $@ --quiet --log $(TOP).log 2>&1 \
	  | awk '/^Warning: \[current_design\] isn.t supported, ignoring/ || /^[0-9]+ warnings?, [0-9]+ errors?$$/ {next} \
	         { sub(/[0-9]+ warnings?, [0-9]+ errors?$$/, "") } \
	         /Failed to expand region|Unable to find legal placement|no Bels remaining/ { print; print "ERROR: the design does not fit the XC7A35T (with -nobram every memory becomes LUTs). Make it smaller; the counts are in $(TOP).log"; next } \
	         !seen[$$0]++'
	# the course's Basys3_Master.xdc ends in five [current_design] lines nextpnr does not know; they are
	# harmless and would print on every build, so they are dropped here (the full text is in $(TOP).log)
	@awk '/^Info:[[:space:]]+SLICE_LUTX:/{l=$$3} /^Info:[[:space:]]+SLICE_FFX:/{f=$$3} \
	      /Max frequency for clock/{ v=$$0; sub(/.*for clock[[:space:]]+\047/,"",v); c=v; sub(/\047.*/,"",c); sub(/^[^:]*:[[:space:]]*/,"",v); freq[c]=v } \
	      END{sub(/\/.*/,"",l); sub(/\/.*/,"",f); k=0; for (c in freq) { k++; if (freq[c] ~ /FAIL/) bad=1 } m=""; \
	          for (c in freq) m = m (m==""?"":", ") (k>1 ? c " " : "") freq[c]; \
	          if (m == "") m = "no clocked paths, timing not applicable"; \
	          if (bad) { printf "ERROR: timing not met: %s. The design cannot run at the clock the XDC asks for; no bitstream written. Details: $(TOP).log\n",m > "/dev/stderr"; exit 2 } \
	          printf "pnr ok: %s LUT, %s FF, %s   (full log: $(TOP).log)\n",l,f,m}' $(TOP).log || { rm -f $@; exit 2; }

$(TOP).frames: $(TOP).fasm
	@grep -qE '^[A-Z0-9_]+\.' $< || { echo "ERROR: $< has no FASM features (empty or corrupt place-and-route output). Run: dewfpga clean" >&2; exit 1; }
	@PYTHONWARNINGS=ignore "$(PY)" "$(F2F)" --part $(PART) --db-root "$(XRAYDB)" $< > $@

bit: $(TOP).bit
$(TOP).bit: $(TOP).frames
	@"$(F2B)" --part_file "$(XRAYDB)/$(PART)/part.yaml" --part_name $(PART) \
	       --frm_file $< --output_file $@
	@LC_ALL=C awk -v f=$@ '{printf "%s  %.1f MB\n", f, $$1/1e6}' <<< "$$(stat -f%z $@)"

flash: $(TOP).bit
	@openFPGALoader -b basys3 $(TOP).bit > $(TOP)_flash.out 2>&1; rc=$$?; grep -v '^empty$$' $(TOP)_flash.out || true; \
	  if [ $$rc -ne 0 ]; then \
	    if grep -q 'unable to open ftdi device' $(TOP)_flash.out; then echo "ERROR: board not found. Is the USB (PROG port) plugged in and the power switch ON?" >&2; \
	    else echo "ERROR: openFPGALoader failed (exit $$rc), see the lines above" >&2; fi; exit 1; fi

clean:
	rm -f $(TOP)_sim $(TOP)_sim.out $(TOP)_sim.deps $(TOP)_flash.out $(TOP).vcd $(TOP).json $(TOP)_routed.json \
	      $(TOP).deps $(TOP).il $(TOP).il.tmp $(TOP).rv.out $(TOP).sl.out $(TOP).slang.log $(TOP).fasm $(TOP).frames $(TOP).bit $(TOP).log
