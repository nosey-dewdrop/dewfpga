# Basys3 — macOS'ta Vivado'suz akış (mac-fpga)
#
#   make sim    -> simülasyon (iverilog)
#   make bit    -> bitstream üret (~4 sn)
#   make flash  -> karta yükle (SRAM: kart resetlenince silinir)
#   make check  -> araçlar yerinde mi
#   make clean
#
# Yeni modül: TOP/SRCS/XDC'yi değiştir. XDC pinleri Basys3_Master.xdc'den kopyalanır.

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

.PHONY: all sim synth bit flash clean check

all: bit

check:
	@for t in yosys iverilog openFPGALoader; do printf "%-16s " $$t; command -v $$t || echo "-YOK-"; done
	@printf "%-16s " nextpnr-xilinx; [ -x $(NEXTPNR) ] && echo $(NEXTPNR) || echo "-YOK-"
	@printf "%-16s " xc7frames2bit;  [ -x $(F2B) ]     && echo $(F2B)     || echo "-YOK-"
	@printf "%-16s " chipdb;         [ -s $(CHIPDB) ]  && echo $(CHIPDB)  || echo "-YOK-"

sim: $(TOP)_sim
	./$(TOP)_sim

$(TOP)_sim: $(SRCS) $(TOP)_tb.sv
	iverilog -g2012 -o $@ $(SRCS) $(TOP)_tb.sv

synth: $(TOP).json
$(TOP).json: $(SRCS)
	yosys -q -p "synth_xilinx -flatten -abc9 -nobram -arch xc7 -top $(TOP); write_json $@" $(SRCS)

$(TOP).fasm: $(TOP).json $(XDC)
	@$(PY) check_xdc.py $(TOP).json $(XDC)
	$(NEXTPNR) --chipdb $(CHIPDB) --xdc $(XDC) --json $(TOP).json --seed 1 \
	           --write $(TOP)_routed.json --fasm $@

$(TOP).frames: $(TOP).fasm
	$(PY) $(F2F) --part $(PART) --db-root $(XRAYDB) $< > $@

bit: $(TOP).bit
$(TOP).bit: $(TOP).frames
	$(F2B) --part_file $(XRAYDB)/$(PART)/part.yaml --part_name $(PART) \
	       --frm_file $< --output_file $@
	@ls -lh $@

flash: $(TOP).bit
	openFPGALoader -b basys3 $(TOP).bit

clean:
	rm -f $(TOP)_sim $(TOP).vcd $(TOP).json $(TOP)_routed.json \
	      $(TOP).fasm $(TOP).frames $(TOP).bit
