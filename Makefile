.PHONY: install check site
install: ; ./install.sh
check:   ; bin/dewfpga check
site:    ; docs/build.sh
