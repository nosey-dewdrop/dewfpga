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

# the testbench's $error/$fatal lines make sim fail, so a red run is visible to make, VS Code and CI.
# vvp -n: $stop ends the run instead of opening vvp's interactive prompt. -l: a copy of the output for the
# grep below, while stdout stays live on the terminal. The perl alarm stops a run that never reaches $finish.
sim: $(TOP)_sim
	@rc=0; SIM_TIMEOUT=$(SIM_TIMEOUT) perl -e '$$SIG{ALRM}=sub{kill TERM=>$$p; select(undef,undef,undef,0.3); kill KILL=>$$p; exit 142}; alarm $$ENV{SIM_TIMEOUT}; $$p=fork; exec @ARGV if !$$p; waitpid $$p,0; exit($$?>>8)' vvp -n -l $(TOP)_sim.out ./$(TOP)_sim || rc=$$?; \
	  if [ $$rc -eq 142 ]; then echo "ERROR: the simulation did not finish in $(SIM_TIMEOUT) s. The testbench must end with \$$finish; a free-running clock never stops on its own. SIM_TIMEOUT=600 dewfpga sim waits longer." >&2; exit 1; fi; \
	  [ $$rc -eq 0 ] || { echo "ERROR: the simulator stopped with exit $$rc (see above)" >&2; exit 1; }; \
	  ! grep -qE '^(ERROR|FATAL):' $(TOP)_sim.out || { echo "ERROR: the testbench reported errors (see above)" >&2; exit 1; }

$(TOP)_sim: $(SRCS) $(TB) $(wildcard *.svh *.vh)
	@[ -n "$(TB)" ] || { echo "ERROR: $(TOP)_tb.sv not found. Simulation needs a testbench next to the design; 'dewfpga new blink' gives an example (blink/blink_tb.sv)" >&2; exit 1; }
	iverilog -g2012 -o $@ $(SRCS) $(TB)

synth: $(TOP).json
# a failed build must not leave the previous .bit behind, so a student never flashes yesterday's design by mistake.
# $display/$print in synthesizable code has no hardware; Vivado drops it silently, so it is dropped here too.
$(TOP).json: $(SRCS) $(wildcard *.svh *.vh)
	@rm -f $(TOP).bit $(TOP).frames $(TOP).fasm $(TOP)_routed.json
	@"$(PY)" "$(CHECKER)" --fix-ports $(SRCS)
	@set -o pipefail; yosys -q -p "read_verilog -sv $(SRCS); synth_xilinx -flatten -abc9 -nobram -arch xc7 -top $(TOP); delete t:\$$print; write_json $@" 2>&1 \
	  | awk '/Latch inferred for signal .* from always_comb process/ { \
	           sig=$$0; sub(/.*Latch inferred for signal `?\\?/,"",sig); sub(/. from always_comb.*/,"",sig); sub(/^.*\\/,"",sig); \
	           at=$$0; sub(/.*\$$proc\$$/,"",at); sub(/\$$[0-9]+.*/,"",at); \
	           print "ERROR: " at ": the always_comb block leaves " sig " unassigned on some path (an if without else, a case without default), so it would need a latch. Give " sig " a default value at the top of the block. Vivado builds a latch here with a warning; Yosys refuses."; next } \
	         /Async reset .* yields non-constant value/ { print; print "ERROR: in an always_ff with an asynchronous reset (posedge clk, posedge reset), the reset branch may only assign constants (x <= 0). Assign that signal a constant on reset, or reset it inside the clocked branch."; next } \
	         /Multiple edge sensitive events found for this signal/ { print; print "ERROR: a signal is written from two always blocks with different edges (posedge and negedge, or two different resets). Drive each signal from one always block."; next } \
	         { print }'

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
	      /Max frequency for clock/{ v=$$0; sub(/.*for clock[[:space:]]+\047/,"",v); c=v; sub(/\047.*/,"",c); sub(/^[^:]*:[[:space:]]*/,"",v); freq[c]=v; if (v ~ /FAIL/) bad=1 } \
	      END{sub(/\/.*/,"",l); sub(/\/.*/,"",f); k=0; for (c in freq) k++; m=""; \
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
	rm -f $(TOP)_sim $(TOP)_sim.out $(TOP)_flash.out $(TOP).vcd $(TOP).json $(TOP)_routed.json \
	      $(TOP).fasm $(TOP).frames $(TOP).bit $(TOP).log
