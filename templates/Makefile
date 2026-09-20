# Basys3 on macOS without Vivado (dewfpga)
#
#   make sim    -> simulate (iverilog); fails if the testbench prints $error/$fatal
#   make bit    -> build the bitstream (~4 s); full place-and-route log in <top>.log
#   make flash  -> program the board (SRAM: cleared on power cycle)
#   make check  -> are the tools in place
#   make clean
#
# New module: change TOP/SRCS/XDC. Copy pins from Basys3_Master.xdc (unused pins are ignored).
# -nobram: memories become distributed RAM (LUTs). Fine at lab sizes; a large framebuffer would not fit.

TOP  := blink
SRCS := blink.sv
XDC  := blink.xdc

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
.DELETE_ON_ERROR:          # a recipe that fails must not leave a half-written target behind (make 3.81 honours this)

.PHONY: all sim synth bit flash clean check

all: bit

check:
	@for t in yosys iverilog openFPGALoader; do printf "%-16s " $$t; command -v $$t || echo "-MISSING-"; done
	@printf "%-16s " nextpnr-xilinx; [ -x "$(NEXTPNR)" ] && echo "$(NEXTPNR)" || echo "-MISSING-"
	@printf "%-16s " xc7frames2bit;  [ -x "$(F2B)" ]     && echo "$(F2B)"     || echo "-MISSING-"
	@printf "%-16s " chipdb;         [ -s "$(CHIPDB)" ]  && echo "$(CHIPDB)"  || echo "-MISSING-"
	@printf "%-16s " fasm2frames;    [ -s "$(F2F)" ]     && echo "$(F2F)"     || echo "-MISSING-"
	@printf "%-16s " venv;           "$(PY)" -c "import fasm, prjxray" 2>/dev/null && echo "$(PY)" || echo "-MISSING-"

# the testbench's $error/$fatal lines make sim fail, so a red run is visible to make, VS Code and CI
sim: $(TOP)_sim
	@set -o pipefail; ./$(TOP)_sim | tee $(TOP)_sim.out; ! grep -qE '^(ERROR|FATAL):' $(TOP)_sim.out || { echo "ERROR: the testbench reported errors (see above)" >&2; exit 1; }

$(TOP)_sim: $(SRCS) $(TOP)_tb.sv $(wildcard *.svh *.vh)
	iverilog -g2012 -o $@ $(SRCS) $(TOP)_tb.sv

synth: $(TOP).json
$(TOP).json: $(SRCS) $(wildcard *.svh *.vh)
	yosys -q -p "read_verilog -sv $(SRCS); synth_xilinx -flatten -abc9 -nobram -arch xc7 -top $(TOP); write_json $@"

# the tool binaries and the chipdb are prerequisites too: after `dewfpga install` (an update) the netlist is re-placed
$(TOP).fasm: $(TOP).json $(XDC) $(wildcard $(FPGA)/chipdb/.sha)
	@"$(PY)" "$(CHECKER)" $(TOP).json $(XDC)
	@if ! grep -q '^[^#]*create_clock' $(XDC); then echo "note: no create_clock in $(XDC); timing is checked against the Basys3's 100 MHz oscillator (--freq 100)"; fi
	@"$(NEXTPNR)" --chipdb "$(CHIPDB)" --xdc $(XDC) --json $(TOP).json --seed 1 \
	           $$(grep -q '^[^#]*create_clock' $(XDC) || echo --freq 100) \
	           --write $(TOP)_routed.json --fasm $@ --quiet --log $(TOP).log
	@awk '/SLICE_LUTX:/{l=$$3} /SLICE_FFX:/{f=$$3} /Max frequency/{m=$$0; if ($$0 ~ /FAIL/) bad=$$0} \
	      END{sub(/\/.*/,"",l); sub(/\/.*/,"",f); if (bad != "") m = bad; sub(/.*: /,"",m); \
	          if (m == "") m = "no clocked paths, timing not applicable"; \
	          if (m ~ /FAIL/) { printf "ERROR: timing not met: %s. The design cannot run at the clock the XDC asks for; no bitstream written. Details: $(TOP).log\n",m > "/dev/stderr"; exit 2 } \
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
