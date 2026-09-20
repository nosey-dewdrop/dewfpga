.PHONY: install check site deploy
install: ; ./install.sh
check:   ; bin/dewfpga check
site:    ; docs/build.sh && docs/pdf.sh
deploy:  ; ./deploy.sh
