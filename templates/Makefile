# Basys3 on macOS without Vivado (mac-fpga)
#
#   make sim    -> simulate (iverilog)
#   make bit    -> build the bitstream (~4 s)
#   make flash  -> program the board (SRAM: cleared on power cycle)
#   make check  -> are the tools in place
#   make clean
#
# New module: change TOP/SRCS/XDC. Copy pins from Basys3_Master.xdc.

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

.PHONY: all sim synth bit flash clean check

all: bit

check:
	@for t in yosys iverilog openFPGALoader; do printf "%-16s " $$t; command -v $$t || echo "-MISSING-"; done
	@printf "%-16s " nextpnr-xilinx; [ -x "$(NEXTPNR)" ] && echo "$(NEXTPNR)" || echo "-MISSING-"
	@printf "%-16s " xc7frames2bit;  [ -x "$(F2B)" ]     && echo "$(F2B)"     || echo "-MISSING-"
	@printf "%-16s " chipdb;         [ -s "$(CHIPDB)" ]  && echo "$(CHIPDB)"  || echo "-MISSING-"

sim: $(TOP)_sim
	./$(TOP)_sim

$(TOP)_sim: $(SRCS) $(TOP)_tb.sv
	iverilog -g2012 -o $@ $(SRCS) $(TOP)_tb.sv

synth: $(TOP).json
$(TOP).json: $(SRCS)
	yosys -q -p "synth_xilinx -flatten -abc9 -nobram -arch xc7 -top $(TOP); write_json $@" $(SRCS)

$(TOP).fasm: $(TOP).json $(XDC)
	@"$(PY)" "$(CHECKER)" $(TOP).json $(XDC)
	"$(NEXTPNR)" --chipdb "$(CHIPDB)" --xdc $(XDC) --json $(TOP).json --seed 1 \
	           --write $(TOP)_routed.json --fasm $@

$(TOP).frames: $(TOP).fasm
	@PYTHONWARNINGS=ignore "$(PY)" "$(F2F)" --part $(PART) --db-root "$(XRAYDB)" $< > $@

bit: $(TOP).bit
$(TOP).bit: $(TOP).frames
	"$(F2B)" --part_file "$(XRAYDB)/$(PART)/part.yaml" --part_name $(PART) \
	       --frm_file $< --output_file $@
	@ls -lh $@

flash: $(TOP).bit
	@openFPGALoader -b basys3 $(TOP).bit || { echo "ERROR: board not found. Is the USB (PROG port) plugged in and the power switch ON?"; exit 1; }

clean:
	rm -f $(TOP)_sim $(TOP).vcd $(TOP).json $(TOP)_routed.json \
	      $(TOP).fasm $(TOP).frames $(TOP).bit
